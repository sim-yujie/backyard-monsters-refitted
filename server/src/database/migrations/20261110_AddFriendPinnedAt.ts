import { Migration } from "@mikro-orm/migrations";

/**
 * Pinned friends (beta 7, owner: "Allow pinning of friends in the friend list
 * (up to 10)"): `bym.friend.pinned_at`, when the player pinned that friend,
 * or null. It sits on the player's own side of the friendship, so pinning is
 * one-sided and the friend is not told. A friendship that ends takes its pin
 * with it (the row goes).
 *
 * Additive only: one nullable column and a partial index for counting a
 * player's pins (the 10 limit) and reading them for the maps.
 */
export class AddFriendPinnedAt extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."friend" ADD COLUMN IF NOT EXISTS "pinned_at" timestamptz NULL;`);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "friend_pinned" ON "bym"."friend" ("userid") WHERE "pinned_at" IS NOT NULL;`,
    );
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "bym"."friend_pinned";`);
    this.addSql(`ALTER TABLE "bym"."friend" DROP COLUMN IF EXISTS "pinned_at";`);
  }
}
