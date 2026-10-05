import { Migration } from "@mikro-orm/migrations";

/**
 * Creates bym.chat_report (issue #282, `services/chat/chatReports.ts`): a
 * player's report of one world chat line, stored for moderation. There is no
 * moderation screen yet; the rows are only kept.
 *
 * One row per reporter, reported player and line (`message_ts`, the chat
 * server's millisecond stamp), so reporting the same line twice changes
 * nothing. `message` is the server's own copy of the line when it was still in
 * the channel's history (`verified`), otherwise the reporter's words for it.
 * The rows stay when either player is deleted, so a report outlives the
 * account it was about.
 */
export class CreateChatReportTable extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."chat_report" (
        "id"          bigserial    PRIMARY KEY,
        "reporter_id" integer      NOT NULL,
        "reported_id" integer      NOT NULL,
        "channel"     varchar(255) NOT NULL,
        "message"     text         NOT NULL,
        "message_ts"  bigint       NOT NULL,
        "verified"    boolean      NOT NULL,
        "created_at"  timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "chat_report_once" UNIQUE ("reporter_id", "reported_id", "message_ts")
      );
    `);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "chat_report_reported_created_at" ON "bym"."chat_report" ("reported_id", "created_at");`,
    );
  }
}
