import { AllianceInviteType } from "../../enums/Alliance.js";
import { AllianceAction, can } from "../../services/alliance/permissions.js";
import { Status } from "../../enums/StatusCodes.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { InviteUserSchema } from "../../schemas/AllianceSchemas.js";
import { requireAllianceMember } from "../../services/alliance/allianceAccess.js";
import { openInvite } from "../../services/alliance/allianceInvites.js";
import { mailAllianceInvite } from "../../services/alliance/inviteMail.js";
import { assertMayJoin, assertRejoinAllowed, GATE_SAVE_FIELDS } from "../../services/alliance/joinGate.js";
import { inviteBlockedErr, inviteLeaderOnlyErr, permissionErr, userAlreadyInAllianceErr } from "../../errors/errors.js";
import type { KoaController } from "../../utils/KoaController.js";

const INVITE_FIELDS = [
  "userid",
  "username",
  "alliance_id",
  "alliance_left_at",
  "blockedUsers",
  ...GATE_SAVE_FIELDS.map((field) => `save.${field}` as const),
] as const;

/**
 * Invites a player into the alliance, from the Suggested tab or the map room
 * popup. Only the Leader and Officers may (owner, 10 Nov 2026). The invite
 * reaches the player as an in-game mail message from the inviter, which they
 * can accept or decline from (`services/alliance/inviteMail.ts`), and it is
 * listed in their Invites tab too. The invite row and its message are written
 * in one transaction. Mail rules apply: if either player has blocked the
 * other, there is no invite.
 *
 * Membership is checked before rank so an ordinary member is told the invitation
 * is the leader's to send rather than being refused outright. The original's map
 * room enabled the button for every member, so members do reach here.
 *
 * The invited player must pass the alliance gate (`joinGate.ts`): Map Room 2,
 * a finished Observatory, and the alliance's own world (one world per
 * alliance, owner 10 Nov 2026). The original also limited invites to the
 * leader's world; the sector rule is not kept.
 *
 * @param {Context} ctx - Koa context.
 */
export const inviteUser: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { userid } = InviteUserSchema.parse(ctx.request.body);

  const alliance = await requireAllianceMember(user);

  if (!can(user.alliance_role, AllianceAction.INVITE)) throw inviteLeaderOnlyErr();

  const player = await postgres.em.findOne(User, { userid }, { fields: INVITE_FIELDS });
  if (!player) throw permissionErr();

  if (player.alliance_id) throw userAlreadyInAllianceErr();

  assertMayJoin(player.save, { allianceWorld: alliance.world_id, who: player.username });
  assertRejoinAllowed(player.alliance_left_at, new Date(), player.username);

  const blocked = (user.blockedUsers ?? []).includes(player.userid) || (player.blockedUsers ?? []).includes(user.userid);

  if (blocked) throw inviteBlockedErr(player.username);

  const invite = await postgres.em.transactional(async (em) => {
    const opened = await openInvite(alliance, player.userid, AllianceInviteType.INVITE, { em, invitedBy: user.userid });

    await mailAllianceInvite(em, { inviter: user, invitedId: player.userid, alliance, invite: opened });

    return opened;
  });

  ctx.status = Status.OK;
  ctx.body = { error: 0, invite_id: invite.id };
};
