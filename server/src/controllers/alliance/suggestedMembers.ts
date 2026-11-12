import { Status } from "../../enums/StatusCodes.js";
import { User } from "../../database/models/user.model.js";
import { requireAlliancePermission } from "../../services/alliance/allianceAccess.js";
import { AllianceAction } from "../../services/alliance/permissions.js";
import { getSuggestedMembers } from "../../services/alliance/suggestedMembers.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * Returns players the leader could recruit, for the Suggested tab.
 *
 * Leader-only, as it was in the original - the tab is only rendered for whoever can
 * actually send an invite.
 *
 * @param {Context} ctx - Koa context.
 */
export const suggestedMembers: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const alliance = await requireAlliancePermission(user, AllianceAction.SUGGESTED_MEMBERS);

  const members = await getSuggestedMembers(alliance);

  ctx.status = Status.OK;
  ctx.body = { error: 0, members };
};
