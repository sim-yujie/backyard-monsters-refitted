import { Migration } from "@mikro-orm/migrations";

/**
 * Adds save.achievements, the achievements' server-only record: stats,
 * unlocks, the Shiny each paid and whether its pop-up was seen
 * (`services/achievements/state.ts`, `docs/design/achievements.md` §6,
 * issue #204).
 *
 * Every row stays NULL. NULL means "never worked out": the first evaluation
 * under the main row's lock backfills what the save already proves (§8), so
 * there is nothing for SQL to fill in. Only the main save's row is ever
 * written.
 */
export class AddAchievementsToSave extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."save"
        ADD COLUMN IF NOT EXISTS "achievements" jsonb NULL;
    `);
  }
}
