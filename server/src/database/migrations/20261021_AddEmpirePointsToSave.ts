import { Migration } from "@mikro-orm/migrations";

/**
 * Adds save.empirepoints and save.empirepointsat for the leaderboard
 * (`services/leaderboard/empireBoard.ts`): a yard's empire points
 * (`points` + `basevalue`, both stored as strings) as one whole number, and
 * when that number last changed, in unix seconds. `Save` keeps both in step
 * on every write that touches `points` or `basevalue` (`syncEmpirePoints`).
 *
 * The backfill runs once, here, in SQL. A part that is not a plain number
 * counts as 0, as `empirePointsColumnValue` does. The rows have no record of
 * when they reached their score, so `empirepointsat` starts as the yard's last
 * save time: of two players already tied, the one who has saved less recently
 * ranks higher, which is the nearest stable guess.
 *
 * The partial index is the board's order (most points first, then who got
 * there first), so the top 100 is read straight off it.
 */
export class AddEmpirePointsToSave extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."save"
        ADD COLUMN IF NOT EXISTS "empirepoints" bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "empirepointsat" int NOT NULL DEFAULT 0;
    `);
    this.addSql(`
      UPDATE "bym"."save"
         SET "empirepoints" = floor(
               (CASE WHEN "points" ~ '^[0-9]+(\\.[0-9]+)?$' THEN "points"::numeric ELSE 0 END) +
               (CASE WHEN "basevalue" ~ '^[0-9]+(\\.[0-9]+)?$' THEN "basevalue"::numeric ELSE 0 END)
             )::bigint,
             "empirepointsat" = coalesce("savetime", 0);
    `);
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "save_main_empire_board_index"
        ON "bym"."save" ("empirepoints" DESC, "empirepointsat" ASC, "userid" ASC)
        WHERE "type" = 'main';
    `);
  }
}
