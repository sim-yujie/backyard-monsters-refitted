import { Status } from "../../enums/StatusCodes.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { MemberActionSchema } from "../../schemas/AllianceSchemas.js";
import { requireAlliancePermission } from "../../services/alliance/allianceAccess.js";
import { AllianceAction } from "../../services/alliance/permissions.js";
import { promoteAllianceMember } from "../../services/alliance/membership.js";
import { cannotPromoteErr } from "../../errors/errors.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * Hands leadership to another member, from the Members tab. The promoting leader
 * is demoted to member in the same move, so an alliance always has exactly one
 * leader. This is what lets a leader with members left eventually leave.
 *
 * @param {Context} ctx - Koa context.
 */
export const promoteMember: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { userid } = MemberActionSchema.parse(ctx.request.body);

  const alliance = await requireAlliancePermission(user, AllianceAction.HAND_OVER);

  if (userid === user.userid) throw cannotPromoteErr();

  const member = await postgres.em.findOne(User, { userid });

  if (!member || member.alliance_id !== alliance.id) throw cannotPromoteErr();

  await promoteAllianceMember(user, member, alliance);

  ctx.status = Status.OK;
  ctx.body = { error: 0 };
};
