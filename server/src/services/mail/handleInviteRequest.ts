import { BaseType } from "../../enums/Base.js";
import { Message } from "../../database/models/message.model.js";
import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { WorldMapCell } from "../../database/models/worldmapcell.model.js";
import { postgres } from "../../server.js";
import { inviteExistsErr } from "../../errors/errors.js";
import { chargeRelocation, relocateTargetRefusal } from "../maproom/v2/relocateRules.js";
import { isShinyLocked } from "../user/shinyLock.js";
import {
  INVITE_PRICE,
  InviteState,
  type HostPayment,
  inviteRefusal,
  inviteSendRefusal,
  openInviteFilter,
  type InviteSoftRefusal,
} from "./inviteRules.js";

/** What a `migraterequest` message carries once it may be sent: its outpost, and where. */
export interface InviteMessageFields {
  baseid: string;
  worldid: string;
  coords: number[];
  migratestate: InviteState.REQUESTED;
  hostpayment: HostPayment;
}

/**
 * Checks an invitation to move (#205) before `sendmessage` writes it
 * (`inviteRules.ts`):
 *
 * - The outpost is one of the inviter's own Map Room 2 outposts, as they
 *   would need to move onto it themselves (`relocateTargetRefusal`).
 * - The invited player is someone else, on Map Room 2, in the outpost's
 *   world. Being in an alliance no longer matters (design v5 §12).
 * - The inviter can pay their share ({@link INVITE_PRICE}) the way they chose
 *   right now; it is charged only when the invitation is accepted, and
 *   checked again then.
 * - The outpost has no invitation still waiting: `inviteExistsErr`.
 *
 * @param inviterId - The authenticated user's ID
 * @param invitedId - The message's recipient
 * @param baseid - The outpost, as the client names it
 * @param now - Unix seconds
 * @param hostpayment - How the inviter pays their share
 * @returns The soft refusal to send, or the fields the message carries
 */
export const handleInviteRequest = async (
  inviterId: number,
  invitedId: number,
  baseid: string | undefined,
  now: number,
  hostpayment: HostPayment = "resources"
): Promise<{ refusal: InviteSoftRefusal } | { fields: InviteMessageFields }> => {
  const em = postgres.em;

  const inviterMain = await em.findOne(Save, { saveuserid: inviterId, type: BaseType.MAIN });
  // Every cell with this base id, preferring the inviter's world, as `migrateBase` reads it.
  const candidates = baseid ? await em.find(WorldMapCell, { baseid }, { populate: ["save"] }) : [];
  const cell = candidates.find((one) => one.world.uuid === inviterMain?.worldid) ?? candidates[0] ?? null;
  const outpost = cell?.save ?? null;

  const ownsOutpost =
    !!inviterMain &&
    relocateTargetRefusal({
      userid: inviterId,
      worldid: inviterMain.worldid,
      outposts: inviterMain.outposts,
      cell: cell && {
        uid: cell.uid,
        base_type: cell.base_type,
        map_version: cell.map_version,
        worldid: cell.world.uuid,
      },
      save: outpost,
      underAttack: false,
    }) === null;

  const invited = await em.findOne(User, { userid: invitedId }, { populate: ["save"] });

  const refusal = inviteSendRefusal({
    inviterId,
    ownsOutpost,
    outpostWorld: cell?.world.uuid,
    invited: {
      userid: invitedId,
      mapVersion: invited?.save?.mapversion,
      worldid: invited?.save?.worldid,
    },
  });

  if (refusal) return { refusal: inviteRefusal(refusal, "inviter") };

  if (hostpayment === "shiny") {
    const inviter = await em.findOne(User, { userid: inviterId }, { fields: ["shiny_locked"] });
    if (inviter && isShinyLocked(inviter as User)) return { refusal: inviteRefusal("hostShinyLocked", "inviter") };
  }
  const share = chargeRelocation({ credits: inviterMain!.credits, resources: inviterMain!.resources }, hostpayment, INVITE_PRICE);
  if (!share.ok) return { refusal: inviteRefusal(share.reason, "inviter") };

  if (await em.findOne(Message, { ...openInviteFilter(now), baseid: outpost!.baseid })) throw inviteExistsErr();

  return {
    fields: {
      baseid: outpost!.baseid,
      worldid: cell!.world.uuid,
      coords: [cell!.x, cell!.y],
      migratestate: InviteState.REQUESTED,
      hostpayment,
    },
  };
};
