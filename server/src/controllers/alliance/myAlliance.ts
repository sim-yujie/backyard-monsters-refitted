import { Status } from "../../enums/StatusCodes.js";
import { AllianceRole } from "../../enums/Alliance.js";
import { User } from "../../database/models/user.model.js";
import { getUserAlliance } from "../../services/alliance/allianceAccess.js";
import { getAllianceDetails } from "../../services/alliance/allianceMember.js";
import { getTypeSwitchOptions } from "../../services/alliance/allianceSettings.js";
import { memberLimit, officerLimit } from "../../services/alliance/allianceTypes.js";
import { allowedActions } from "../../services/alliance/permissions.js";
import { rejoinAvailableAt } from "../../services/alliance/joinGate.js";
import { canTakeOver, renameAvailableAt } from "../../services/alliance/leadership.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * Returns the authenticated user's alliance for the My Alliance tab, or
 * `alliance: null` when they are unaffiliated, with `rejoin_available_at`
 * (Unix seconds) while the 24-hour re-join wait runs, else null.
 *
 * Rank is the alliance's standing across its whole map version by empire points,
 * not within its own world.
 *
 * @param {Context} ctx - Koa context.
 */
export const myAlliance: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const alliance = await getUserAlliance(user, { withStats: true });

  if (!alliance) {
    ctx.status = Status.OK;
    const rejoinAt = rejoinAvailableAt(user.alliance_left_at, new Date());

    ctx.body = {
      error: 0,
      alliance: null,
      rejoin_available_at: rejoinAt ? Math.floor(rejoinAt.getTime() / 1000) : null,
    };
    return;
  }

  const { online, avgLevel } = await getAllianceDetails(alliance.id);
  const now = new Date();
  const typeOptions = await getTypeSwitchOptions(alliance.id, now);
  const renameAt = renameAvailableAt(alliance, now);
  const isLeader = user.alliance_role === AllianceRole.LEADER;

  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    alliance: {
      alliance_id: alliance.id,
      name: alliance.name,
      image: alliance.image,
      description: alliance.description,
      rank: alliance.stats?.global_rank,
      avg_level: avgLevel,
      leader_name: alliance.leader_name,
      number_of_members: alliance.stats?.member_count,
      online_members: online,
      type: alliance.type,
      member_limit: memberLimit(alliance.type),
      officer_limit: officerLimit(alliance.type),
      points: alliance.points,
      points_spent: alliance.points_spent,
      type_options: typeOptions,
      role: user.alliance_role ?? null,
      permissions: allowedActions(user.alliance_role),
      // Renaming (leader): `must_rename` after an admin rename; otherwise once per 7 days.
      must_rename: alliance.must_rename,
      rename_available_at: renameAt ? Math.floor(renameAt.getTime() / 1000) : null,
      // The absent-leader takeover button (`leadership.ts`).
      can_take_over: !isLeader && (await canTakeOver(alliance.id, user.userid, now)),
    },
  };
};
