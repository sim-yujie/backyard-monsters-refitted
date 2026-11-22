import { Migration } from "@mikro-orm/migrations";

/**
 * Adds `save.hccpresets` (beta 9, Hatchery Control Centre levels 2 and 3):
 * the player's HCC presets, on the main row (`services/yard/hccPresets.ts`).
 * Additive only: every row starts NULL, read as no presets.
 */
export class Migration20261204_AddHccPresetsToSave extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."save"
        ADD COLUMN IF NOT EXISTS "hccpresets" jsonb NULL;
    `);
  }
}
