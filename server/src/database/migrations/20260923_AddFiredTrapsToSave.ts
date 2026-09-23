import { Migration } from "@mikro-orm/migrations";

/**
 * Adds save.firedtraps, the record of where a trap was standing when it fired.
 *
 * A fired trap leaves nothing behind. `BTRAP.Explode` sets its health to zero,
 * the owner's next save omits it from buildingdata entirely, and the attack
 * save drops it server-side (buildingDataHandler.ts) — so by the time the
 * player looks, only a stale zero in buildinghealthdata says a trap was ever
 * there, and the position is gone. The Yard Planner's "Re-arm traps" action
 * needs that position, so the handler now records `{ t, X, Y, at }` here as the
 * trap is dropped, newest last and capped at 200 entries.
 *
 * Existing rows get the default, which is the truthful answer for them: nothing
 * before this migration was recorded, so nothing is known to be missing.
 */
export class AddFiredTrapsToSave extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bym"."save"
        ADD COLUMN IF NOT EXISTS "firedtraps" jsonb NOT NULL DEFAULT '[]';
    `);
  }
}
