import { Migration } from "@mikro-orm/migrations";

/**
 * Moderator mail (owner, beta 7): a player on the chat moderators list
 * (`bym.chat_moderator`) may write to any player, and the owner's dashboard
 * lists every mail they send ("Moderator mail"), so the power cannot be
 * abused unseen (`services/mail/modMail.ts`).
 *
 * - `bym.mod_mail_log`: one row per mail a moderator sent, written with the
 *   message. A copy, not a link: it has no foreign keys, so it stays when the
 *   message, its thread, the moderator's or the recipient's account is
 *   deleted, and the mail retention sweep never touches it. Names are kept as
 *   they were when it was sent.
 *
 * Only adds.
 */
export class AddModMailLog extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."mod_mail_log" (
        "id"             bigserial   PRIMARY KEY,
        "sent_at"        timestamptz NOT NULL DEFAULT now(),
        "moderator_id"   integer     NOT NULL,
        "moderator_name" text        NOT NULL,
        "recipient_id"   integer     NOT NULL,
        "recipient_name" text        NOT NULL,
        "threadid"       integer     NOT NULL,
        "new_thread"     boolean     NOT NULL DEFAULT false,
        "messagetype"    text        NOT NULL,
        "subject"        text        NOT NULL,
        "message"        text        NOT NULL,
        "written"        text        NULL
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "mod_mail_log_sent_at_idx" ON "bym"."mod_mail_log" ("sent_at" DESC);`);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "mod_mail_log_moderator_idx" ON "bym"."mod_mail_log" ("moderator_id", "sent_at" DESC);`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "mod_mail_log_recipient_idx" ON "bym"."mod_mail_log" ("recipient_id", "sent_at" DESC);`,
    );
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "bym"."mod_mail_log";`);
  }
}
