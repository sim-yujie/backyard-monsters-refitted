import { Migration } from "@mikro-orm/migrations";

/**
 * Creates `bym.inferno_progress` (`docs/design/inferno.md` §3.1): one row per
 * player, the server's record of how far they are on the way into the
 * Inferno. Made the first time something is written for the player; a
 * player with no row has done nothing yet.
 *
 * - `emergence_level` (0-5) and `emergence_last_at`: the cave's level, one
 *   per emergence raid, and when it last went up (Flash's `lastLevel` and
 *   `lastTime` stats, `INFERNO_EMERGENCE_EVENT.as:111-119`).
 * - `descent_destroyed` and `descent_best`: the 13 Descent yards, a 0/1 flag
 *   each for beaten and the best damage (0-100) each attack reached;
 *   `descent_passed_at` once the 13th falls.
 * - `inferno_baseid`: the player's Inferno yard, made by the server at the
 *   capture.
 * - `korath_unlocked_at`, `korath_notice_at`: Korath unlocked by owning an
 *   Inferno yard, and when the player was told (owner I10).
 * - `popups_seen`: the one-time story popups shown, by key.
 *
 * Server-only: no client route writes it. Additive only: a new table. The
 * row goes with the account (the foreign key cascades, and
 * `services/privacy/deleteAccount.ts` lists the table).
 */
export class CreateInfernoProgressTable extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."inferno_progress" (
        "userid"             integer      NOT NULL PRIMARY KEY REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "emergence_level"    smallint     NOT NULL DEFAULT 0 CHECK ("emergence_level" BETWEEN 0 AND 5),
        "emergence_last_at"  timestamptz  NULL,
        "descent_destroyed"  jsonb        NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("descent_destroyed") = 'array'),
        "descent_best"       jsonb        NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("descent_best") = 'array'),
        "descent_passed_at"  timestamptz  NULL,
        "inferno_baseid"     varchar(255) NULL,
        "korath_unlocked_at" timestamptz  NULL,
        "korath_notice_at"   timestamptz  NULL,
        "popups_seen"        jsonb        NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof("popups_seen") = 'object'),
        "created_at"         timestamptz  NOT NULL DEFAULT now(),
        "updated_at"         timestamptz  NOT NULL DEFAULT now()
      );
    `);
  }
}
