import z from "zod";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import type { KoaController } from "../../../utils/KoaController.js";
import { User } from "../../../database/models/user.model.js";
import { Save } from "../../../database/models/save.model.js";
import { Message } from "../../../database/models/message.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { postgres } from "../../../server.js";
import { Status } from "../../../enums/StatusCodes.js";
import { BaseType } from "../../../enums/Base.js";
import { MapRoomCell, MapRoomVersion } from "../../../enums/MapRoom.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { inviteClosedErr, mailboxErr, permissionErr, shinyLockedErr } from "../../../errors/errors.js";
import { isShinyLocked } from "../../../services/user/shinyLock.js";
import { yardUnderAttack } from "../../../services/base/yardUnderAttack.js";
import {
  RELOCATE_COOLDOWN,
  chargeRelocation,
  type RelocatePayment,
} from "../../../services/maproom/v2/relocateRules.js";
import { writeOutpostNotice } from "../../../services/maproom/v2/outpostNotices.js";
import {
  INVITE_ACCEPTED,
  INVITE_DECLINED,
  INVITE_PRICE,
  InviteState,
  findInviteOutpost,
  findThreadInvite,
  inviteAcceptRefusal,
  inviteNoticeText,
  inviteRefusal,
  inviteState,
} from "../../../services/mail/inviteRules.js";

/**
 * What Flash posts to answer an invitation (`MapRoom.as:263-273`, `:337-338`).
 * Only the thread and, on accept, which price button was pressed are read: the
 * outpost is the invitation's own, and the amounts are the server's.
 */
const AnswerInviteSchema = z.object({
  threadid: z.coerce.number().int().positive(),
  shiny: z.coerce.number().optional(),
});

const lockSave = (em: EntityManager, basesaveid: number) =>
  em.findOne(Save, { basesaveid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });

/** The thread's invitation, which must be addressed to the caller. */
const invitationTo = async (userid: number, threadid: number) => {
  const invite = await findThreadInvite(postgres.em, threadid);
  if (!invite) throw mailboxErr();
  if (invite.targetid !== userid) throw permissionErr();
  return invite;
};

/**
 * Accepts an invitation to move (#205, Flash's `migratetofriend`): the
 * caller's main yard moves onto the inviter's Map Room 2 outpost, which is
 * gone, its buildings and housed monsters with it. The caller's own outposts
 * stay theirs, and their old home cell is left to the wild monsters.
 *
 * Everything is checked again here, in one transaction, under locks on both
 * players' main yards (in `basesaveid` order, so two players answering each
 * other's invitations at once cannot deadlock) and then the outpost:
 *
 * - The invitation still waits (`inviteState`): not answered, withdrawn,
 *   lapsed or void, the outpost still its inviter's. Otherwise 409
 *   `inviteClosedErr`.
 * - The caller is on Map Room 2 in the outpost's world, in no alliance, not in
 *   their relocation cooldown, has a home cell, neither yard is under attack,
 *   and they can pay `INVITE_PRICE`. Otherwise a soft refusal,
 *   `{ error: 1, message, reason, retryat? }`, with nothing written: the
 *   invitation stays open.
 *
 * On success the invitation is accepted, the caller's cooldown starts, and the
 * inviter is told by the game (`inviteaccepted`). Answers `{ error: 0, coords }`.
 */
export const migrateToFriend: KoaController = async (ctx) => {
  const { threadid, shiny } = AnswerInviteSchema.parse(ctx.request.body);
  const user: User = ctx.authUser;

  const invite = await invitationTo(user.userid, threadid);

  // Which of Flash's two buttons was pressed (`PopupRelocateMe.as`); the price is the server's.
  const payment: RelocatePayment = (shiny ?? 0) > 0 ? "shiny" : "resources";
  if (payment === "shiny" && isShinyLocked(user)) throw shinyLockedErr();

  await postgres.em.populate(user, ["save"]);
  const invitedId = user.save?.basesaveid;
  if (!invitedId) throw mailboxErr();

  const outcome = await postgres.em.transactional(async (em) => {
    const now = getCurrentDateTime();

    const inviterMainId = (await em.findOne(Save, { saveuserid: invite.userid, type: BaseType.MAIN }))?.basesaveid;
    if (!inviterMainId) return { closed: true as const };

    const [first, second] = [invitedId, inviterMainId].sort((a, b) => a - b);
    const firstSave = await lockSave(em, first!);
    const secondSave = await lockSave(em, second!);
    const invitedMain = firstSave?.basesaveid === invitedId ? firstSave : secondSave;
    const inviterMain = firstSave?.basesaveid === inviterMainId ? firstSave : secondSave;
    if (!invitedMain || !inviterMain) return { closed: true as const };

    // Read again under the locks: a second copy of this request waits above, then finds it answered.
    const current = await em.findOne(Message, { id: invite.id }, { refresh: true });
    if (!current?.baseid) return { closed: true as const };

    const candidates = await em.find(WorldMapCell, { baseid: current.baseid }, { populate: ["save"] });
    const cell = candidates.find((one) => one.world.uuid === current.worldid) ?? candidates[0] ?? null;
    const outpost = cell?.save ? await lockSave(em, cell.save.basesaveid) : null;

    if (inviteState(current, outpost, now) !== InviteState.REQUESTED || !cell || !outpost)
      return { closed: true as const };

    const homeCell = await em.findOne(WorldMapCell, {
      baseid: invitedMain.baseid,
      uid: user.userid,
      world: invitedMain.worldid ?? "",
      map_version: MapRoomVersion.V2,
      base_type: MapRoomCell.HOMECELL,
    });

    const refusal = inviteAcceptRefusal({
      invited: {
        userid: user.userid,
        allianceId: user.alliance_id,
        mapVersion: invitedMain.mapversion,
        worldid: invitedMain.worldid,
      },
      outpostWorld: cell.world.uuid,
      cantMoveTill: invitedMain.cantmovetill,
      underAttack: (await yardUnderAttack(invitedMain)) || (await yardUnderAttack(outpost)),
      hasHomeCell: homeCell !== null,
      now,
    });

    if (refusal) return { refusal: inviteRefusal(refusal, "invitee", now, invitedMain.cantmovetill ?? undefined) };

    const charge = chargeRelocation(
      { credits: invitedMain.credits, resources: invitedMain.resources },
      payment,
      INVITE_PRICE
    );

    if (!charge.ok) return { refusal: inviteRefusal(charge.reason, "invitee") };

    invitedMain.credits = charge.credits;
    invitedMain.resources = charge.resources;

    // The home cell takes the outpost's place; its old spot is left to the wild monsters.
    homeCell!.x = cell.x;
    homeCell!.y = cell.y;
    homeCell!.terrainHeight = cell.terrainHeight;

    invitedMain.homebase = [cell.x.toString(), cell.y.toString()];
    invitedMain.cantmovetill = now + RELOCATE_COOLDOWN;

    inviterMain.outposts = inviterMain.outposts.filter(([, , id]) => String(id) !== String(outpost.baseid));
    if (inviterMain.buildingresources) delete inviterMain.buildingresources[`b${outpost.baseid}`];

    current.migratestate = InviteState.ACCEPTED;

    em.persist([homeCell!, invitedMain, inviterMain, current]);
    em.remove([outpost, cell]);
    await em.flush();

    await writeOutpostNotice(em, {
      ownerId: current.userid,
      byUserId: user.userid,
      type: INVITE_ACCEPTED,
      text: inviteNoticeText(user.username, cell, true),
      cell: { x: cell.x, y: cell.y },
      baseid: outpost.baseid,
      now,
    });

    return { coords: [cell.x, cell.y] };
  });

  if ("closed" in outcome) throw inviteClosedErr();

  ctx.status = Status.OK;
  ctx.body = "refusal" in outcome ? outcome.refusal : { error: 0, coords: outcome.coords };
};

/**
 * Declines an invitation to move (#205, Flash's `rejectmigratetofriend`). It
 * must still wait for its answer (409 `inviteClosedErr` otherwise); the
 * inviter is told by the game (`invitedeclined`) and keeps the outpost.
 */
export const rejectMigrateToFriend: KoaController = async (ctx) => {
  const { threadid } = AnswerInviteSchema.parse(ctx.request.body);
  const user: User = ctx.authUser;

  const invite = await invitationTo(user.userid, threadid);
  const now = getCurrentDateTime();
  const outpost = await findInviteOutpost(postgres.em, invite.baseid);

  if (inviteState(invite, outpost, now) !== InviteState.REQUESTED) throw inviteClosedErr();

  invite.migratestate = InviteState.REJECTED;
  postgres.em.persist(invite);
  await postgres.em.flush();

  const [x, y] = invite.coords ?? [];
  if (Number.isInteger(x) && Number.isInteger(y)) {
    await writeOutpostNotice(postgres.em, {
      ownerId: invite.userid,
      byUserId: user.userid,
      type: INVITE_DECLINED,
      text: inviteNoticeText(user.username, { x: x!, y: y! }, false),
      cell: { x: x!, y: y! },
      baseid: invite.baseid!,
      now,
    });
  }

  ctx.status = Status.OK;
  ctx.body = { error: 0 };
};
