import { Migration } from "@mikro-orm/migrations";

/**
 * Adds message.attackstats: on the game's attack notices, the attack's
 * numbers, `{ damage, loot: { r1..r4 }, housedLost }`, so the bell, the away
 * line and the mailbox can show them as icons rather than a sentence
 * (less-text job 3, 28 Oct 2026). Null on every other message and on notices
 * written before this, which keep their sentence.
 *
 * Additive only: a new nullable column.
 */
export class AddAttackStatsToMessage extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."message" ADD COLUMN IF NOT EXISTS "attackstats" jsonb NULL;`);
  }
}
