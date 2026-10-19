import { Migration } from "@mikro-orm/migrations";

/**
 * Creates `bym.friend_gift` (`docs/design/friends.md` §5 and §6.1, issue
 * #375): one row per gift between friends. The unique key on sender,
 * receiver and UTC day is the one-gift-a-day rule, and it holds across
 * removing and re-adding a friend (§7 rule 5). `amount` is worked out and
 * fixed when the gift is sent; `collected_at` is set when the receiver
 * collects it, and a gift not collected by `expires_at` has lapsed. The rows
 * are also the audit trail of who gave whom what (§7 rule 9).
 *
 * Additive only: a new table and its indexes. Rows go with either player's
 * account (`services/privacy/deleteAccount.ts` deletes them, and the foreign
 * keys cascade) and after 90 days (`services/privacy/retention.ts`).
 */
export class CreateFriendGiftTable extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."friend_gift" (
        "id"            bigserial   PRIMARY KEY,
        "from_userid"   integer     NOT NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "to_userid"     integer     NOT NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "resource"      text        NOT NULL CHECK ("resource" IN ('r1', 'r2', 'r3', 'r4')),
        "amount"        integer     NOT NULL CHECK ("amount" >= 0),
        "gift_day"      date        NOT NULL,
        "created_at"    timestamptz NOT NULL DEFAULT now(),
        "collected_at"  timestamptz NULL,
        "expires_at"    timestamptz NOT NULL,
        CHECK ("from_userid" <> "to_userid"),
        CONSTRAINT "friend_gift_once_a_day" UNIQUE ("from_userid", "to_userid", "gift_day")
      );
    `);
    // A receiver's waiting gifts, and the gifts they collected today (the daily limit).
    this.addSql(`CREATE INDEX IF NOT EXISTS "friend_gift_receiver" ON "bym"."friend_gift" ("to_userid", "collected_at");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "friend_gift_created" ON "bym"."friend_gift" ("created_at");`);
  }
}
