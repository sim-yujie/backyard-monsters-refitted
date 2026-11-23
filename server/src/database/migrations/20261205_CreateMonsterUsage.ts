import { Migration } from "@mikro-orm/migrations";

/**
 * Creates `bym.monster_usage` (patch 8.3, owner 23 Nov 2026): one compact row
 * per landed attack, for the dashboard's Monsters tab (which monsters players
 * fling, which camps they hit). Written after each landing commits, outside
 * its transaction (`services/stats/monsterUsage.ts`); read only by the
 * dashboard (`services/stats/monsterStats.ts`). Counting starts on the day
 * this runs: there is no history to fill.
 *
 * - `monsters`: `{"C5": {"l": 3, "f": 12, "x": 4}}`, each type's level,
 *   flung and (from a battle) lost; `champions`: `[{"c": "G2", "l": 4}]`.
 * - `replayed`: the server fought the battle; false for a landing with no
 *   battle (a replay that kept failing), whose monsters are the log's.
 * - `assumed`: an Inferno player attack with no battle record, landed as
 *   having used its whole army; its monsters are a worst case, not counted.
 * - The unique key makes a second write of one attack a no-op; `(day, mode)`
 *   serves the dashboard's period queries.
 *
 * No entity: nothing but raw SQL touches it, so `schema:create` never makes a
 * looser copy first. Additive only.
 */
export class Migration20261205_CreateMonsterUsage extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."monster_usage" (
        "id" bigserial PRIMARY KEY,
        "landed_at" timestamptz NOT NULL,
        "day" date NOT NULL,
        "attacker_userid" integer NOT NULL,
        "attack_started" integer NOT NULL,
        "attack_id" integer NOT NULL,
        "mode" varchar(6) NOT NULL CHECK ("mode" IN ('player', 'camp')),
        "arena" varchar(8) NOT NULL CHECK ("arena" IN ('mr1', 'mr2', 'inferno', 'descent')),
        "base_type" varchar(16) NULL,
        "repeat" boolean NOT NULL DEFAULT false,
        "defender_userid" integer NULL,
        "tribe" varchar(16) NULL,
        "camp_level" smallint NULL,
        "monsters" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "champions" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "damage_before" real NULL,
        "damage_after" real NULL,
        "flattened" boolean NOT NULL DEFAULT false,
        "replayed" boolean NOT NULL DEFAULT true,
        "assumed" boolean NOT NULL DEFAULT false
      );
    `);
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "monster_usage_attack_once"
        ON "bym"."monster_usage" ("attacker_userid", "attack_started", "attack_id");
    `);
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "monster_usage_day_mode"
        ON "bym"."monster_usage" ("day", "mode");
    `);
  }
}
