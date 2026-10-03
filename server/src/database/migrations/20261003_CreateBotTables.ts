import { Migration } from "@mikro-orm/migrations";

/**
 * Creates the server-only tables for Map Room 1 bot neighbours and adds
 * user.last_seen_at (issue #235, `docs/design/bot-neighbours.md` §5).
 *
 * - `bym.bot`: one row per bot account. Being in this table is what makes a
 *   user a bot, so nothing on `user` or `save` says so and no existing query,
 *   field list or `@FrontendKey` serialisation can carry it to a client.
 * - `bym.bot_job`: work due at a future time per bot (grow, repair, revenge,
 *   truce decline), claimed by the bot sweep. The partial unique indexes allow
 *   one pending grow and one repair per bot, and one pending revenge per bot
 *   and player.
 * - `user.last_seen_at`: when the owner last loaded their own yard, written at
 *   most once an hour (`services/user/lastSeen.ts`), for the neighbour search's
 *   "seen in the last 30 days" rule. Existing rows start null (not seen).
 */
export class CreateBotTables extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."bot" (
        "userid"      integer     PRIMARY KEY REFERENCES "bym"."user" ("userid"),
        "seed"        bigint      NOT NULL,
        "persona"     text        NOT NULL,
        "level"       integer     NOT NULL,
        "level_since" timestamptz NOT NULL,
        "state"       text        NOT NULL DEFAULT 'active',
        "created_at"  timestamptz NOT NULL DEFAULT now(),
        "retired_at"  timestamptz NULL
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "bot_state_level" ON "bym"."bot" ("state", "level");`);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."bot_job" (
        "id"            bigserial   PRIMARY KEY,
        "bot_userid"    integer     NOT NULL REFERENCES "bym"."bot" ("userid"),
        "kind"          text        NOT NULL,
        "target_userid" integer     NULL,
        "due_at"        timestamptz NOT NULL,
        "giveup_at"     timestamptz NULL,
        "attempts"      integer     NOT NULL DEFAULT 0,
        "payload"       jsonb       NOT NULL DEFAULT '{}',
        "created_at"    timestamptz NOT NULL DEFAULT now()
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "bot_job_due" ON "bym"."bot_job" ("due_at");`);
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "bot_job_one_grow" ON "bym"."bot_job" ("bot_userid") WHERE "kind" = 'grow';`,
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "bot_job_one_repair" ON "bym"."bot_job" ("bot_userid") WHERE "kind" = 'repair';`,
    );
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "bot_job_one_revenge" ON "bym"."bot_job" ("bot_userid", "target_userid") WHERE "kind" = 'revenge';`,
    );

    this.addSql(`
      ALTER TABLE "bym"."user"
        ADD COLUMN IF NOT EXISTS "last_seen_at" timestamptz NULL;
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "user_last_seen_at_index" ON "bym"."user" ("last_seen_at");`);
  }
}
