import { Migration } from "@mikro-orm/migrations";

/**
 * A Shiny gift on an announcement (owner, 5 Nov 2026: "give shiny in an
 * announcement as well", for the 1,000 players thank-you):
 *
 * - `bym.announcement.shiny`: how much each player may claim; 0 is no gift.
 * - `bym.announcement_claim`: who claimed which gift and how much they got.
 *   The primary key is what makes one account claim one gift once. It goes
 *   with the player's account or the announcement; the Shiny stays with the
 *   player.
 *
 * Additive only.
 */
export class AddAnnouncementGift extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE "bym"."announcement" ADD COLUMN IF NOT EXISTS "shiny" integer NOT NULL DEFAULT 0 CHECK ("shiny" >= 0);`);
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."announcement_claim" (
        "userid"          integer     NOT NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "announcement_id" bigint      NOT NULL REFERENCES "bym"."announcement" ("id") ON DELETE CASCADE,
        "amount"          integer     NOT NULL,
        "claimed_at"      timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("userid", "announcement_id")
      );
    `);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "announcement_claim_announcement" ON "bym"."announcement_claim" ("announcement_id");`,
    );
  }
}
