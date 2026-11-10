import { AllianceInviteType } from "../../enums/Alliance.js";
import { Status } from "../../enums/StatusCodes.js";
import { Alliance } from "../../database/models/alliance.model.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { RequestJoinSchema } from "../../schemas/AllianceSchemas.js";
import { openInvite } from "../../services/alliance/allianceInvites.js";
import { assertMayJoin, GATE_SAVE_FIELDS } from "../../services/alliance/joinGate.js";
import { mustLeaveAllianceErr, permissionErr } from "../../errors/errors.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * Asks an alliance to take the authenticated player in, from the Browse tab's
 * Request to Join button. The request lands in the leader's Invites tab as a
 * pending row for them to accept or decline.
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

  await openInvite(alliance, user.userid, AllianceInviteType.REQUEST);

  ctx.status = Status.OK;
  ctx.body = { error: 0 };
};
