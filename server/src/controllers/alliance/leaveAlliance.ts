import { Status } from "../../enums/StatusCodes.js";
import { AllianceMessageType } from "../../enums/Alliance.js";
import { User } from "../../database/models/user.model.js";
import { requireAllianceMember } from "../../services/alliance/allianceAccess.js";
import { removeAllianceMember } from "../../services/alliance/membership.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * Removes the authenticated user from their alliance. An ordinary member leaves
 * directly; a leader may only leave once no other members remain, otherwise they
 * must transfer leadership first. The membership service checks that rule,
 * clears the membership and disbands an empty alliance, all under one lock.
 *
 * @param {Context} ctx - Koa context.
 */
export const leaveAlliance: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const alliance = await requireAllianceMember(user);

  await removeAllianceMember(user, alliance, AllianceMessageType.LEFT);

  ctx.status = Status.OK;
  ctx.body = { error: 0 };
};
