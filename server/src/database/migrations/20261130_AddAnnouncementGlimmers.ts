import { Migration } from "@mikro-orm/migrations";

/**
 * A Glimmers gift on an announcement (owner, 13 Nov 2026: "allow me to give
 * glimmer as well? Would like to promote decorations in game"), beside the
 * Shiny one (`20261108_AddAnnouncementGift`):
 *
 * - `bym.announcement.glimmers`: how many Glimmers (event coins) each player
 *   may claim; 0 is none. Every existing announcement gets 0, so nothing
 *   changes for them.
 * - `bym.announcement_claim.glimmers`: how many Glimmers that claim gave.
 *   Every existing claim gets 0 (they gave Shiny only).
 *
 * The coins themselves go through the event coin store with the award key
 * `announcement:<id>` (`bym.event_coin_log`), so they are logged there too.
 *
 * Additive only: two columns with a default, no rows rewritten by hand, no
 * table locked for long (Postgres adds a column with a constant default
 * without rewriting the table).
 */
export class Migration20261130_AddAnnouncementGlimmers extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE "bym"."announcement" ADD COLUMN IF NOT EXISTS "glimmers" integer NOT NULL DEFAULT 0 CHECK ("glimmers" >= 0);`,
    );
    this.addSql(
      `ALTER TABLE "bym"."announcement_claim" ADD COLUMN IF NOT EXISTS "glimmers" integer NOT NULL DEFAULT 0 CHECK ("glimmers" >= 0);`,
    );
  }
}
