import { Migration } from "@mikro-orm/migrations";

/**
 * Chat report cases (owner, 4 Nov 2026: the dashboard was "getting a bit
 * cluttered and long, especially for moderation aspect when multiple people
 * report the same message"). `services/admin/chatCases.ts`.
 *
 * - `bym.chat_case`: one offender's reported chat lines while the owner has
 *   not acted yet. At most one open case per player (`chat_case_one_open`);
 *   once closed, a new report opens a new one. `status` is `open`,
 *   `actioned` (warned, or warned and chat paused) or `dismissed`;
 *   `outcome`, `mute_hours`, `note`, `closed_by`, `closed_at` say what the
 *   owner did, and `moderation_action_id` is the step in the player's
 *   moderation log.
 * - `bym.chat_case_message`: one reported line in a case, with `snapshot`,
 *   a text copy of the room around it (names, times, words; the reported line
 *   marked), taken when it was reported and kept after the 90-day chat log
 *   has gone. Kept as long as the case.
 * - `chat_report.case_message_id`: which case line a report belongs to.
 *
 * Only adds. Rows are written by raw SQL that sets every NOT NULL column.
 */
export class AddChatCases extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."chat_case" (
        "id"                   bigserial    PRIMARY KEY,
        "reported_id"          integer      NOT NULL,
        "status"               varchar(12)  NOT NULL DEFAULT 'open',
        "outcome"              varchar(16)  NULL,
        "mute_hours"           integer      NULL,
        "note"                 text         NULL,
        "moderation_action_id" bigint       NULL,
        "closed_by"            integer      NULL,
        "closed_at"            timestamptz  NULL,
        "first_report_at"      timestamptz  NOT NULL,
        "last_report_at"       timestamptz  NOT NULL,
        "created_at"           timestamptz  NOT NULL DEFAULT now()
      );
    `);
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "chat_case_one_open" ON "bym"."chat_case" ("reported_id") WHERE "status" = 'open';`,
    );
    this.addSql(`CREATE INDEX IF NOT EXISTS "chat_case_reported_id" ON "bym"."chat_case" ("reported_id", "id");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "chat_case_last_report_at" ON "bym"."chat_case" ("last_report_at");`);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."chat_case_message" (
        "id"          bigserial    PRIMARY KEY,
        "case_id"     bigint       NOT NULL,
        "reported_id" integer      NOT NULL,
        "channel"     varchar(64)  NOT NULL,
        "message_ts"  bigint       NOT NULL,
        "message"     text         NOT NULL,
        "verified"    boolean      NOT NULL DEFAULT false,
        "snapshot"    jsonb        NOT NULL DEFAULT '{}'::jsonb,
        "snapshot_at" timestamptz  NULL,
        "created_at"  timestamptz  NOT NULL DEFAULT now()
      );
    `);
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "chat_case_message_once" ON "bym"."chat_case_message" ("reported_id", "channel", "message_ts");`,
    );
    this.addSql(`CREATE INDEX IF NOT EXISTS "chat_case_message_case_id" ON "bym"."chat_case_message" ("case_id");`);

    this.addSql(`ALTER TABLE "bym"."chat_report" ADD COLUMN IF NOT EXISTS "case_message_id" bigint NULL;`);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "chat_report_case_message_id" ON "bym"."chat_report" ("case_message_id");`,
    );
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "bym"."chat_report_case_message_id";`);
    this.addSql(`ALTER TABLE "bym"."chat_report" DROP COLUMN IF EXISTS "case_message_id";`);
    this.addSql(`DROP TABLE IF EXISTS "bym"."chat_case_message";`);
    this.addSql(`DROP TABLE IF EXISTS "bym"."chat_case";`);
  }
}
