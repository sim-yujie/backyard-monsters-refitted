import { Migration } from "@mikro-orm/migrations";

/**
 * Adds save.dailyquests (not Flash's `quests` column), the daily login card, daily quests and weekly quests of a
 * player (`services/quests/state.ts`, beta 6). Server-only, main saves only,
 * written under the main row's lock. NULL until the player's first quests are
 * picked.
 */
export class AddDailyQuestsToSave extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."save"
        ADD COLUMN IF NOT EXISTS "dailyquests" jsonb NULL;
    `);
  }
}
