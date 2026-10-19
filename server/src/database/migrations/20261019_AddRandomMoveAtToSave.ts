import { Migration } from "@mikro-orm/migrations";

/**
 * Adds save.randommoveat: when a Map Room 2 main yard last took "Move to a
 * random spot" (issue #366), in unix seconds, so the server can hold the
 * player to one move a week. Null for a yard that never moved, which is every
 * row this migration runs against.
 */
export class AddRandomMoveAtToSave extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."save"
        ADD COLUMN IF NOT EXISTS "randommoveat" int NULL;
    `);
  }
}
