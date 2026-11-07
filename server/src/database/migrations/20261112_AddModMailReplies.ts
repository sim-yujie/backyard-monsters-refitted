import { Migration } from "@mikro-orm/migrations";

/**
 * Moderator mail as conversations (owner, 8 Nov: "normally its a
 * conversation between mod and player rather than a single email"). The
 * dashboard's "Moderator mail" now shows each moderator-player thread whole,
 * both sides, so the players' answers are logged too (`services/mail/modMail.ts`).
 *
 * - `bym.mod_mail_log.sender`: who wrote the row, `moderator` or `player`.
 *   Every row already there was a moderator's, hence the default. In every
 *   row `moderator_*` is the conversation's moderator and `recipient_*` its
 *   player, whoever wrote it; `new_thread` on a player's row means the player
 *   started the thread with it. Like the rest of the log it has no foreign
 *   keys, so a player's answer stays when the message, thread or accounts are
 *   deleted.
 * - `mod_mail_log_thread_idx`: one conversation in order, and the check on
 *   every send whether the thread is already in the log.
 *
 * Only adds.
 */
export class AddModMailReplies extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."mod_mail_log"
        ADD COLUMN IF NOT EXISTS "sender" text NOT NULL DEFAULT 'moderator'
          CONSTRAINT "mod_mail_log_sender_check" CHECK ("sender" IN ('moderator', 'player'));
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "mod_mail_log_thread_idx" ON "bym"."mod_mail_log" ("threadid", "id");`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "bym"."mod_mail_log_thread_idx";`);
    this.addSql(`ALTER TABLE "bym"."mod_mail_log" DROP COLUMN IF EXISTS "sender";`);
  }
}
