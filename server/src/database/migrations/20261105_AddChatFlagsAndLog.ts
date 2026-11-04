import { Migration } from "@mikro-orm/migrations";

/**
 * Automatic chat flags and the full chat log (owner, 4 Nov 2026: "comb
 * through the world chat to pick up on slurs etc and put them on my
 * dashboard", and "Cant we have a backup of world chat?").
 *
 * - `bym.chat_flag`: a chat line the word filter caught, with the player's
 *   own words (`message`) next to what other players saw (`shown`), the
 *   words that hit, `severity` (`slur` or `swear`) and `rule` (`word`: a
 *   listed word as such; `disguised`: one spelled to get past the filter). The dashboard groups
 *   them by player; `dismissed_at` / `dismissed_by` say when the owner set
 *   them aside. Written by `services/chat/chatFlags.ts`, never more than a
 *   few per player in ten minutes.
 * - `bym.chat_log`: every World and country room line, unmasked and masked,
 *   for the dashboard's chat log (`services/chat/chatLog.ts`). Players still
 *   get only the last 100 lines per room from Redis. `flagged` is the line's
 *   flag severity, null for a clean line. The daily clean-up deletes lines
 *   older than `CHAT_LOG_RETENTION_DAYS` (default 90).
 *
 * Only adds. Rows are written by raw SQL that sets every NOT NULL column.
 */
export class AddChatFlagsAndLog extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."chat_flag" (
        "id"           bigserial    PRIMARY KEY,
        "userid"       integer      NOT NULL,
        "channel"      varchar(64)  NOT NULL,
        "message"      text         NOT NULL,
        "shown"        text         NOT NULL,
        "words"        text         NOT NULL,
        "severity"     varchar(8)   NOT NULL,
        "rule"         varchar(12)  NOT NULL DEFAULT 'word',
        "message_ts"   bigint       NOT NULL,
        "dismissed_at" timestamptz  NULL,
        "dismissed_by" integer      NULL,
        "created_at"   timestamptz  NOT NULL DEFAULT now()
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "chat_flag_userid_id" ON "bym"."chat_flag" ("userid", "id");`);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "chat_flag_open" ON "bym"."chat_flag" ("userid") WHERE "dismissed_at" IS NULL;`,
    );
    this.addSql(`CREATE INDEX IF NOT EXISTS "chat_flag_created_at" ON "bym"."chat_flag" ("created_at");`);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."chat_log" (
        "id"         bigserial    PRIMARY KEY,
        "userid"     integer      NOT NULL,
        "channel"    varchar(64)  NOT NULL,
        "message"    text         NOT NULL,
        "shown"      text         NOT NULL,
        "flagged"    varchar(8)   NULL,
        "created_at" timestamptz  NOT NULL DEFAULT now()
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "chat_log_userid_id" ON "bym"."chat_log" ("userid", "id");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "chat_log_channel_id" ON "bym"."chat_log" ("channel", "id");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "chat_log_created_at" ON "bym"."chat_log" ("created_at");`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "bym"."chat_log";`);
    this.addSql(`DROP TABLE IF EXISTS "bym"."chat_flag";`);
  }
}
