import { Migration } from "@mikro-orm/migrations";

/**
 * Adds the foreign keys a brand-new database never got (issue #365).
 *
 * `bun run db:init` runs `schema:create` before the migrations. That builds
 * every table that has an entity straight from the entity, and the entities
 * below declare plain columns, not relations, so the tables come out with no
 * foreign keys. The migrations that would have added them use
 * `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, find the table or
 * column already there, and skip. Databases that took the migration path (dev,
 * and tables added to a live database after it was set up) already have them.
 *
 * Each key below is only added when no foreign key on that column to that
 * table exists yet, whatever its name, so a database that already has it is
 * left exactly as it is. Where one is missing, rows that would break it are
 * dealt with first, the same way the key would have dealt with them had it
 * been there: rows owned by an account that no longer exists are removed, and
 * a notice's link to a replay that is gone is cleared. A NOTICE names each
 * table and how many rows were touched.
 */

export interface MissingForeignKey {
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
  name: string;
  onDelete: "CASCADE" | "SET NULL" | null;
  /** Makes the existing rows fit the key; runs only when the key is added. */
  cleanup: string;
}

const orphansOf = (table: string, column: string, refTable: string, refColumn: string) =>
  `"${table}"."${column}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "bym"."${refTable}" r WHERE r."${refColumn}" = "${table}"."${column}")`;

const deleteOrphans = (table: string, column: string, refTable: string, refColumn: string) =>
  `DELETE FROM "bym"."${table}" WHERE ${orphansOf(table, column, refTable, refColumn)}`;

/** In order: a bot's jobs are checked after the bots themselves. */
export const MISSING_FOREIGN_KEYS: MissingForeignKey[] = [
  {
    table: "notification",
    column: "userid",
    refTable: "user",
    refColumn: "userid",
    name: "notification_userid_fkey",
    onDelete: "CASCADE",
    cleanup: deleteOrphans("notification", "userid", "user", "userid"),
  },
  {
    table: "bot",
    column: "userid",
    refTable: "user",
    refColumn: "userid",
    name: "bot_userid_fkey",
    onDelete: null,
    // A bot whose account is gone takes its queued jobs with it.
    cleanup: `DELETE FROM "bym"."bot_job" WHERE "bot_userid" IN (SELECT "userid" FROM "bym"."bot" WHERE ${orphansOf("bot", "userid", "user", "userid")}); ${deleteOrphans("bot", "userid", "user", "userid")}`,
  },
  {
    table: "bot_job",
    column: "bot_userid",
    refTable: "bot",
    refColumn: "userid",
    name: "bot_job_bot_userid_fkey",
    onDelete: null,
    cleanup: deleteOrphans("bot_job", "bot_userid", "bot", "userid"),
  },
  {
    table: "defence_replay",
    column: "defender_userid",
    refTable: "user",
    refColumn: "userid",
    name: "defence_replay_defender_userid_fkey",
    onDelete: "CASCADE",
    cleanup: deleteOrphans("defence_replay", "defender_userid", "user", "userid"),
  },
  {
    table: "message",
    column: "replayid",
    refTable: "defence_replay",
    refColumn: "id",
    name: "message_replayid_fkey",
    onDelete: "SET NULL",
    cleanup: `UPDATE "bym"."message" SET "replayid" = NULL WHERE ${orphansOf("message", "replayid", "defence_replay", "id")}`,
  },
  {
    table: "friend",
    column: "userid",
    refTable: "user",
    refColumn: "userid",
    name: "friend_userid_fkey",
    onDelete: "CASCADE",
    cleanup: deleteOrphans("friend", "userid", "user", "userid"),
  },
  {
    table: "friend",
    column: "friend_userid",
    refTable: "user",
    refColumn: "userid",
    name: "friend_friend_userid_fkey",
    onDelete: "CASCADE",
    cleanup: deleteOrphans("friend", "friend_userid", "user", "userid"),
  },
  {
    table: "friend_request",
    column: "from_userid",
    refTable: "user",
    refColumn: "userid",
    name: "friend_request_from_userid_fkey",
    onDelete: "CASCADE",
    cleanup: deleteOrphans("friend_request", "from_userid", "user", "userid"),
  },
  {
    table: "friend_request",
    column: "to_userid",
    refTable: "user",
    refColumn: "userid",
    name: "friend_request_to_userid_fkey",
    onDelete: "CASCADE",
    cleanup: deleteOrphans("friend_request", "to_userid", "user", "userid"),
  },
];

// The migrator runs a file's first exported function, so the SQL builder is a
// static method here rather than an export of its own.
export class AddMissingForeignKeys extends Migration {
  /** One guarded block: adds the key (after its cleanup) only if it is missing. */
  static addForeignKeySql(fk: MissingForeignKey): string {
    const onDelete = fk.onDelete ? ` ON DELETE ${fk.onDelete}` : "";
    return `
      DO $$
      DECLARE touched bigint;
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
          WHERE c.contype = 'f'
            AND c.conrelid = '"bym"."${fk.table}"'::regclass
            AND c.confrelid = '"bym"."${fk.refTable}"'::regclass
            AND array_length(c.conkey, 1) = 1
            AND a.attname = '${fk.column}'
        ) THEN
          ${fk.cleanup};
          GET DIAGNOSTICS touched = ROW_COUNT;
          RAISE NOTICE '%: % row(s) fixed before adding %', '${fk.table}', touched, '${fk.name}';
          ALTER TABLE "bym"."${fk.table}"
            ADD CONSTRAINT "${fk.name}"
            FOREIGN KEY ("${fk.column}") REFERENCES "bym"."${fk.refTable}" ("${fk.refColumn}")${onDelete};
        END IF;
      END $$;
    `;
  }

  async up(): Promise<void> {
    for (const fk of MISSING_FOREIGN_KEYS) {
      this.addSql(AddMissingForeignKeys.addForeignKeySql(fk));
    }
  }
}
