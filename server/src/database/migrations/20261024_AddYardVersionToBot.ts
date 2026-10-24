import { Migration } from "@mikro-orm/migrations";

/**
 * Adds bot.yard_version: the version of the bot yard generator that made the
 * bot's yard (`BOT_YARD_VERSION`, `services/bots/yardGenerator.ts`). Version
 * 2 keeps the Monster Locker in step with the Town Hall, which changes every
 * bot's build order, so a yard made before it no longer grows into the one
 * the generator makes now. Existing bots start at 1: the sweep's next `grow`
 * rebuilds their yard from the generator once and sets the version.
 */
export class AddYardVersionToBot extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."bot"
        ADD COLUMN IF NOT EXISTS "yard_version" integer NOT NULL DEFAULT 1;
    `);
  }
}
