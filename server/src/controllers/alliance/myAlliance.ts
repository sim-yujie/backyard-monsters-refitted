import { Status } from "../../enums/StatusCodes.js";
import { User } from "../../database/models/user.model.js";
import { getUserAlliance } from "../../services/alliance/allianceAccess.js";
import { getAllianceDetails } from "../../services/alliance/allianceMember.js";
import { getTypeSwitchOptions } from "../../services/alliance/allianceSettings.js";
import { memberLimit, officerLimit } from "../../services/alliance/allianceTypes.js";
import { allowedActions } from "../../services/alliance/permissions.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * Returns the authenticated user's alliance for the My Alliance tab, or
 * `alliance: null` when they are unaffiliated.
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
    ctx.body = { error: 0, alliance: null };
    return;
  }

  const { online, avgLevel } = await getAllianceDetails(alliance.id);
  const typeOptions = await getTypeSwitchOptions(alliance.id, new Date());

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
    },
  };
};
