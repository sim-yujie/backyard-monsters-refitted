import { Migration } from "@mikro-orm/migrations";

/**
 * Adds `save.mainpointsearned` (patch 8.1, owner's fix C, 20 Nov 2026): the
 * main points an outpost's owner earned there by building, upgrading or
 * fortifying, which the empire board takes off that outpost's points so no
 * level counts twice (`services/maproom/v2/outpostEarned.ts`).
 *
 * Every row starts at 0. Additive only: no row is rewritten here. The past is
 * filled by the one-off seed script `database/seeds/backfill_outpost_mainpoints.ts`,
 * run by hand after the deploy; the column comment records whether it ran.
 */
export class Migration20261203_AddMainPointsEarnedToSave extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."save"
        ADD COLUMN IF NOT EXISTS "mainpointsearned" bigint NOT NULL DEFAULT 0;
    `);
  }
}
