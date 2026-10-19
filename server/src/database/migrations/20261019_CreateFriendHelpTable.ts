import { Migration } from "@mikro-orm/migrations";

/**
 * Creates `bym.friend_help` (`docs/design/friends.md` §6.1, issue #373): one
 * row per counted help, a speed-up or a repair in a friend's main yard. It is
 * both the daily cap's count (helper and UTC day, indexed) and the audit trail
 * of who helped whom (§7 rule 9). `reward` is what landed in the helper's
 * pool, per resource.
 *
 * Additive only: a new table and its indexes. Rows go with either player's
 * account (`services/privacy/deleteAccount.ts` deletes them, and the foreign
 * keys cascade) and after 90 days (`services/privacy/retention.ts`).
 */
export class CreateFriendHelpTable extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bym"."friend_help" (
        "id"             bigserial   PRIMARY KEY,
        "helper_userid"  integer     NOT NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "owner_userid"   integer     NOT NULL REFERENCES "bym"."user" ("userid") ON DELETE CASCADE,
        "baseid"         text        NOT NULL,
        "building_id"    integer     NOT NULL,
        "kind"           text        NOT NULL CHECK ("kind" IN ('speedup', 'repair')),
        "seconds_saved"  integer     NOT NULL DEFAULT 0,
        "reward"         jsonb       NOT NULL DEFAULT '{}'::jsonb,
        "help_day"       date        NOT NULL,
        "created_at"     timestamptz NOT NULL DEFAULT now(),
        CHECK ("helper_userid" <> "owner_userid")
      );
    `);
    // The daily cap: a helper's helps by UTC day.
    this.addSql(`CREATE INDEX IF NOT EXISTS "friend_help_helper_day" ON "bym"."friend_help" ("helper_userid", "help_day");`);
    // An owner's helps, for account deletion and later audits.
    this.addSql(`CREATE INDEX IF NOT EXISTS "friend_help_owner" ON "bym"."friend_help" ("owner_userid");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "friend_help_created" ON "bym"."friend_help" ("created_at");`);
  }
}
