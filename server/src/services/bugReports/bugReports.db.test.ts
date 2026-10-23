import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import { CreateBugReportTable } from "../../database/migrations/20261021_CreateBugReportTable.js";
import ormConfig from "../../mikro-orm.config.js";
import { sqlBugReportStore as store, type BugReportRow } from "./bugReports.js";

/**
 * `bym.bug_report` and its store against a real Postgres: the migration
 * (shape, run twice), the pictures' bytes kept as they were, the daily
 * count, the emailed mark, and a player's reports going with the account.
 *
 * Opt-in: runs only when BUG_REPORT_TEST_DB names a throwaway database with
 * the `bym` schema and the migrations applied, and refuses the shared `bym`.
 * Its player is `zz_br_*`, user id 996_001.
 */
const dbName = process.env.BUG_REPORT_TEST_DB;

const A = 996_001;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x01, 0x02, 0xfe]);

const rowOf = (extra: Partial<BugReportRow> = {}): BugReportRow => ({
  userid: A,
  username: `zz_br_${A}`,
  contactEmail: null,
  ipHash: null,
  message: "The map will not open",
  gameVersion: "2.0.0-beta.4",
  screen: "maproom2",
  device: "computer",
  userAgent: "test",
  screenSize: "1280x720",
  errors: ["one", "two"],
  screenshot: { type: "image/jpeg", bytes: JPEG },
  picture: null,
  ...extra,
});

describe.skipIf(!dbName)("bug reports on a real database", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("BUG_REPORT_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    await sql(
      `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
      [A, `zz_br_${A}`, `zz_br_${A}@test.invalid`]
    );
  });

  beforeEach(async () => {
    await sql(`DELETE FROM bym.bug_report WHERE userid = ? OR ip_hash = 'zz-test-hash'`, [A]);
  });

  afterAll(async () => {
    if (!orm) return;
    await sql(`DELETE FROM bym.bug_report WHERE ip_hash = 'zz-test-hash'`);
    await sql(`DELETE FROM bym."user" WHERE userid = ?`, [A]);
    await orm.close();
  });

  test("the migration is additive and can run again", async () => {
    const migration = new CreateBugReportTable(orm.em.getDriver(), orm.config);
    await migration.up();
    for (const query of migration.getQueries()) await sql(String(query));

    const columns = await sql<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'bym' AND table_name = 'bug_report' ORDER BY ordinal_position`
    );
    // The dashboard's migration (20261023) adds its ticket columns after these.
    expect(columns.map((one) => one.column_name).slice(0, 18)).toEqual([
      "id",
      "userid",
      "username",
      "contact_email",
      "ip_hash",
      "message",
      "game_version",
      "screen",
      "device",
      "user_agent",
      "screen_size",
      "errors",
      "screenshot",
      "screenshot_type",
      "picture",
      "picture_type",
      "emailed_at",
      "created_at",
    ]);
  });

  test("a report keeps its words, errors and picture bytes, and is counted and marked emailed", async () => {
    const id = await store.insert(em(), rowOf());
    expect(id).toBeGreaterThan(0);

    const [row] = await sql(`SELECT * FROM bym.bug_report WHERE id = ?`, [id]);
    expect(row).toMatchObject({ userid: A, message: "The map will not open", errors: ["one", "two"], screenshot_type: "image/jpeg" });
    expect(Buffer.compare(Buffer.from(row.screenshot), JPEG)).toBe(0);
    expect(row.picture).toBeNull();
    expect(row.emailed_at).toBeNull();

    await store.markEmailed(em(), id);
    const [marked] = await sql(`SELECT emailed_at FROM bym.bug_report WHERE id = ?`, [id]);
    expect(marked.emailed_at).not.toBeNull();

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    expect(await store.countSince(em(), { userid: A }, hourAgo)).toBe(1);
    expect(await store.countSince(em(), { userid: A }, new Date(Date.now() + 60_000))).toBe(0);
  });

  test("signed-out reports are counted by their address's hash", async () => {
    const guest = rowOf({ userid: null, username: null, contactEmail: "x@test.invalid", ipHash: "zz-test-hash" });
    await store.insert(em(), guest);
    await store.insert(em(), guest);
    const since = new Date(Date.now() - 60_000);
    expect(await store.countSince(em(), { ipHash: "zz-test-hash" }, since)).toBe(2);
    expect(await store.countSince(em(), { ipHash: "other" }, since)).toBe(0);
  });

  test("a player's reports go with their account", async () => {
    const B = A + 1;
    await sql(
      `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
      [B, `zz_br_${B}`, `zz_br_${B}@test.invalid`]
    );
    await store.insert(em(), rowOf({ userid: B }));
    await sql(`DELETE FROM bym."user" WHERE userid = ?`, [B]);
    expect(await sql(`SELECT 1 FROM bym.bug_report WHERE userid = ?`, [B])).toEqual([]);
  });
});
