import { Migration } from "@mikro-orm/migrations";

/**
 * The owner's moderation tools on the dashboard (`services/admin/moderation.ts`).
 *
 * - `user.ban_until`: when a ban set from the dashboard ends; null with
 *   `banned` true is a ban for good (the anticheat's bans are those).
 *   Signing in after that time lifts the ban (`controllers/auth/login.ts`).
 * - `user.ban_reason`: the owner's words, shown to the player at sign-in.
 * - `user.mute_until`: no chat lines accepted before this time.
 * - `bym.moderation_action`: every warning, ban, unban, mute and unmute, who
 *   did it and why (the dashboard's moderation log). `seen_at` is when the
 *   player closed a warning's pop-up in the game; null until then.
 *
 * Only adds. The rows are written by raw SQL that sets every NOT NULL column
 * itself, so a live table made without these defaults still takes them.
 */
export class AddModeration extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."user" ADD COLUMN IF NOT EXISTS "ban_until" timestamptz NULL;`);
    this.addSql(`ALTER TABLE "bym"."user" ADD COLUMN IF NOT EXISTS "ban_reason" text NULL;`);
    this.addSql(`ALTER TABLE "bym"."user" ADD COLUMN IF NOT EXISTS "mute_until" timestamptz NULL;`);
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."moderation_action" (
        "id"             bigserial    PRIMARY KEY,
        "userid"         integer      NOT NULL,
        "admin_id"       integer      NOT NULL,
        "action"         varchar(16)  NOT NULL,
        "reason"         text         NOT NULL,
        "until"          timestamptz  NULL,
        "chat_report_id" bigint       NULL,
        "seen_at"        timestamptz  NULL,
        "created_at"     timestamptz  NOT NULL DEFAULT now()
      );
    `);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "moderation_action_userid_created_at" ON "bym"."moderation_action" ("userid", "created_at");`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "chat_report_created_at" ON "bym"."chat_report" ("created_at");`,
    );
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "bym"."chat_report_created_at";`);
    this.addSql(`DROP TABLE IF EXISTS "bym"."moderation_action";`);
    this.addSql(`ALTER TABLE "bym"."user" DROP COLUMN IF EXISTS "mute_until";`);
    this.addSql(`ALTER TABLE "bym"."user" DROP COLUMN IF EXISTS "ban_reason";`);
    this.addSql(`ALTER TABLE "bym"."user" DROP COLUMN IF EXISTS "ban_until";`);
  }
}
