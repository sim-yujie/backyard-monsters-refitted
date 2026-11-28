import { Migration } from "@mikro-orm/migrations";

/**
 * The Brukkarg event yards' per-player state (beta 10, bruk-port,
 * `services/events/yards/yardStore.ts`). Every player fights their own copy
 * of each event yard, which has no `save` row:
 *
 * - `bym.event_yard`: one row per player, event run and yard, made by the
 *   first attack that lands on it. `health` is the building health the last
 *   landing left (`buildinghealthdata`); the yard is whole again 24 hours
 *   after `first_attacked_at` unless `destroyed` (Flash: a damaged event yard
 *   repairs a day after the first hit). `looted` counts what the yard has
 *   given over the whole run, so a repaired yard gives no loot twice.
 * - `bym.event_yard_copy`: Brukkarg War's last yard, a copy of the player's
 *   own yard, snapshotted once per run when the yard is earned (its own table:
 *   `GET /bm/events` reads `event_progress.data` for every shown event, and a
 *   yard is tens of kilobytes).
 *
 * No entity: nothing but raw SQL touches them. Additive only. The rows of an
 * ended run are dead weight; `run_id` is indexed so a sweep can drop them.
 */
export class Migration20261210_CreateEventYards extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."event_yard" (
        "userid" integer NOT NULL,
        "run_id" text NOT NULL CHECK (length("run_id") BETWEEN 1 AND 64),
        "baseid" text NOT NULL CHECK (length("baseid") BETWEEN 1 AND 16),
        "health" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "destroyed" boolean NOT NULL DEFAULT false,
        "damage" smallint NOT NULL DEFAULT 0,
        "first_attacked_at" integer NOT NULL,
        "looted" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("userid", "run_id", "baseid")
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "event_yard_run" ON "bym"."event_yard" ("run_id");`);
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."event_yard_copy" (
        "userid" integer NOT NULL,
        "run_id" text NOT NULL CHECK (length("run_id") BETWEEN 1 AND 64),
        "yard" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("userid", "run_id")
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "event_yard_copy_run" ON "bym"."event_yard_copy" ("run_id");`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "bym"."event_yard_copy";`);
    this.addSql(`DROP TABLE IF EXISTS "bym"."event_yard";`);
  }
}
