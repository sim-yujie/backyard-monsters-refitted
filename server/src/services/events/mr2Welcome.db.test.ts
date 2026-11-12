import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { SEVEN_SETS_DOWN, SEVEN_SETS_UP } from "../../database/migrations/20261116_Mr2WelcomeSevenSets.js";
import { forgetLaunchTime, LAUNCH_SETTING_KEY, MR2_WELCOME_SECONDS, MR2_WELCOME_SETS, sqlWelcomeStore as store } from "./mr2Welcome.js";

/**
 * The "New to Map Room 2" store against a real Postgres: once-ever start,
 * one of each reward a day, 7 of each, only inside the 10 days (also when two
 * transactions race), a claim rolled back with its transaction, and the
 * launch time written once.
 *
 * Opt-in: runs only when EVENTS_TEST_DB names a throwaway database with the
 * `bym` schema and the migrations applied, and refuses the shared `bym`.
 * Its players are `zz_mw_*`, user ids 995_101 and up.
 */
const dbName = process.env.EVENTS_TEST_DB;

const A = 995_101;
const B = 995_102;
const DAY = 86_400;
/** 08:00 UTC on 15 Jan 2027; the next daily reset is 16 hours later. */
const T0 = 1_800_000_000;
const MIDNIGHT = T0 + 16 * 3_600;

/** The migration's SQL kept to this test's players (the database may have others). */
const only = (query: string) => query.trim().replace(/;$/, ` AND userid IN (${A}, ${B})`);
const parsed = (data: unknown) => (typeof data === "string" ? (JSON.parse(data) as unknown) : data);

describe.skipIf(!dbName)("Map Room 2 welcome on a real database", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);
  let savedLaunch: unknown[] = [];

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("EVENTS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 10 } });
    for (const userid of [A, B]) {
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, `zz_mw_${userid}`, `zz_mw_${userid}@test.invalid`]
      );
    }
    savedLaunch = await sql(`SELECT value FROM bym.game_setting WHERE key = ?`, [LAUNCH_SETTING_KEY]);
  });

  beforeEach(async () => {
    await sql(`DELETE FROM bym.event_progress WHERE userid IN (?, ?)`, [A, B]);
  });

  afterAll(async () => {
    if (!orm) return;
    await sql(`DELETE FROM bym."user" WHERE userid IN (?, ?)`, [A, B]);
    if (savedLaunch.length === 0) await sql(`DELETE FROM bym.game_setting WHERE key = ?`, [LAUNCH_SETTING_KEY]);
    forgetLaunchTime();
    await orm.close();
  });

  test("the start is written once, ever", async () => {
    await store.start(em(), A, T0);
    await store.start(em(), A, T0 + 999);
    expect(await store.read(em(), A)).toEqual({ start: T0, takeoverUses: [], kitUses: [], takeoverDay: null, kitDay: null });
    expect(await store.read(em(), B)).toBeNull();
  });

  test("one of each a UTC day, 7 of each, only inside the 10 days", async () => {
    await store.start(em(), A, T0);
    expect(await store.claim(em(), A, "takeover", T0 - 1)).toBe(false);
    expect(await store.claim(em(), A, "takeover", T0 + MR2_WELCOME_SECONDS)).toBe(false);
    expect(await store.claim(em(), A, "takeover", T0 + 5)).toBe(true);
    expect(await store.claim(em(), A, "takeover", T0 + 6)).toBe(false);
    expect(await store.claim(em(), A, "kit", T0 + 6)).toBe(true);
    // When each was used and the day of the last use are kept.
    expect(await store.read(em(), A)).toEqual({
      start: T0,
      takeoverUses: [T0 + 5],
      kitUses: [T0 + 6],
      takeoverDay: "2027-01-15",
      kitDay: "2027-01-15",
    });
    // After the reset (UTC midnight) another; seven in all.
    expect(await store.claim(em(), A, "takeover", MIDNIGHT - 1)).toBe(false);
    for (let day = 0; day < 6; day++) expect(await store.claim(em(), A, "takeover", MIDNIGHT + day * DAY)).toBe(true);
    expect(await store.claim(em(), A, "takeover", MIDNIGHT + 6 * DAY)).toBe(false);
    expect((await store.read(em(), A))!.takeoverUses).toHaveLength(MR2_WELCOME_SETS);
    expect(await store.claim(em(), A, "kit", MIDNIGHT + 6 * DAY)).toBe(true);
    expect(await store.claim(em(), B, "kit", T0 + 5)).toBe(false);
  });

  test("a one-set row: read and claimed as 1 of 7, and moved by the migration", async () => {
    // Used the takeover on day 1 (known time) and the kit (time not kept).
    const legacy = { start: T0, takeoverUsed: true, kitUsed: true, takeoverAt: T0 + 5 };
    await sql(`INSERT INTO bym.event_progress (userid, event_id, data) VALUES (?, 'mr2-welcome', ?::jsonb)`, [A, JSON.stringify(legacy)]);
    expect(await store.read(em(), A)).toEqual({
      start: T0,
      takeoverUses: [T0 + 5],
      kitUses: [null],
      takeoverDay: "2027-01-15",
      kitDay: null,
    });
    expect(await store.claim(em(), A, "takeover", T0 + 60)).toBe(false);
    expect(await store.claim(em(), A, "kit", T0 + 60)).toBe(true);
    expect((await store.read(em(), A))!.kitUses).toEqual([null, T0 + 60]);

    await sql(`DELETE FROM bym.event_progress WHERE userid = ?`, [A]);
    await sql(`INSERT INTO bym.event_progress (userid, event_id, data) VALUES (?, 'mr2-welcome', ?::jsonb)`, [A, JSON.stringify(legacy)]);
    await sql(`INSERT INTO bym.event_progress (userid, event_id, data) VALUES (?, 'mr2-welcome', ?::jsonb)`, [
      B,
      JSON.stringify({ start: T0, takeoverUsed: false, kitUsed: false }),
    ]);
    await sql(only(SEVEN_SETS_UP));
    const [row] = await sql<{ data: unknown }>(`SELECT data FROM bym.event_progress WHERE userid = ?`, [A]);
    expect(parsed(row!.data)).toEqual({ start: T0, takeoverUses: [T0 + 5], kitUses: [null], takeoverDay: "2027-01-15", kitDay: null });
    expect(await store.read(em(), B)).toEqual({ start: T0, takeoverUses: [], kitUses: [], takeoverDay: null, kitDay: null });
    // Run again: nothing changes.
    await sql(only(SEVEN_SETS_UP));
    expect(await store.read(em(), A)).toMatchObject({ takeoverUses: [T0 + 5], kitUses: [null] });
    // And back.
    await sql(only(SEVEN_SETS_DOWN));
    const [back] = await sql<{ data: unknown }>(`SELECT data FROM bym.event_progress WHERE userid = ?`, [A]);
    expect(parsed(back!.data)).toEqual({ start: T0, takeoverUsed: true, kitUsed: true, takeoverAt: T0 + 5, kitAt: null });
  });

  test("two racing claims: only one wins", async () => {
    await store.start(em(), A, T0);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => orm.em.fork().transactional((tx) => store.claim(tx, A, "kit", T0 + 10)))
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("a claim in a transaction that fails is given back", async () => {
    await store.start(em(), A, T0);
    await expect(
      orm.em.fork().transactional(async (tx) => {
        expect(await store.claim(tx, A, "takeover", T0 + 10)).toBe(true);
        throw new Error("refused later");
      })
    ).rejects.toThrow("refused later");
    expect((await store.read(em(), A))!.takeoverUses).toEqual([]);
  });

  test("the launch time is written by the first ask and kept", async () => {
    await sql(`DELETE FROM bym.game_setting WHERE key = ?`, [LAUNCH_SETTING_KEY]);
    forgetLaunchTime();
    expect(await store.launchTime(em(), T0)).toBe(T0);
    forgetLaunchTime();
    expect(await store.launchTime(em(), T0 + 500)).toBe(T0);
    if (savedLaunch.length > 0) {
      await sql(`UPDATE bym.game_setting SET value = ?::jsonb WHERE key = ?`, [
        JSON.stringify((savedLaunch[0] as { value: unknown }).value),
        LAUNCH_SETTING_KEY,
      ]);
    }
  });
});
