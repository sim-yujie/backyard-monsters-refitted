import { Migration } from "@mikro-orm/migrations";

/**
 * Creates the friends tables (`docs/design/friends.md` §6.1, issue #368):
 *
 * - `bym.friend`: two rows per friendship, one each way; `created_at` is
 *   "friends since".
 * - `bym.friend_request`: one row per request, `pending` until it is
 *   accepted, declined, cancelled or lapses (`expired`). At most one
 *   `pending` row per ordered pair (a partial unique index).
 *
 * and gives `bym.user` the two privacy switches of §3.6, `hide_online` and
 * `friend_requests_off`, both off. `friendcount` is recounted from the new
 * table (0 for everyone, as nothing is in it yet), so it starts equal to the
 * real count.
 *
 * Additive only: new tables, new columns with defaults, and indexes. Rows go
 * with either player's account (`services/privacy/deleteAccount.ts` deletes
 * them; the foreign keys cascade too where this migration made the table).
 */
export class CreateFriendTables extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."friend" (
        "userid"         integer     NOT NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "friend_userid"  integer     NOT NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "created_at"     timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("userid", "friend_userid"),
        CHECK ("userid" <> "friend_userid")
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "friend_friend_userid" ON "bym"."friend" ("friend_userid");`);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."friend_request" (
        "id"           bigserial   PRIMARY KEY,
        "from_userid"  integer     NOT NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "to_userid"    integer     NOT NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "status"       text        NOT NULL DEFAULT 'pending'
                       CHECK ("status" IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
        "created_at"   timestamptz NOT NULL DEFAULT now(),
        "answered_at"  timestamptz NULL,
        CHECK ("from_userid" <> "to_userid")
      );
    `);
    // One waiting request per ordered pair; the second ask is refused or, the other way, accepts.
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "friend_request_one_pending" ON "bym"."friend_request" ("from_userid", "to_userid") WHERE "status" = 'pending';`,
    );
    // A player's incoming requests, and their sent ones by day (the daily cap).
    this.addSql(`CREATE INDEX IF NOT EXISTS "friend_request_to_status" ON "bym"."friend_request" ("to_userid", "status");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "friend_request_from_created" ON "bym"."friend_request" ("from_userid", "created_at");`);

    this.addSql(`ALTER TABLE "bym"."user" ADD COLUMN IF NOT EXISTS "hide_online" boolean NOT NULL DEFAULT false;`);
    this.addSql(`ALTER TABLE "bym"."user" ADD COLUMN IF NOT EXISTS "friend_requests_off" boolean NOT NULL DEFAULT false;`);

    this.addSql(`
      UPDATE "bym"."user" u SET "friendcount" = c.n
        FROM (SELECT u2."userid", (SELECT count(*) FROM "bym"."friend" f WHERE f."userid" = u2."userid")::int AS n
                FROM "bym"."user" u2) c
       WHERE c."userid" = u."userid" AND u."friendcount" IS DISTINCT FROM c.n;
    `);
  }
}
