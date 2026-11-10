import { Status } from "../../enums/StatusCodes.js";
import { AllianceStance } from "../../enums/Alliance.js";
import { Alliance } from "../../database/models/alliance.model.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { SearchAlliancesSchema } from "../../schemas/AllianceSchemas.js";
import { findRelationships, type RelationshipLookup } from "../../services/alliance/relationships.js";
import { getLeaderBaseIds } from "../../services/alliance/allianceLeaders.js";
import { memberLimit } from "../../services/alliance/allianceTypes.js";
import { ALLIANCE_TYPES } from "../../config/AllianceConfig.js";
import type { KoaController } from "../../utils/KoaController.js";
import { allianceNoWorldErr } from "../../errors/errors.js";

const PAGE_SIZE = 10;

/** Each type's member limit as SQL, built from the config so no number is written twice. */
const MEMBER_LIMIT_SQL = `CASE a.type ${Object.entries(ALLIANCE_TYPES)
  .map(([type, rules]) => `WHEN '${type}' THEN ${Number(rules.members)}`)
  .join(" ")} ELSE 0 END`;

/**
 * Search alliances for the Browse tab - a leaderboard the client
 * paginates 10 rows at a time.
 *
 * Only the player's own world is ever listed: an alliance lives in one world
 * and only players of that world may join it (owner, 10 Nov 2026). The old
 * `world` flag ("This World" / "All") is still accepted and no longer widens
 * the list.
 *
 * Marketplace order (alliances phase 0): alliances with a free seat first,
 * then the most members who played in the last 7 days (`active_members`),
 * then empire points.
 *
 * @param {Context} ctx - Koa context.
 */
export const searchAlliances: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { search, page } = SearchAlliancesSchema.parse(ctx.request.body);

  await postgres.em.populate(user, ["save"], { fields: ["save.worldid"] });

  const worldid = user.save?.worldid;

  if (!worldid) throw allianceNoWorldErr();

  const nameFilter = search ? "AND a.name ILIKE ?" : "";
  const params: unknown[] = search ? [worldid, `%${search}%`] : [worldid];

  const [count] = await postgres.em.execute<{ n: string }[]>(
    `SELECT count(*) AS n FROM bym.alliance a WHERE a.world_id = ? ${nameFilter}`,
    params
  );
  const totalResults = Number(count?.n ?? 0);

  const pageRows = await postgres.em.execute<{ id: number }[]>(
    `SELECT a.id
       FROM bym.alliance a
       JOIN bym.alliance_stats s ON s.alliance_id = a.id
      WHERE a.world_id = ? ${nameFilter}
      ORDER BY (${MEMBER_LIMIT_SQL}) > s.member_count DESC, s.active_members DESC, s.empire_points DESC, a.id ASC
      OFFSET ? LIMIT ?`,
    [...params, page * PAGE_SIZE, PAGE_SIZE]
  );
  const order = pageRows.map((row) => Number(row.id));
  const found = order.length ? await postgres.em.find(Alliance, { id: { $in: order } }, { populate: ["stats"] }) : [];
  const alliances = order
    .map((id) => found.find((alliance) => alliance.id === id))
    .filter((alliance): alliance is Alliance => alliance !== undefined);

  const leaderIds = alliances.map((alliance) => alliance.leader_userid);
  const leaders = await getLeaderBaseIds(leaderIds);

  const allianceIds = alliances.map((alliance) => alliance.id);
  const relationships: RelationshipLookup = await findRelationships(user.alliance_id, allianceIds);

  const results = alliances.map((alliance) => ({
    alliance_id: alliance.id,
    name: alliance.name,
    image: alliance.image,
    members: alliance.stats?.member_count,
    leader_name: alliance.leader_name,
    leader_baseid: leaders.get(alliance.leader_userid),
    rank: alliance.stats?.world_rank,
    relationship: relationships.get(alliance.id) ?? AllianceStance.NEUTRAL,
    ep: alliance.stats?.empire_points,
    type: alliance.type,
    member_limit: memberLimit(alliance.type),
    active_members: alliance.stats?.active_members ?? 0,
  }));

  ctx.status = Status.OK;
  ctx.body = { error: 0, alliances: results, pageSize: PAGE_SIZE, totalResults };
};
