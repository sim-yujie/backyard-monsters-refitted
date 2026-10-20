import { describe, expect, test } from "bun:test";
import {
  AddMissingForeignKeys,
  MISSING_FOREIGN_KEYS,
} from "./migrations/20261020_AddMissingForeignKeys";

/**
 * The migration that adds the foreign keys a fresh `db:init` skipped (#365).
 * It runs against PostgreSQL only; this pins what it does without a database.
 * (It was also run by hand on a fresh `db:init` database seeded with rows
 * pointing at missing accounts and replays: afterwards its keys matched the
 * dev database's exactly, only the broken rows were gone or unlinked, and a
 * second run changed nothing.)
 */
const keyOf = (table: string, column: string) =>
  MISSING_FOREIGN_KEYS.find((fk) => fk.table === table && fk.column === column);

describe("the missing foreign keys migration (#365)", () => {
  test("covers every key a fresh database was missing", () => {
    expect(MISSING_FOREIGN_KEYS.map((fk) => fk.name).sort()).toEqual([
      "bot_job_bot_userid_fkey",
      "bot_userid_fkey",
      "defence_replay_defender_userid_fkey",
      "friend_friend_userid_fkey",
      "friend_request_from_userid_fkey",
      "friend_request_to_userid_fkey",
      "friend_userid_fkey",
      "message_replayid_fkey",
      "notification_userid_fkey",
    ]);
  });

  test("keeps the delete rules of the migrations that first made these tables", () => {
    expect(keyOf("notification", "userid")?.onDelete).toBe("CASCADE");
    expect(keyOf("defence_replay", "defender_userid")?.onDelete).toBe("CASCADE");
    expect(keyOf("message", "replayid")?.onDelete).toBe("SET NULL");
    expect(keyOf("friend", "userid")?.onDelete).toBe("CASCADE");
    expect(keyOf("bot", "userid")?.onDelete).toBeNull();
    expect(keyOf("bot_job", "bot_userid")?.onDelete).toBeNull();
  });

  test("checks the bots before their jobs", () => {
    const names = MISSING_FOREIGN_KEYS.map((fk) => fk.name);
    expect(names.indexOf("bot_userid_fkey")).toBeLessThan(names.indexOf("bot_job_bot_userid_fkey"));
  });

  test("adds a key, and touches rows, only when that key is missing", () => {
    for (const fk of MISSING_FOREIGN_KEYS) {
      const sql = AddMissingForeignKeys.addForeignKeySql(fk);
      const guard = sql.indexOf("IF NOT EXISTS");
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(sql.indexOf(fk.cleanup));
      expect(sql.indexOf(fk.cleanup)).toBeLessThan(sql.indexOf("ADD CONSTRAINT"));
      expect(sql).toContain(`a.attname = '${fk.column}'`);
    }
  });

  test("unlinks a notice from a missing replay rather than deleting the notice", () => {
    const cleanup = keyOf("message", "replayid")!.cleanup;
    expect(cleanup).toMatch(/^UPDATE "bym"\."message" SET "replayid" = NULL/);
    expect(cleanup).not.toMatch(/\bDELETE\b/);
  });

  test("never drops or changes a column or table", () => {
    for (const fk of MISSING_FOREIGN_KEYS) {
      expect(AddMissingForeignKeys.addForeignKeySql(fk)).not.toMatch(/\bDROP\b|ALTER COLUMN|TRUNCATE/i);
    }
  });
});
