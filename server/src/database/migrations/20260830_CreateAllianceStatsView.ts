import { Migration } from "@mikro-orm/migrations";

/**
 * Creates bym.alliance_stats, which derives an alliance's standing from its members.
 *
 * Nothing is stored on the alliance row because these totals move whenever any member
 * builds, upgrades or is raided - none of which is an alliance event. A cached column
 * could only be refreshed on joins and leaves, the rare half of what changes it, so it
 * would drift from the day it was written.
 *
 * Both ranks are computed here rather than per query, so a standing can never disagree
 * with the empire points printed beside it. Ties share a rank: two alliances level on
 * points are both 4th and the next is 6th.
 *
 * The totals are gathered in an inner query so the ranks can order by the alias rather
 * than repeat the sum: a window function cannot see a select alias from its own level.
 *
 * save_basesaveid already points at a member's main yard, but the type filter stays -
 * nothing enforces that invariant, and an outpost slipping in would inflate every total.
 *
 * The AllianceStats entity declares view: true, so schema:create emits the view on a
 * fresh database - in its NEWEST shape (today with active_members, added by
 * 20261118_AddActiveMembersToAllianceStats). CI and db:init run schema:create and then
 * every migration, so this one meets a view with more columns than it defines here.
 * CREATE OR REPLACE VIEW cannot drop columns (Postgres 42P16), so the view is dropped
 * and rebuilt in this first shape; the later view migrations then bring it forward
 * again. No other view depends on alliance_stats, so no CASCADE: if one ever does,
 * this fails loudly rather than silently dropping it. Any future change to the view
 * needs a new migration alongside the entity's expression.
 */
export class CreateAllianceStatsView extends Migration {
  async up(): Promise<void> {
    await this.execute(`DROP VIEW IF EXISTS bym.alliance_stats`);
    await this.execute(`
      CREATE VIEW bym.alliance_stats AS
      SELECT
        alliance_id,
        member_count,
        empire_points,
        rank() over (PARTITION BY world_id    ORDER BY empire_points DESC)::int AS world_rank,
        rank() over (PARTITION BY map_version ORDER BY empire_points DESC)::int AS global_rank
      FROM (
        SELECT
          a.id AS alliance_id,
          a.world_id,
          a.map_version,
          count(u.userid)::int AS member_count,
          coalesce(sum(s.points::numeric + s.basevalue::numeric), 0)::bigint AS empire_points
        FROM bym.alliance a
        LEFT JOIN bym."user" u ON u.alliance_id = a.id
        LEFT JOIN bym.save s ON u.save_basesaveid = s.basesaveid AND s.type = 'main'
        GROUP BY a.id, a.world_id, a.map_version
      ) totals
    `);
  }
}
