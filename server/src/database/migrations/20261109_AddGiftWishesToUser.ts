import { Migration } from "@mikro-orm/migrations";

/**
 * Gift wishes (issue #391, owner 6 Nov 2026, beta7-grill item 33): up to 3
 * gift resources a player would like from friends, as a comma list
 * (`r1,r3`). Friends sending a gift see them first, with a star; sending
 * anything else is still allowed (`services/friends/giftWishes.ts`).
 *
 * Null (no wishes) until the player picks one in the Friends screen's Gifts tab.
 */
export class AddGiftWishesToUser extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."user" ADD COLUMN IF NOT EXISTS "gift_wishes" varchar(16) NULL;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."user" DROP COLUMN IF EXISTS "gift_wishes";`);
  }
}
