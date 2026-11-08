import { Migration } from "@mikro-orm/migrations";

/**
 * Event coins (beta 7 grill item 29, `services/events/eventCoins.ts`): the
 * currency events pay and the decorations shop takes.
 *
 * - `bym.event_coins`: one row per player who has ever had a coin, made at
 *   the first one. `balance` never goes below 0 (the CHECK is the last line
 *   behind the spend statement's own condition); `earned` and `spent` are
 *   running totals for the dashboard and support.
 * - `bym.event_coin_log`: every change, `amount` positive for coins earned
 *   and negative for coins spent, with a short `reason`. An award that may
 *   be paid only once (a weekend event's "played" or "boost") carries an
 *   `award_key`; the partial unique index makes a second payment of the
 *   same key impossible, however many requests race for it.
 *
 * Additive only: two new tables and their indexes. The rows go with the
 * account (the foreign keys cascade, and `services/privacy/deleteAccount.ts`
 * lists both tables).
 */
export class CreateEventCoinsTables extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."event_coins" (
        "userid"      integer     NOT NULL PRIMARY KEY REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "balance"     integer     NOT NULL DEFAULT 0 CHECK ("balance" >= 0),
        "earned"      integer     NOT NULL DEFAULT 0 CHECK ("earned" >= 0),
        "spent"       integer     NOT NULL DEFAULT 0 CHECK ("spent" >= 0),
        "updated_at"  timestamptz NOT NULL DEFAULT now()
      );
    `);
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."event_coin_log" (
        "id"          bigserial   PRIMARY KEY,
        "userid"      integer     NOT NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "amount"      integer     NOT NULL CHECK ("amount" <> 0),
        "reason"      text        NOT NULL CHECK (length("reason") BETWEEN 1 AND 64),
        "award_key"   text        NULL CHECK ("award_key" IS NULL OR length("award_key") BETWEEN 1 AND 96),
        "created_at"  timestamptz NOT NULL DEFAULT now()
      );
    `);
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "event_coin_log_award" ON "bym"."event_coin_log" ("userid", "award_key") WHERE "award_key" IS NOT NULL;`
    );
    this.addSql(`CREATE INDEX IF NOT EXISTS "event_coin_log_user" ON "bym"."event_coin_log" ("userid", "created_at");`);
  }
}
