import { Migration } from "@mikro-orm/migrations";

/**
 * Adds bot.grow_drops (issue #248): how many times in a row the bot sweep has
 * dropped this bot's `grow` job after it failed `MAX_ATTEMPTS` times. The
 * sweep retires the bot (with the usual level 1 replacement) once it reaches
 * `MAX_GROW_DROPS`, instead of booking it again forever; a grow that runs
 * sets it back to 0. Existing bots start at 0.
 */
export class AddGrowDropsToBot extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."bot"
        ADD COLUMN IF NOT EXISTS "grow_drops" integer NOT NULL DEFAULT 0;
    `);
  }
}
