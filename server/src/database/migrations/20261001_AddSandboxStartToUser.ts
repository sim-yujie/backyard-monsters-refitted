import { Migration } from "@mikro-orm/migrations";

/**
 * Adds user.sandbox_start: the player ticked "Start with the test yard (dev)"
 * on the web client's sign-up form (issue #217), so their first main yard is
 * the maxed sandbox yard while the server has DEV_SANDBOX on.
 *
 * Every existing account is false: their main yard is already built, and the
 * column is only read when one is first made.
 */
export class AddSandboxStartToUser extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."user"
        ADD COLUMN IF NOT EXISTS "sandbox_start" boolean NOT NULL DEFAULT false;
    `);
  }
}
