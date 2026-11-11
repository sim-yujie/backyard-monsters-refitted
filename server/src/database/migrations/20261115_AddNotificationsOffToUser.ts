import { Migration } from "@mikro-orm/migrations";

/**
 * Adds `user.notifications_off`: the bell's notification categories the
 * player turned off in Settings (owner 11 Nov 2026,
 * `services/notifications/notificationCategories.ts`). Empty for everyone, so
 * every notification still shows until a player turns one off.
 */
export class AddNotificationsOffToUser extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE "bym"."user" ADD COLUMN IF NOT EXISTS "notifications_off" jsonb NOT NULL DEFAULT '[]';`,
    );
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."user" DROP COLUMN IF EXISTS "notifications_off";`);
  }
}
