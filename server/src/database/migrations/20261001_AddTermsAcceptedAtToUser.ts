import { Migration } from "@mikro-orm/migrations";

/**
 * Adds user.terms_accepted_at: when the player agreed to the Terms and Privacy
 * Policy and confirmed they are 13 or older, on the web client's sign-up form
 * (issue #213).
 *
 * Null means no record of agreement: every account made before the line existed,
 * and any made by a client that does not send `termsAccepted`. Existing accounts
 * are left null for that reason; nothing is backfilled.
 */
export class AddTermsAcceptedAtToUser extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."user"
        ADD COLUMN IF NOT EXISTS "terms_accepted_at" timestamptz NULL;
    `);
  }
}
