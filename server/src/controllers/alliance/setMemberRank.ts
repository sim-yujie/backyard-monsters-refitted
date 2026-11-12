import { Status } from "../../enums/StatusCodes.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { SetRankSchema } from "../../schemas/AllianceSchemas.js";
import { requireAlliancePermission } from "../../services/alliance/allianceAccess.js";
import { setAllianceRank } from "../../services/alliance/membership.js";
import { AllianceAction } from "../../services/alliance/permissions.js";
import { cannotPromoteErr } from "../../errors/errors.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * Makes a Member an Officer, or an Officer a Member, from the Members tab.
 * Leader only; an Officer seat is given only while the type has one free
 * (2 / 4 / 6).
 *
 * @param {Context} ctx - Koa context.
 */
export const setMemberRank: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { userid, role } = SetRankSchema.parse(ctx.request.body);

  const alliance = await requireAlliancePermission(user, AllianceAction.SET_RANK);

  if (userid === user.userid) throw cannotPromoteErr();

  const member = await postgres.em.findOne(User, { userid });

  if (!member || member.alliance_id !== alliance.id) throw cannotPromoteErr();

  const changed = await setAllianceRank(user, member, alliance, role);

  ctx.status = Status.OK;
  ctx.body = { error: 0, role, changed };
};
