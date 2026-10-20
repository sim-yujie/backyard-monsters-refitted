import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import { CreateEventProgressTable } from "../../database/migrations/20261020_CreateEventProgressTable.js";
import ormConfig from "../../mikro-orm.config.js";
import { sqlProgressStore as store } from "./progressStore.js";

/**
 * `bym.event_progress` and its store against a real Postgres: the migration
 * (shape, run twice, foreign key), and each write's rule holding under
 * racing transactions.
 *
 * Opt-in: runs only when EVENTS_TEST_DB names a throwaway database with the
 * `bym` schema and the migrations applied, and refuses the shared `bym`.
 * Its players are `zz_ev_*`, user ids 995_000 and up.
 */
const dbName = process.env.EVENTS_TEST_DB;

const A = 995_001;
const B = 995_002;
const EVENT = "zz-test-event";

describe.skipIf(!dbName)("event progress on a real database", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("EVENTS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 10 } });
    for (const userid of [A, B]) {
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, `zz_ev_${userid}`, `zz_ev_${userid}@test.invalid`]
      );
    }
  });

  beforeEach(async () => {
    await sql(`DELETE FROM bym.event_progress WHERE userid IN (?, ?)`, [A, B]);
  });

  afterAll(async () => {
    if (!orm) return;
    await sql(`DELETE FROM bym."user" WHERE userid IN (?, ?)`, [A, B]);
    await orm.close();
  });

  test("the migration is additive and can run again", async () => {
    const migration = new CreateEventProgressTable(orm.em.getDriver(), orm.config);
    await migration.up();
    for (const query of migration.getQueries()) await sql(String(query));

    const columns = await sql<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'bym' AND table_name = 'event_progress' ORDER BY ordinal_position`
    );
    expect(columns.map((one) => one.column_name)).toEqual([
      "userid",
      "event_id",
      "calendar_days",
      "calendar_last",
      "counter",
      "claimed_tiers",
      "data",
      "created_at",
      "updated_at",
    ]);
    const [seen] = await sql(
      `SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'bym' AND table_name = 'user' AND column_name = 'whatsnew_seen'`
    );
    expect(seen).toEqual({ is_nullable: "YES" });
  });

  test("a calendar claim lands once per UTC day, up to the calendar's length", async () => {
    expect(await store.claimCalendarDay(em(), A, EVENT, "2026-10-28", 3)).toBe(1);
    expect(await store.claimCalendarDay(em(), A, EVENT, "2026-10-28", 3)).toBeNull();
    // A clock that went backwards claims nothing either.
    expect(await store.claimCalendarDay(em(), A, EVENT, "2026-10-27", 3)).toBeNull();
    expect(await store.claimCalendarDay(em(), A, EVENT, "2026-10-30", 3)).toBe(2);
    expect(await store.claimCalendarDay(em(), A, EVENT, "2026-10-31", 3)).toBe(3);
    expect(await store.claimCalendarDay(em(), A, EVENT, "2026-11-01", 3)).toBeNull();

    const progress = (await store.read(em(), A, [EVENT, "other"])).get(EVENT);
    expect(progress).toMatchObject({ calendarDays: 3, calendarLast: "2026-10-31", counter: 0, claimedTiers: [] });
    expect((await store.read(em(), B, [EVENT])).size).toBe(0);
  });

  test("racing claims of the same day: exactly one lands, first claim and later ones alike", async () => {
    const race = (day: string) =>
      Promise.all(
        Array.from({ length: 6 }, () => em().transactional((tx) => store.claimCalendarDay(tx, A, EVENT, day, 14)))
      );

    const first = await race("2026-10-28");
    expect(first.filter((day) => day !== null)).toEqual([1]);
    const second = await race("2026-10-29");
    expect(second.filter((day) => day !== null)).toEqual([2]);
  });

  test("ladder tiers: the counter adds up, a tier lands once and only once reached", async () => {
    expect(await store.claimTier(em(), A, EVENT, 0, 1)).toBe(false);
    expect(await store.addToCounter(em(), A, EVENT, 2)).toBe(2);
    expect(await store.addToCounter(em(), A, EVENT, 3)).toBe(5);
    expect(await store.claimTier(em(), A, EVENT, 1, 10)).toBe(false);

    const racing = await Promise.all(
      Array.from({ length: 5 }, () => em().transactional((tx) => store.claimTier(tx, A, EVENT, 0, 5)))
    );
    expect(racing.filter(Boolean)).toHaveLength(1);
    expect((await store.read(em(), A, [EVENT])).get(EVENT)).toMatchObject({ counter: 5, claimedTiers: [0] });
  });

  test("progress goes with the account", async () => {
    await store.addToCounter(em(), B, EVENT, 1);
    await sql(`DELETE FROM bym."user" WHERE userid = ?`, [B]);
    expect(await sql(`SELECT 1 FROM bym.event_progress WHERE userid = ?`, [B])).toEqual([]);
    await sql(
      `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
      [B, `zz_ev_${B}`, `zz_ev_${B}@test.invalid`]
    );
  });

  test("an unknown player cannot have progress", async () => {
    await expect(store.addToCounter(em(), 995_999, EVENT, 1)).rejects.toThrow();
  });
});
