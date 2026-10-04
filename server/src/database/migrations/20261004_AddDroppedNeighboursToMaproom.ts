import { Migration } from "@mikro-orm/migrations";

/**
 * Adds maproom.dropped_neighbours (issue #247): the Map Room 1 neighbours
 * dropped from a player's list today by the 10 attacks a day cap, each with
 * the day of the drop, as `[{ "userid": 12, "day": 1791072000 }]`.
 *
 * A re-search of the neighbour list leaves these out until the day rolls
 * over, so waiting for the next re-search no longer brings a dropped
 * neighbour back. Existing rows start with an empty list.
 */
export class AddDroppedNeighboursToMaproom extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."maproom"
        ADD COLUMN IF NOT EXISTS "dropped_neighbours" jsonb NOT NULL DEFAULT '[]';
    `);
  }
}
