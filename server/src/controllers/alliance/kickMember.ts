import { Status } from "../../enums/StatusCodes.js";
import { AllianceMessageType } from "../../enums/Alliance.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { MemberActionSchema } from "../../schemas/AllianceSchemas.js";
import { requireAllianceMember } from "../../services/alliance/allianceAccess.js";
import { canKick } from "../../services/alliance/permissions.js";
import { removeAllianceMember } from "../../services/alliance/membership.js";
import { cannotKickErr } from "../../errors/errors.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * Removes a player from the kicker's alliance, from the Members tab. The
 * Leader kicks Officers and Members, an Officer only Members
 * (`permissions.ts`); the membership service checks both ranks again under
 * its locks.
 *
 * @param {Context} ctx - Koa context.
 */
export const kickMember: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { userid } = MemberActionSchema.parse(ctx.request.body);

  const alliance = await requireAllianceMember(user);

  if (userid === user.userid) throw cannotKickErr();

  const member = await postgres.em.findOne(User, { userid });

  if (!member || member.alliance_id !== alliance.id) throw cannotKickErr();
  if (!canKick(user.alliance_role, member.alliance_role)) throw cannotKickErr();

  await removeAllianceMember(member, alliance, AllianceMessageType.KICKED, user);

  ctx.status = Status.OK;
  ctx.body = { error: 0 };
};
