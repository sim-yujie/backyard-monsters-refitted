import { Migration } from "@mikro-orm/migrations";

/**
 * Game settings the owner changes from the dashboard without a release
 * (beta 7): one row per setting, its value as JSON.
 *
 * The first is `weekend_events`, the weekend events' rotation, percentages,
 * skips and swaps (`services/events/weekendSettings.ts`). No row: the
 * defaults in `game-data/events/weekendEvents.ts` hold.
 *
 * Additive only.
 */
export class CreateGameSettingTable extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."game_setting" (
        "key"        text        PRIMARY KEY,
        "value"      jsonb       NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" integer     NULL
      );
    `);
  }
}
