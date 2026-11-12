import { Status } from "../../enums/StatusCodes.js";
import { User } from "../../database/models/user.model.js";
import { requireAllianceMember } from "../../services/alliance/allianceAccess.js";
import { takeOverLeadership } from "../../services/alliance/leadership.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * `POST /alliance/takeover`: the absent-leader takeover (design v5 §6). The
 * leader has not played for 7 days and the player is the longest-serving
 * active Officer, or with none, the longest-serving active Member
 * (`services/alliance/leadership.ts`). myalliance's `can_take_over` says when.
 *
 * @param {Context} ctx - Koa context.
 */
export const takeOverAlliance: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const alliance = await requireAllianceMember(user);

  await takeOverLeadership(user, alliance, new Date(getCurrentDateTime() * 1000));

  ctx.status = Status.OK;
  ctx.body = { error: 0, role: user.alliance_role, leader_name: alliance.leader_name };
};
