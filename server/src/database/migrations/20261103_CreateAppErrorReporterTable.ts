import { Migration } from "@mikro-orm/migrations";

/**
 * Adds `bym.app_error_reporter`: who hit each kind of error on the owner's
 * dashboard (`services/errors/errorStore.ts`, owner 3 Nov 2026). One row per
 * kind, account and address, keeping only each kind's few most recent.
 *
 * - `userid` and `username` come from the request's login (0 and '' when not
 *   signed in), `ip` from the address the server trusts (`middleware/
 *   clientIp.ts`); nothing the client sends is believed.
 * - The address is shown only on the owner's dashboard.
 * - The daily clean-up deletes a row 30 days after it was last seen; it goes
 *   with its error row (the foreign key cascades) and with the account when
 *   the account is deleted.
 *
 * Additive only.
 */
export class CreateAppErrorReporterTable extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."app_error_reporter" (
        "id"        bigserial   PRIMARY KEY,
        "error_id"  bigint      NOT NULL REFERENCES "bym"."app_error" ("id") ON DELETE CASCADE,
        "userid"    integer     NOT NULL DEFAULT 0,
        "username"  text        NOT NULL DEFAULT '',
        "ip"        text        NOT NULL DEFAULT '',
        "last_seen" timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("error_id", "userid", "ip")
      );
    `);
    // The clean-up's scan by age.
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "app_error_reporter_last_seen" ON "bym"."app_error_reporter" ("last_seen");`
    );
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "bym"."app_error_reporter";`);
  }
}
