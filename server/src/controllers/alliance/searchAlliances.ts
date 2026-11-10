import type { FilterQuery } from "@mikro-orm/core";

import { Status } from "../../enums/StatusCodes.js";
import { AllianceStance } from "../../enums/Alliance.js";
import { Alliance } from "../../database/models/alliance.model.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { SearchAlliancesSchema } from "../../schemas/AllianceSchemas.js";
import { findRelationships, type RelationshipLookup } from "../../services/alliance/relationships.js";
import { getLeaderBaseIds } from "../../services/alliance/allianceLeaders.js";
import type { KoaController } from "../../utils/KoaController.js";
import { allianceNoWorldErr } from "../../errors/errors.js";

const PAGE_SIZE = 10;

/**
 * Search alliances for the Browse tab - a leaderboard the client
 * paginates 10 rows at a time.
 *
 * Only the player's own world is ever listed: an alliance lives in one world
 * and only players of that world may join it (owner, 10 Nov 2026). The old
 * `world` flag ("This World" / "All") is still accepted and no longer widens
 * the list.
 *
 * @param {Context} ctx - Koa context.
 */
export const searchAlliances: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { search, page } = SearchAlliancesSchema.parse(ctx.request.body);

  const where: FilterQuery<Alliance> = {};

  if (search) where.name = { $ilike: `%${search}%` };

  await postgres.em.populate(user, ["save"], { fields: ["save.worldid"] });

  const worldid = user.save?.worldid;

  if (!worldid) throw allianceNoWorldErr();

  where.world_id = worldid;

  const searchOptions = {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    orderBy: { stats: { empire_points: "DESC" }, id: "ASC" },
    populate: ["stats"],
  } as const;

  const [alliances, totalResults] = await postgres.em.findAndCount(Alliance, where, searchOptions);

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
  }));

  ctx.status = Status.OK;
  ctx.body = { error: 0, alliances: results, pageSize: PAGE_SIZE, totalResults };
};
