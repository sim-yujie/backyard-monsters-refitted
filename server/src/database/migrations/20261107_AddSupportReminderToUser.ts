import { Migration } from "@mikro-orm/migrations";

/**
 * The rare "Support the game" reminder (owner 24 Oct and 4 Nov 2026, "not too
 * intrusive"), remembered per account so it never shows more often by
 * switching devices (`controllers/support/supportReminder.ts`):
 *
 * - `support_reminded_at`: when the reminder last showed; null if never.
 * - `support_reminder_off`: the player pressed "Don't show again".
 *
 * Read and written in raw SQL, like `whatsnew_seen`; not on the User model.
 */
export class AddSupportReminderToUser extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."user" ADD COLUMN IF NOT EXISTS "support_reminded_at" timestamptz NULL;`);
    this.addSql(
      `ALTER TABLE "bym"."user" ADD COLUMN IF NOT EXISTS "support_reminder_off" boolean NOT NULL DEFAULT false;`
    );
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."user" DROP COLUMN IF EXISTS "support_reminded_at";`);
    this.addSql(`ALTER TABLE "bym"."user" DROP COLUMN IF EXISTS "support_reminder_off";`);
  }
}
