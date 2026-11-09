import { Migration } from "@mikro-orm/migrations";

/**
 * Outpost names and pins (beta 7, owner 9 Nov 2026: "Allow players to name /
 * pin the outpost of their choice so it's easy for them to navigate").
 * `services/outposts/outpostLabels.ts`.
 *
 * `bym.outpost_label`: one row per player and outpost that has a name or a
 * pin, keyed by the owner's `userid` and the outpost's `baseid`. A row with
 * neither is deleted. `pin_order` is the player's own pin count at the time,
 * so pinned outposts list in the order they were pinned. A row whose outpost
 * the player no longer owns is never read (every read joins `bym.save` on
 * the owner), so a lost outpost drops out of the list and the pin count on
 * its own.
 *
 * Its own table rather than a column on the main save: the game writes the
 * whole main save back on every yard save, which would race a rename.
 *
 * Only adds. Rows are written by raw SQL that sets every NOT NULL column.
 */
export class CreateOutpostLabelTable extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."outpost_label" (
        "userid"     integer     NOT NULL,
        "baseid"     varchar(32) NOT NULL,
        "name"       varchar(24) NOT NULL DEFAULT '',
        "pin_order"  integer     NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("userid", "baseid")
      );
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "bym"."outpost_label";`);
  }
}
