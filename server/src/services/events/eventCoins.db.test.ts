import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import { CreateEventCoinsTables } from "../../database/migrations/20261113_CreateEventCoinsTables.js";
import ormConfig from "../../mikro-orm.config.js";
import { coinNotes, sqlCoinStore as store } from "./eventCoins.js";

/**
 * `bym.event_coins` / `bym.event_coin_log` and the SQL coin store against a
 * real Postgres: the migration (run twice), and each rule holding when
 * requests race: an award key pays once, spending never goes below 0, a
 * rolled-back transaction leaves nothing.
 *
 * Opt-in: runs only when EVENTS_TEST_DB names a throwaway database with the
 * `bym` schema and the migrations applied, and refuses the shared `bym`.
 * Its players are `zz_ec_*`, user ids 995_101 and up.
 */
const dbName = process.env.EVENTS_TEST_DB;

const A = 995_101;
const B = 995_102;

describe.skipIf(!dbName)("event coins on a real database", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("EVENTS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 10 } });
    for (const userid of [A, B]) {
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, `zz_ec_${userid}`, `zz_ec_${userid}@test.invalid`]
      );
    }
  });

  beforeEach(async () => {
    await sql(`DELETE FROM bym.event_coin_log WHERE userid IN (?, ?)`, [A, B]);
    await sql(`DELETE FROM bym.event_coins WHERE userid IN (?, ?)`, [A, B]);
  });

  afterAll(async () => {
    if (!orm) return;
    await sql(`DELETE FROM bym."user" WHERE userid IN (?, ?)`, [A, B]);
    await orm.close();
  });

  test("the migration is additive and can run again", async () => {
    const migration = new CreateEventCoinsTables(orm.em.getDriver(), orm.config);
    await migration.up();
    for (const query of migration.getQueries()) await sql(String(query));
  });

  test("grant, spend, balance and the log", async () => {
    const e = em();
    expect(await store.balance(e, A)).toBe(0);
    expect(await store.grant(e, A, 15, "calendar")).toBe(15);
    expect(await store.grant(e, A, 40, "ladder")).toBe(55);
    expect(await store.spend(e, A, 50, "decor-57")).toBe(5);
    expect(await store.spend(e, A, 6, "decor-55")).toBeNull();
    expect(await store.balance(e, A)).toBe(5);
    expect(coinNotes(e)).toEqual({
      balance: 5,
      gained: [
        { amount: 15, reason: "calendar" },
        { amount: 40, reason: "ladder" },
      ],
    });
    const [row] = await sql(`SELECT balance, earned, spent FROM bym.event_coins WHERE userid = ?`, [A]);
    expect(row).toEqual({ balance: 5, earned: 55, spent: 50 });
    const log = await sql(`SELECT amount, reason FROM bym.event_coin_log WHERE userid = ? ORDER BY id`, [A]);
    expect(log).toEqual([
      { amount: 15, reason: "calendar" },
      { amount: 40, reason: "ladder" },
      { amount: -50, reason: "decor-57" },
    ]);
    // Spending from no row at all.
    expect(await store.spend(e, B, 1, "decor-55")).toBeNull();
  });

  test("an award key pays once, even when 8 requests race", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.grant(em(), A, 50, "weekend-checkin", "weekend:2030-01-05:day1"))
    );
    expect(results.filter((r) => r !== null)).toEqual([50]);
    expect(await store.balance(em(), A)).toBe(50);
    expect(await store.awarded(em(), A, ["weekend:2030-01-05:day1", "x"])).toEqual(new Set(["weekend:2030-01-05:day1"]));
    // Another player, the same key: paid.
    expect(await store.grant(em(), B, 50, "weekend-checkin", "weekend:2030-01-05:day1")).toBe(50);
  });

  test("8 racing spends of 30 from 100 leave 10, never below 0", async () => {
    await store.grant(em(), A, 100, "test");
    const results = await Promise.all(Array.from({ length: 8 }, () => store.spend(em(), A, 30, "decor-29")));
    expect(results.filter((r) => r !== null)).toHaveLength(3);
    expect(await store.balance(em(), A)).toBe(10);
    const [{ count }] = await sql<{ count: string }>(
      `SELECT count(*) FROM bym.event_coin_log WHERE userid = ? AND amount < 0`,
      [A]
    );
    expect(Number(count)).toBe(3);
  });

  test("a rolled-back transaction leaves neither coins nor log", async () => {
    await expect(
      orm.em.fork().transactional(async (tx) => {
        await store.grant(tx, A, 50, "weekend-checkin", "weekend:2030-01-05:day2");
        throw new Error("refused");
      })
    ).rejects.toThrow("refused");
    expect(await store.balance(em(), A)).toBe(0);
    expect(await store.grant(em(), A, 50, "weekend-checkin", "weekend:2030-01-05:day2")).toBe(50);
  });

  test("the account's rows go with it", async () => {
    await store.grant(em(), B, 5, "test");
    await sql(`DELETE FROM bym."user" WHERE userid = ?`, [B]);
    expect(await sql(`SELECT 1 FROM bym.event_coins WHERE userid = ?`, [B])).toEqual([]);
    expect(await sql(`SELECT 1 FROM bym.event_coin_log WHERE userid = ?`, [B])).toEqual([]);
    await sql(
      `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
      [B, `zz_ec_${B}`, `zz_ec_${B}@test.invalid`]
    );
  });
});
