import { Migration } from "@mikro-orm/migrations";

/**
 * Friend tests of a yard (beta 9 feature #4, `services/baiter/`):
 *
 * - `bym.baiter_invite`: one row per inviter and tester. An invite lasts 24 h
 *   (`expires_at`); `tests` counts the tests run on it. Gone with either account.
 * - `bym.baiter_test`: one row per finished test of the inviter's main yard,
 *   with its gzipped replay and report (`replay`, NULL when too big to keep).
 *   The inviter's newest 50 within 7 days are kept, pruned on every insert.
 *   Gone with the inviter; a deleted tester's rows keep the test under a
 *   deleted player's name (`services/privacy/deleteAccount.ts`).
 *
 * Additive only: two new tables and their indexes. Nothing existing changes.
 */
export class CreateBaiterTestTables extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."baiter_invite" (
        "inviter_userid" integer     NOT NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "tester_userid"  integer     NOT NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "created_at"     timestamptz NOT NULL,
        "expires_at"     timestamptz NOT NULL,
        "tests"          integer     NOT NULL DEFAULT 0,
        PRIMARY KEY ("inviter_userid", "tester_userid")
      );
    `);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "baiter_invite_tester_expires" ON "bym"."baiter_invite" ("tester_userid", "expires_at" DESC);`,
    );
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."baiter_test" (
        "id"              bigserial    PRIMARY KEY,
        "inviter_userid"  integer      NOT NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "tester_userid"   integer      NOT NULL,
        "tester_username" varchar(255) NOT NULL,
        "tester_pic"      text         NULL,
        "baseid"          varchar(255) NOT NULL,
        "fought_at"       timestamptz  NOT NULL,
        "damage"          integer      NOT NULL,
        "result"          varchar(16)  NOT NULL,
        "seconds"         integer      NOT NULL,
        "rules_version"   varchar(32)  NOT NULL,
        "has_report"      boolean      NOT NULL DEFAULT false,
        "replay"          bytea        NULL,
        "replay_bytes"    integer      NOT NULL DEFAULT 0
      );
    `);
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "baiter_test_inviter_fought_at" ON "bym"."baiter_test" ("inviter_userid", "fought_at" DESC);`,
    );
  }
}
