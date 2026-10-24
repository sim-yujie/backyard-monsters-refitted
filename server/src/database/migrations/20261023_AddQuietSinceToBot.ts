import { Migration } from "@mikro-orm/migrations";

/**
 * Adds bot.quiet_since (`docs/design/bot-neighbours.md` §4.4): when the bot
 * stops growing, as a player who quits or slows down; null while it never
 * will. The sweep reads the bot's place on the climb up to this time
 * (`services/bots/population.ts`). Existing bots start null: growing.
 */
export class AddQuietSinceToBot extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."bot"
        ADD COLUMN IF NOT EXISTS "quiet_since" timestamptz NULL;
    `);
  }
}
