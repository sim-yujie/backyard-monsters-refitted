import { Migration } from "@mikro-orm/migrations";

/**
 * Adds `user.smart_moving_off`: the player switched "Smart moving" off (beta
 * 9, owner 24 Nov 2026, `services/base/autoAttack/smartMove.ts`). Off for
 * everyone, so the setting starts on for every account.
 */
export class AddSmartMovingOffToUser extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."user" ADD COLUMN IF NOT EXISTS "smart_moving_off" boolean NOT NULL DEFAULT false;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."user" DROP COLUMN IF EXISTS "smart_moving_off";`);
  }
}
