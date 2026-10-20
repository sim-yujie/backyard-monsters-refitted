import { Migration } from "@mikro-orm/migrations";

/**
 * Creates `bym.event_progress` (`services/events/progressStore.ts`): one row
 * per player per event, made the first time the player does something in
 * it. It holds the login calendar (`calendar_days` claimed, the UTC day of
 * the last claim in `calendar_last`), a collection ladder (`counter`, and
 * the tiers claimed in `claimed_tiers`, a JSON array of indexes) and `data`
 * for anything else an event needs. Event ids are the config's
 * (`game-data/events/events.ts`), so there is no events table to point at.
 *
 * Also adds `bym.user.whatsnew_seen`: the last "What's new" release the
 * player has seen (`controllers/events/eventsState.ts`), null until the
 * first.
 *
 * Additive only: a new table, its index and a nullable column. The rows go
 * with the account (the foreign key cascades, and
 * `services/privacy/deleteAccount.ts` lists the table).
 */
export class CreateEventProgressTable extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."event_progress" (
        "userid"         integer     NOT NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "event_id"       text        NOT NULL CHECK (length("event_id") BETWEEN 1 AND 64),
        "calendar_days"  integer     NOT NULL DEFAULT 0 CHECK ("calendar_days" >= 0),
        "calendar_last"  date        NULL,
        "counter"        integer     NOT NULL DEFAULT 0 CHECK ("counter" >= 0),
        "claimed_tiers"  jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("claimed_tiers") = 'array'),
        "data"           jsonb       NOT NULL DEFAULT '{}'::jsonb,
        "created_at"     timestamptz NOT NULL DEFAULT now(),
        "updated_at"     timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("userid", "event_id")
      );
    `);
    // Everyone's progress in one event (counts, clean-up after it ends).
    this.addSql(`CREATE INDEX IF NOT EXISTS "event_progress_event" ON "bym"."event_progress" ("event_id");`);
    this.addSql(`ALTER TABLE "bym"."user" ADD COLUMN IF NOT EXISTS "whatsnew_seen" text NULL;`);
  }
}
