import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import type { BotConfig } from "../../config/BotConfig.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { calculateBaseLevel } from "../base/calculateBaseLevel.js";
import { createBots, deleteBots } from "./factory.js";
import { REBALANCE_JOB, rebalancePeriod, runBotSweep } from "./sweep.js";

/**
 * The bot sweep's grow and repair for seeded Map Room 2 dev players (issue
 * #233) against a real Postgres. A seeded player is made here as a bot whose
 * row is then set to `seeded`: the sweep reads only the row and the save, so
 * that is all it needs.
 *
 * Opt-in, like `sweep.db.test.ts`: runs only when BOTS_TEST_DB names a
 * throwaway database with the `bym` schema, and refuses the shared `bym`
 * database. Every test starts from no bots and no seeded rows.
 */
const dbName = process.env.BOTS_TEST_DB;

const NOW = Math.floor(Date.now() / 1000);
const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const T = 3;

describe.skipIf(!dbName)("seeded Map Room 2 players in the bot sweep on a real database (issue #233)", () => {
  let orm: MikroORM;

  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);

  const reset = async () => {
    // deleteBots leaves seeded rows alone, so make them bots first.
    await sql(`UPDATE bym.bot SET state = 'active' WHERE state = 'seeded'`);
    await deleteBots(orm.em.fork(), "all");
    await sql(`DELETE FROM bym.job_run WHERE job = ?`, [REBALANCE_JOB]);
  };

  /** Seeded players on `levels`, their saves on Map Room 2 as a seeded account's would be. */
  const makeSeeded = async (levels: number[]) => {
    const made = await createBots(orm.em.fork(), levels, { rng: mulberry32(233), now: NOW, daysPerLevel: T });
    for (const bot of made) {
      await sql(`UPDATE bym.bot SET state = 'seeded' WHERE userid = ?`, [bot.userid]);
      await sql(`UPDATE bym.save SET mapversion = 2 WHERE userid = ? AND type = 'main'`, [bot.userid]);
    }
    return made;
  };

  const config =
    (seeded: boolean, total = 0): (() => BotConfig) =>
    () => ({ fill: false, brain: true, revenge: false, total, daysPerLevel: T, seeded });

  const pass = async (at: number, seeded: boolean, total = 0) => {
    const online: number[] = [];
    const draw = mulberry32(at);
    const report = await runBotSweep({
      em: orm.em,
      now: () => at,
      config: config(seeded, total),
      rng: () => draw.float(),
      markOnline: async (userid) => {
        online.push(userid);
      },
    });
    return { report: report!, online };
  };

  /** The day's rebalance claimed already, so a pass makes no level 1 bots. */
  const claimRebalance = (at: number) =>
    sql(`INSERT INTO bym.job_run (job, period, ran_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`, [
      REBALANCE_JOB,
      rebalancePeriod(at),
      new Date(at * 1000),
    ]);

  const botRow = async (userid: number) => (await sql(`SELECT * FROM bym.bot WHERE userid = ?`, [userid]))[0]!;
  const saveRow = async (userid: number) =>
    (await sql(`SELECT * FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]))[0]!;
  const jobs = (userid: number) => sql(`SELECT * FROM bym.bot_job WHERE bot_userid = ? ORDER BY id`, [userid]);
  const dueNow = (at: number) => sql(`UPDATE bym.bot_job SET due_at = ? WHERE kind = 'grow'`, [new Date(at * 1000)]);

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("BOTS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
  });

  beforeEach(reset);

  afterAll(async () => {
    if (!orm) return;
    await reset();
    await orm.close(true);
  });

  test("a seeded player gets a first grow and grows like a bot, never shown online", async () => {
    const [player] = await makeSeeded([10]);
    const first = await pass(NOW, true);
    expect(first.report.booked).toBe(1);
    expect((await jobs(player!.userid)).map((job) => job.kind)).toEqual(["grow"]);

    let online = 0;
    for (let at = NOW; at <= NOW + 7 * DAY; at += 2 * HOUR) {
      await claimRebalance(at);
      online += (await pass(at, true)).online.length;
    }
    const row = await botRow(player!.userid);
    const save = await saveRow(player!.userid);
    expect(row.state).toBe("seeded");
    expect(row.level).toBeGreaterThan(10);
    expect(calculateBaseLevel(save.points, save.basevalue)).toBe(row.level);
    expect(save.mapversion).toBe(2);
    expect(online).toBe(0);
  }, 120_000);

  test("past level 40 a seeded player stays on level 40 and its Map Room, never retired", async () => {
    const [player] = await makeSeeded([40]);
    await claimRebalance(NOW);
    await pass(NOW, true);
    await sql(`UPDATE bym.bot SET level_since = ? WHERE userid = ?`, [new Date((NOW - 3 * T * DAY) * 1000), player!.userid]);
    await dueNow(NOW);

    const { report } = await pass(NOW, true);
    expect(report.ran.grow).toBe(1);
    expect(report.retired).toEqual([]);
    expect(report.replaced).toEqual([]);
    const row = await botRow(player!.userid);
    const save = await saveRow(player!.userid);
    expect(row).toMatchObject({ state: "seeded", level: 40 });
    expect(save.mapversion).toBe(2);
    expect((await jobs(player!.userid)).map((job) => job.kind)).toEqual(["grow"]);
  }, 60_000);

  test("a repair booked for a seeded player runs Repair all", async () => {
    const [player] = await makeSeeded([30]);
    const save = await saveRow(player!.userid);
    const buildings = save.buildingdata as Record<string, any>;
    const hurtKey = Object.keys(buildings).find((key) => buildings[key].t === 20)!;
    buildings[hurtKey] = { ...buildings[hurtKey], hp: 1 };
    await sql(`UPDATE bym.save SET buildingdata = ?, buildinghealthdata = ? WHERE basesaveid = ?`, [
      JSON.stringify(buildings),
      JSON.stringify({ [hurtKey]: 1 }),
      save.basesaveid,
    ]);
    await sql(`INSERT INTO bym.bot_job (bot_userid, kind, due_at) VALUES (?, 'repair', ?)`, [player!.userid, new Date(NOW * 1000)]);
    await claimRebalance(NOW);

    const { report } = await pass(NOW, true);
    expect(report.ran.repair).toBe(1);
    expect((await saveRow(player!.userid)).buildingdata[hurtKey].rE).toBe(1);
  }, 60_000);

  test("on production a seeded player's jobs are dropped and none booked", async () => {
    const [player] = await makeSeeded([12]);
    await sql(`INSERT INTO bym.bot_job (bot_userid, kind, due_at) VALUES (?, 'grow', ?), (?, 'repair', ?)`, [
      player!.userid,
      new Date(NOW * 1000),
      player!.userid,
      new Date(NOW * 1000),
    ]);
    const before = await saveRow(player!.userid);
    await claimRebalance(NOW);

    const { report } = await pass(NOW, false);
    expect(report.booked).toBe(0);
    expect(await jobs(player!.userid)).toEqual([]);
    expect((await saveRow(player!.userid)).points).toBe(before.points);
    expect((await botRow(player!.userid)).state).toBe("seeded");
  }, 60_000);

  test("seeded players count for nothing in the bot total", async () => {
    await makeSeeded([1, 1, 1]);
    const { report } = await pass(NOW, true, 2);
    expect(report.rebalanced).toBe(true);
    expect(report.replaced).toHaveLength(2);
  }, 60_000);
});
