import { Migration } from "@mikro-orm/migrations";

/**
 * Creates bym.defence_replay, one row per landed attack on a player's main
 * yard, kept so the defender can watch it (`docs/design/defence-replays.md`
 * §3, issue #358), and gives mail messages a `replayid` for the "attacked your
 * yard" notice's Watch button (§8).
 *
 * `replay` is the gzipped payload (the yard as fought, the drops, the seed,
 * both sides' levels), null when its inputs were missing. `rules_version` is
 * the combat rules' manifest version the battle was fought under. The server
 * keeps the newest 20 per defender, pruned on every insert
 * (`services/defences/defenceReplayStore.ts`); the rows go with the defender.
 * A pruned replay clears the notice's `replayid`.
 *
 * Additive only: a new table, a new nullable column and two indexes. Nothing
 * existing is changed or removed, and no row is backfilled (older attacks
 * kept no inputs).
 */
export class CreateDefenceReplayTable extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."defence_replay" (
        "id"                  bigserial    PRIMARY KEY,
        "defender_userid"     integer      NOT NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "baseid"              varchar(255) NOT NULL,
        "map_version"         smallint     NOT NULL,
        "attacker_userid"     integer      NOT NULL,
        "attacker_username"   varchar(255) NOT NULL,
        "attacker_pic_square" text         NULL,
        "attacked_at"         timestamptz  NOT NULL,
        "landed_at"           timestamptz  NOT NULL,
        "damage_before"       integer      NOT NULL,
        "damage_after"        integer      NOT NULL,
        "loot"                jsonb        NOT NULL,
        "housed_lost"         integer      NOT NULL,
        "attacker_left"       boolean      NOT NULL,
        "rules_version"       varchar(32)  NOT NULL,
        "replay"              bytea        NULL,
        "replay_bytes"        integer      NOT NULL
      );
    `);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "defence_replay_defender_landed_at" ON "bym"."defence_replay" ("defender_userid", "landed_at" DESC);`,
    );
    this.addSql(
      `ALTER TABLE "bym"."message" ADD COLUMN IF NOT EXISTS "replayid" bigint NULL REFERENCES "bym"."defence_replay" ("id") ON DELETE SET NULL;`,
    );
    // Pruning a replay looks up the notices that point at it.
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "message_replayid" ON "bym"."message" ("replayid") WHERE "replayid" IS NOT NULL;`,
    );
  }
}
