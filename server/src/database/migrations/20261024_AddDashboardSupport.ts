import { Migration } from "@mikro-orm/migrations";

/**
 * The dashboard's player support tools (`docs/design/admin-dashboard-api.md`,
 * "Replies and Shiny"):
 *
 * - `bym.bug_report.mail_thread_id`: the in-game mail thread between the
 *   report's player and "The game team" (`services/admin/supportMail.ts`),
 *   started by the owner's first reply. The player's answers in it show under
 *   the report.
 * - `bym.shiny_award`: every Shiny the owner gives a player, with how much,
 *   why, from which report (if any) and when (`services/admin/shinyAwards.ts`).
 *   `request_id` is the dashboard's own id for one press of Give, so a press
 *   sent twice gives once. Account deletion takes the player's rows and takes
 *   the owner's number out of `awarded_by`.
 *
 * Additive only.
 */
export class AddDashboardSupport extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."bug_report" ADD COLUMN IF NOT EXISTS "mail_thread_id" integer NULL;`);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "bug_report_mail_thread" ON "bym"."bug_report" ("mail_thread_id") WHERE "mail_thread_id" IS NOT NULL;`,
    );

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."shiny_award" (
        "id"            bigserial   PRIMARY KEY,
        "request_id"    text        NOT NULL UNIQUE,
        "userid"        integer     NOT NULL,
        "username"      text        NOT NULL DEFAULT '',
        "amount"        integer     NOT NULL CHECK ("amount" > 0),
        "reason"        text        NOT NULL,
        "bug_report_id" bigint      NULL REFERENCES "bym"."bug_report" ("id") ON DELETE SET NULL,
        "thread_id"     integer     NULL,
        "awarded_by"    integer     NULL,
        "awarded_at"    timestamptz NOT NULL DEFAULT now()
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "shiny_award_awarded_at" ON "bym"."shiny_award" ("awarded_at");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "shiny_award_userid" ON "bym"."shiny_award" ("userid");`);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "shiny_award_bug_report" ON "bym"."shiny_award" ("bug_report_id") WHERE "bug_report_id" IS NOT NULL;`,
    );
  }
}
