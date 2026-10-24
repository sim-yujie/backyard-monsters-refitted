import { Migration } from "@mikro-orm/migrations";

/**
 * Adds maproom.neighbors_level: the player's level when their Map Room 1
 * neighbour list was last searched. The list is searched again once the
 * player's level has moved more than 7 levels from it (owner, 2026-10-23,
 * replacing decision 23 of `docs/design/bot-neighbours.md`).
 *
 * Existing rows start empty (NULL), and a list with no level is searched
 * again on its next open, which notes the level; so no list needs clearing.
 */
export class AddNeighborsLevelToMaproom extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."maproom"
        ADD COLUMN IF NOT EXISTS "neighbors_level" int NULL;
    `);
  }
}
