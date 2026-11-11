import { AllianceInviteStatus, AllianceInviteType, AllianceJoinMode } from "../../enums/Alliance.js";
import { Status } from "../../enums/StatusCodes.js";
import { Alliance } from "../../database/models/alliance.model.js";
import { AllianceInvite } from "../../database/models/allianceinvite.model.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { RequestJoinSchema } from "../../schemas/AllianceSchemas.js";
import { joinOpenAlliance, openInvite } from "../../services/alliance/allianceInvites.js";
import { adOf, assertAdAllows, joinerLevel } from "../../services/alliance/allianceAd.js";
import { assertMayJoin, assertRejoinAllowed, GATE_SAVE_FIELDS } from "../../services/alliance/joinGate.js";
import { alreadyInvitedErr, mustLeaveAllianceErr, permissionErr } from "../../errors/errors.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * The marketplace's Join / Ask button, by the alliance's joining mode
 * (design v5 §7a): an Open alliance takes the player at once and answers
 * `joined: true`; Ask to join leaves a pending request in the Leader's and
 * Officers' Invites tab; Invite only refuses (`inviteOnly`). A minimum level
 * above the floor refuses a lower player (`lowLevel`). The server holds both
 * rules, whatever the window shows.
 *
 * The joining player must pass the alliance gate (`joinGate.ts`): Map Room 2,
 * a finished Observatory, and the alliance's own world (one world per
 * alliance, owner 10 Nov 2026), which is what the Browse tab lists.
 *
 * @param {Context} ctx - Koa context.
 */
export const requestJoin: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  await postgres.em.populate(user, ["save"], { fields: GATE_SAVE_FIELDS.map((field) => `save.${field}` as const) });

  const { alliance_id } = RequestJoinSchema.parse(ctx.request.body);

  if (user.alliance_id) throw mustLeaveAllianceErr();

  const alliance = await postgres.em.findOne(Alliance, { id: alliance_id });
  if (!alliance) throw permissionErr();

  assertMayJoin(user.save, { allianceWorld: alliance.world_id });
  assertRejoinAllowed(user.alliance_left_at, new Date());

  const ad = adOf(alliance);

  assertAdAllows(ad, await joinerLevel(postgres.em, user.userid));

  if (ad.join_mode === AllianceJoinMode.OPEN) {
    await joinOpenAlliance(user, alliance);

    ctx.status = Status.OK;
    ctx.body = { error: 0, joined: true };

    return;
  }

  // Already invited by this alliance: the pending invite is the way in (`invited`), not a second row.
  const invited = await postgres.em.count(AllianceInvite, {
    alliance_id: alliance.id,
    user_id: user.userid,
    type: AllianceInviteType.INVITE,
    status: AllianceInviteStatus.PENDING,
  });
  if (invited > 0) throw alreadyInvitedErr(alliance.name);

  await openInvite(alliance, user.userid, AllianceInviteType.REQUEST);

  ctx.status = Status.OK;
  ctx.body = { error: 0, joined: false };
};
