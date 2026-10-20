import { Migration } from "@mikro-orm/migrations";

/**
 * Creates `bym.bug_report` (`services/bugReports/bugReports.ts`): one row per
 * bug report sent from the game, also emailed to `BUG_REPORT_EMAIL`.
 *
 * A signed-in report has `userid` and `username`; a signed-out one (from the
 * login screen) has the `contact_email` the player typed and `ip_hash`, a
 * keyed hash of their IP address, which only counts their reports for the
 * daily cap. The rest is what the client sent: the player's words, the game
 * version, screen, device, browser, screen size and recent game errors, plus
 * the automatic screenshot and an optional picture (JPEG, PNG or WebP bytes).
 * `emailed_at` stays null when the email failed, so the row says which
 * reports never arrived.
 *
 * Additive only. A player's reports go with their account (the foreign key
 * cascades, and `services/privacy/deleteAccount.ts` lists the table); the
 * daily clean-up deletes reports older than `BUG_REPORT_RETENTION_DAYS`.
 */
export class CreateBugReportTable extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."bug_report" (
        "id"              bigserial   PRIMARY KEY,
        "userid"          integer     NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "username"        text        NULL,
        "contact_email"   text        NULL,
        "ip_hash"         text        NULL,
        "message"         text        NOT NULL,
        "game_version"    text        NOT NULL DEFAULT '',
        "screen"          text        NOT NULL DEFAULT '',
        "device"          text        NOT NULL DEFAULT '',
        "user_agent"      text        NOT NULL DEFAULT '',
        "screen_size"     text        NOT NULL DEFAULT '',
        "errors"          jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("errors") = 'array'),
        "screenshot"      bytea       NULL,
        "screenshot_type" text        NULL,
        "picture"         bytea       NULL,
        "picture_type"    text        NULL,
        "emailed_at"      timestamptz NULL,
        "created_at"      timestamptz NOT NULL DEFAULT now()
      );
    `);
    // The daily cap: one player's reports, or one address's signed-out ones, by time.
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "bug_report_userid_created_at" ON "bym"."bug_report" ("userid", "created_at");`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "bug_report_ip_hash_created_at" ON "bym"."bug_report" ("ip_hash", "created_at") WHERE "ip_hash" IS NOT NULL;`,
    );
    // The clean-up's scan by age.
    this.addSql(`CREATE INDEX IF NOT EXISTS "bug_report_created_at" ON "bym"."bug_report" ("created_at");`);
  }
}
