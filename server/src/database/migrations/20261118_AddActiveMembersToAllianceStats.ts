import { Migration } from "@mikro-orm/migrations";

/**
 * `bym.alliance_stats` gains `active_members`: members who played in the last
 * 7 days (`ACTIVE_MEMBER_DAYS`, `config/AllianceConfig.ts`), for the
 * marketplace order (alliances with room first, then the most active) and the
 * absent-leader rule's sense of "active" (alliances phase 0).
 *
 * The 7 is written into the SQL: a migration is a snapshot. The entity
 * (`database/models/alliancestats.view.ts`) builds the same view from the
 * config; change both together, with a new migration.
 *
 * CREATE OR REPLACE VIEW may only add columns at the end, so the new one is
 * last. Nothing is removed.
 */
export class Migration20261118_AddActiveMembersToAllianceStats extends Migration {
  async up(): Promise<void> {
    await this.execute(`
      CREATE OR REPLACE VIEW bym.alliance_stats AS
      SELECT
        alliance_id,
        member_count,
        empire_points,
        rank() over (PARTITION BY world_id    ORDER BY empire_points DESC)::int AS world_rank,
        rank() over (PARTITION BY map_version ORDER BY empire_points DESC)::int AS global_rank,
        active_members
      FROM (
        SELECT
          a.id AS alliance_id,
          a.world_id,
          a.map_version,
          count(u.userid)::int AS member_count,
          coalesce(sum(s.points::numeric + s.basevalue::numeric), 0)::bigint AS empire_points,
          (count(u.userid) FILTER (WHERE u.last_seen_at > now() - interval '7 days'))::int AS active_members
        FROM bym.alliance a
        LEFT JOIN bym."user" u ON u.alliance_id = a.id
        LEFT JOIN bym.save s ON u.save_basesaveid = s.basesaveid AND s.type = 'main'
        GROUP BY a.id, a.world_id, a.map_version
      ) totals
    `);
  }
}
