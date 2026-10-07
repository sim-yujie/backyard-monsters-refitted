import { Migration } from "@mikro-orm/migrations";

/**
 * Adds save.starterkit: which outpost Starter Kit (`game-data/starterKits.ts`)
 * an outpost's buildings were last replaced with, 1 Regular, 2 Mega, 3 Ultra,
 * or 0 for an outpost that never took one (issue #334, Map Room 2's kit tint
 * and kit filter). A kit itself writes no marker of which one it was — it
 * only replaces `buildingdata` — so this is the one durable record of it.
 *
 * Every row starts at 0, which reads as "no kit" and is correct for every
 * outpost this migration runs against: none of them has this column set yet.
 */
export class AddStarterKitToSave extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."save"
        ADD COLUMN IF NOT EXISTS "starterkit" int NOT NULL DEFAULT 0;
    `);
  }
}
