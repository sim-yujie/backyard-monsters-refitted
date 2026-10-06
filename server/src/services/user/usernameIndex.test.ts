import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The migration that makes usernames unique whatever their case (issue #216).
 * It runs against PostgreSQL only; this pins what it does, and what it must
 * never do, without a database. (Its SQL was also run by hand against a
 * throwaway table: it lists every clash and stops, and once the clashes are
 * gone the index refuses "ALICE" while "alice" exists.)
 */
const migration = readFileSync(
  path.join(import.meta.dirname, "../../database/migrations/20261006_AddUsernameLowerUniqueIndex.ts"),
  "utf8"
);

describe("the case-insensitive username index (#216)", () => {
  test("is a unique index on lower(username)", () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "user_username_lower_unique"\s+ON "bym"\."user" \(lower\("username"\)\)/
    );
  });

  test("stops first, naming every clash, when two accounts share a name in different case", () => {
    const guard = migration.indexOf("RAISE EXCEPTION");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(migration.indexOf("CREATE UNIQUE INDEX"));
    expect(migration).toContain('GROUP BY lower("username")');
    expect(migration).toContain("HAVING count(*) > 1");
  });

  test("never renames or removes an account to make room", () => {
    expect(migration).not.toMatch(/\b(UPDATE|DELETE|DROP)\b/i);
  });

  test("is named so register's race handling still says the username is taken", () => {
    // register.ts tells the two unique refusals apart by "email" in the message.
    expect("user_username_lower_unique").not.toContain("email");
  });
});
