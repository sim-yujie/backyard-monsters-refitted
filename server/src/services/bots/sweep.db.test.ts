import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import type { BotConfig } from "../../config/BotConfig.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { calculateBaseLevel } from "../base/calculateBaseLevel.js";
import { readMushrooms } from "../yard/mushrooms.js";
import { SLOW_PACE } from "./brain.js";
import { createBots, deleteBots } from "./factory.js";
import { LOOT_BAND } from "./yardGenerator.js";
import { LEGACY_BOT_SHINY, shinyBand } from "./shiny.js";
import { BUNKER_TYPE } from "../yard/bunker.js";
import { storageCap } from "../base/economy/resourceBudget.js";
import { bookFirstGrows, MAX_ATTEMPTS, MAX_GROW_DROPS, REBALANCE_JOB, rebalancePeriod, runBotSweep, UNDER_ATTACK_RETRY_MINUTES, type SweepDeps } from "./sweep.js";

/**
 * The bot sweep against a real Postgres (issue #240): the first grows, the
 * `SKIP LOCKED` claim, growth on a made-up clock, retirement and its
 * replacement, the repair, the backoff and the daily rebalance.
 *
 * Opt-in, like `factory.db.test.ts`: runs only when BOTS_TEST_DB names a
 * throwaway database with the `bym` schema, and refuses the shared `bym`
 * database. Every test starts from no bots.
 */
const dbName = process.env.BOTS_TEST_DB;

const NOW = Math.floor(Date.now() / 1000);
const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const T = 3;

describe.skipIf(!dbName)("the bot sweep on a real database (issue #240)", () => {
  let orm: MikroORM;

  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);

  const reset = async () => {
    await deleteBots(orm.em.fork(), "all");
    await sql(`DELETE FROM bym.job_run WHERE job = ?`, [REBALANCE_JOB]);
  };

  const make = (levels: number[], seed = 240) =>
    createBots(orm.em.fork(), levels, { rng: mulberry32(seed), now: NOW, daysPerLevel: T });

  const config =
    (total: number, brain = true): (() => BotConfig) =>
    () => ({ fill: false, brain, revenge: false, total, daysPerLevel: T });

  /** A pass at `at`, with the online marks it made. */
  const pass = async (at: number, total: number, extra: Partial<SweepDeps> = {}) => {
    const online: number[] = [];
    const draw = mulberry32(at);
    const report = await runBotSweep({
      em: orm.em,
      now: () => at,
      config: config(total),
      rng: () => draw.float(),
      markOnline: async (userid) => {
        online.push(userid);
      },
      ...extra,
    });
    return { report: report!, online };
  };

  const botRow = async (userid: number) =>
    (await sql(`SELECT * FROM bym.bot WHERE userid = ?`, [userid]))[0]!;
  const saveRow = async (userid: number) =>
    (await sql(`SELECT * FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]))[0]!;
  const jobs = (userid?: number) =>
    userid === undefined
      ? sql(`SELECT * FROM bym.bot_job ORDER BY id`)
      : sql(`SELECT * FROM bym.bot_job WHERE bot_userid = ? ORDER BY id`, [userid]);
  /** Makes every booked grow due at `at`. */
  const dueNow = (at: number) => sql(`UPDATE bym.bot_job SET due_at = ? WHERE kind = 'grow'`, [new Date(at * 1000)]);

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("BOTS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 6 } });
  });

  beforeEach(reset);

  afterAll(async () => {
    if (!orm) return;
    await reset();
    await orm.close(true);
  });

  test("switched off, a pass reads and writes nothing", async () => {
    await make([4]);
    const report = await runBotSweep({ em: orm.em, now: () => NOW, config: config(1, false) });
    expect(report).toBeNull();
    expect(await jobs()).toEqual([]);
    expect(await sql(`SELECT * FROM bym.job_run WHERE job = ?`, [REBALANCE_JOB])).toEqual([]);
  }, 30_000);

  test("every active bot gets one first grow within the hour, and only one", async () => {
    const made = await make([1, 20, 40]);
    const first = await pass(NOW - 2 * HOUR, 3);
    expect(first.report.booked).toBe(3);
    const booked = await jobs();
    expect(booked.map((job) => job.kind)).toEqual(["grow", "grow", "grow"]);
    expect(new Set(booked.map((job) => job.bot_userid))).toEqual(new Set(made.map((bot) => bot.userid)));
    for (const job of booked) {
      const due = new Date(job.due_at).getTime() / 1000;
      expect(due).toBeGreaterThanOrEqual(NOW - 2 * HOUR);
      expect(due).toBeLessThan(NOW - HOUR);
    }
    expect((await pass(NOW - 2 * HOUR, 3)).report.booked).toBe(0);
  }, 30_000);

  test("a bot grows at about three days a level, online on each grow, its first grow a real catch-up", async () => {
    const [bot] = await make([10]);
    const start = await botRow(bot!.userid);
    const startPosition = 10 + (NOW - new Date(start.level_since).getTime() / 1000) / (T * DAY);

    let online = 0;
    for (let at = NOW; at <= NOW + 7 * DAY; at += HOUR) online += (await pass(at, 1)).online.length;

    const row = await botRow(bot!.userid);
    const save = await saveRow(bot!.userid);
    const expected = Math.floor(startPosition + 7 / T);
    expect(row.level).toBeGreaterThanOrEqual(expected - 1);
    expect(row.level).toBeLessThanOrEqual(expected);
    expect(calculateBaseLevel(save.points, save.basevalue)).toBe(row.level);
    expect(save.level).toBe(row.level);
    // One online mark per grow, a grow every 2-6 hours.
    expect(online).toBeGreaterThanOrEqual(7 * 4);
    expect(online).toBeLessThanOrEqual(7 * 12 + 1);
    // The catch-up grew mushrooms and moved the save on.
    expect(readMushrooms(save.mushrooms).l.length).toBeGreaterThan(0);
    expect(save.savetime).toBeGreaterThan(NOW + 6 * DAY);
    const [grow] = await jobs(bot!.userid);
    const due = new Date(grow.due_at).getTime() / 1000;
    expect(due).toBeGreaterThan(NOW + 7 * DAY - 6 * HOUR);
    expect(due).toBeLessThanOrEqual(NOW + 7 * DAY + 6 * HOUR);
  }, 120_000);

  test("a yard under attack is left alone and looked at again ten minutes later", async () => {
    const [bot] = await make([12]);
    await pass(NOW, 1);
    await dueNow(NOW);
    const before = await saveRow(bot!.userid);
    const realNow = Math.floor(Date.now() / 1000);
    await sql(`UPDATE bym.save SET attackid = 1, attacks = ? WHERE userid = ? AND type = 'main'`, [
      JSON.stringify([{ name: "x", friend: 0, count: 1, starttime: realNow, seen: false }]),
      bot!.userid,
    ]);
    const { online } = await pass(NOW, 1);
    expect(online).toEqual([]);
    const [grow] = await jobs(bot!.userid);
    expect(new Date(grow.due_at).getTime() / 1000).toBe(NOW + UNDER_ATTACK_RETRY_MINUTES * 60);
    expect((await saveRow(bot!.userid)).savetime).toBe(before.savetime);
  }, 30_000);

  test("past level 40 a bot retires to Map Room 2 and a fresh level 1 bot takes its place", async () => {
    const [old] = await make([40]);
    // The day's rebalance is claimed already: a lone bot on level 40 against a total of one would be slowed.
    await sql(`INSERT INTO bym.job_run (job, period, ran_at) VALUES (?, ?, ?)`, [REBALANCE_JOB, rebalancePeriod(NOW), new Date(NOW * 1000)]);
    await pass(NOW, 1);
    await sql(`UPDATE bym.bot SET level_since = ? WHERE userid = ?`, [new Date((NOW - 3.2 * T * DAY / 3) * 1000), old!.userid]);
    await dueNow(NOW);

    const { report } = await pass(NOW, 1);
    expect(report.retired).toEqual([old!.userid]);
    expect(report.replaced).toHaveLength(1);

    const row = await botRow(old!.userid);
    const save = await saveRow(old!.userid);
    expect(row.state).toBe("retired");
    expect(row.retired_at).not.toBeNull();
    expect(save.mapversion).toBe(2);
    expect(save.worldid).toBeNull();
    expect(await jobs(old!.userid)).toEqual([]);

    const fresh = await botRow(report.replaced[0]!);
    expect(fresh).toMatchObject({ level: 1, state: "active" });
    expect((await jobs(fresh.userid)).map((job) => job.kind)).toEqual(["grow"]);
  }, 30_000);

  test("Shiny: made inside the level's band, a bot still on the new-save 1,500 redrawn on its next grow", async () => {
    const [bot] = await make([15]);
    const inBand = (credits: number, level: number) =>
      credits >= shinyBand(level).min && credits <= shinyBand(level).max && credits !== LEGACY_BOT_SHINY;
    expect(inBand(Number((await saveRow(bot!.userid)).credits), 15)).toBe(true);

    await pass(NOW, 1);
    await sql(`UPDATE bym.save SET credits = ? WHERE userid = ? AND type = 'main'`, [LEGACY_BOT_SHINY, bot!.userid]);
    await dueNow(NOW);
    await pass(NOW, 1);
    const save = await saveRow(bot!.userid);
    expect(inBand(Number(save.credits), Number(save.level))).toBe(true);
  }, 30_000);

  test("a repair starts Repair all, re-arms nothing missing, refills the bunkers and puts loot back in its band", async () => {
    const [bot] = await make([30]);
    const save = await saveRow(bot!.userid);
    const buildings = save.buildingdata as Record<string, any>;
    const bunkerKey = Object.keys(buildings).find((key) => buildings[key].t === BUNKER_TYPE)!;
    const hurtKey = Object.keys(buildings).find((key) => buildings[key].t === 20)!;
    buildings[bunkerKey] = { ...buildings[bunkerKey], m: {} };
    buildings[hurtKey] = { ...buildings[hurtKey], hp: 1 };
    await sql(
      `UPDATE bym.save SET buildingdata = ?, buildinghealthdata = ?, resources = resources || '{"r1": 0}' WHERE basesaveid = ?`,
      [JSON.stringify(buildings), JSON.stringify({ [hurtKey]: 1 }), save.basesaveid]
    );
    await sql(`INSERT INTO bym.bot_job (bot_userid, kind, due_at) VALUES (?, 'repair', ?)`, [bot!.userid, new Date(NOW * 1000)]);
    // Keep the grow out of the way.
    await pass(NOW - DAY, 1);
    await sql(`UPDATE bym.bot_job SET due_at = ? WHERE kind = 'grow'`, [new Date((NOW + DAY) * 1000)]);

    const { report } = await pass(NOW, 1);
    expect(report.ran.repair).toBe(1);
    const after = await saveRow(bot!.userid);
    expect(after.buildingdata[hurtKey].rE).toBe(1);
    expect(Object.keys(after.buildingdata[bunkerKey].m).length).toBeGreaterThan(0);
    const cap = storageCap(after);
    expect(after.resources.r1).toBeGreaterThanOrEqual(Math.floor(cap * LOOT_BAND.min));
    expect((await jobs(bot!.userid)).map((job) => job.kind)).toEqual(["grow"]);

    // An hour later the catch-up has healed it.
    await sql(`UPDATE bym.bot_job SET due_at = ? WHERE kind = 'grow'`, [new Date((NOW + 2 * HOUR) * 1000)]);
    await pass(NOW + 2 * HOUR, 1);
    const healed = await saveRow(bot!.userid);
    expect(healed.buildingdata[hurtKey].hp).toBeUndefined();
    expect(healed.buildingdata[hurtKey].rE).toBeUndefined();
  }, 30_000);

  /** A bot with its grow booked and a repair due at NOW, and NOW's rebalance already claimed. */
  const repairDue = async (level: number) => {
    const [bot] = await make([level]);
    await pass(NOW - DAY, 1);
    await sql(`INSERT INTO bym.bot_job (bot_userid, kind, due_at) VALUES (?, 'repair', ?)`, [bot!.userid, new Date(NOW * 1000)]);
    await sql(`INSERT INTO bym.job_run (job, period, ran_at) VALUES (?, ?, now()) ON CONFLICT DO NOTHING`, [
      REBALANCE_JOB,
      rebalancePeriod(NOW),
    ]);
    return bot!;
  };

  test("a repair waits while another job holds the bot's row (issue #249)", async () => {
    const bot = await repairDue(15);
    await sql(`UPDATE bym.bot_job SET due_at = ? WHERE kind = 'grow'`, [new Date((NOW + DAY) * 1000)]);

    // Another job on this bot, mid-way on another server: the bot's row
    // locked, as a grow or a revenge holds it, the yard not yet touched.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let holding!: () => void;
    const held = new Promise<void>((resolve) => (holding = resolve));
    const other = orm.em.fork().transactional(async (tx) => {
      await tx.execute(`SELECT userid FROM bym.bot WHERE userid = ? FOR UPDATE`, [bot.userid]);
      holding();
      await released;
    });
    await held;

    let done = false;
    const repairing = pass(NOW, 1).then((result) => {
      done = true;
      return result;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(done).toBe(false);
      expect((await jobs(bot.userid)).map((job) => job.kind).sort()).toEqual(["grow", "repair"]);
    } finally {
      release();
      await other;
    }
    const { report } = await repairing;
    expect(report.ran.repair).toBe(1);
    expect(report.failed).toBe(0);
    expect((await jobs(bot.userid)).map((job) => job.kind)).toEqual(["grow"]);
  }, 30_000);

  test("a grow and a repair on one bot at once run one after the other, and both land (issue #249)", async () => {
    const bot = await repairDue(15);
    await dueNow(NOW);

    const [a, b] = await Promise.all([pass(NOW, 1), pass(NOW, 1)]);
    expect((a.report.ran.grow ?? 0) + (b.report.ran.grow ?? 0)).toBe(1);
    expect((a.report.ran.repair ?? 0) + (b.report.ran.repair ?? 0)).toBe(1);
    expect(a.report.failed + b.report.failed).toBe(0);
    const left = await jobs(bot.userid);
    expect(left.map((job) => job.kind)).toEqual(["grow"]);
    expect(new Date(left[0]!.due_at).getTime() / 1000).toBeGreaterThan(NOW + HOUR);
  }, 30_000);

  test("a damaged yard does not grow, and books a repair if none is coming", async () => {
    const [bot] = await make([15]);
    await pass(NOW, 1);
    const save = await saveRow(bot!.userid);
    const buildings = save.buildingdata as Record<string, any>;
    const hurtKey = Object.keys(buildings).find((key) => buildings[key].t === 14)!;
    await sql(`UPDATE bym.save SET buildinghealthdata = ? WHERE basesaveid = ?`, [
      JSON.stringify({ [hurtKey]: 1 }),
      save.basesaveid,
    ]);
    const points = (await saveRow(bot!.userid)).points;
    await sql(`UPDATE bym.bot SET level_since = ? WHERE userid = ?`, [new Date((NOW - 2.5 * DAY) * 1000), bot!.userid]);
    await dueNow(NOW + DAY);
    await pass(NOW + DAY, 1);
    expect((await saveRow(bot!.userid)).points).toBe(points);
    expect((await jobs(bot!.userid)).map((job) => job.kind).sort()).toEqual(["grow", "repair"]);
  }, 30_000);

  test("a failing job backs off and is dropped after five tries; the next pass books a fresh grow", async () => {
    const [bot] = await make([6]);
    await pass(NOW, 1);
    await sql(`UPDATE bym.save SET type = 'gone' WHERE userid = ? AND type = 'main'`, [bot!.userid]);
    await dueNow(NOW);

    let at = NOW;
    let dropped = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { report } = await pass(at, 1);
      dropped += report.dropped;
      const [job] = await jobs(bot!.userid);
      if (attempt < MAX_ATTEMPTS) {
        expect(job.attempts).toBe(attempt);
        at = new Date(job.due_at).getTime() / 1000;
        expect(at).toBe(Math.floor(at));
      }
    }
    expect(dropped).toBe(1);
    expect((await pass(at, 1)).report.booked).toBe(1);
    await sql(`UPDATE bym.save SET type = 'main' WHERE userid = ? AND type = 'gone'`, [bot!.userid]);
  }, 30_000);

  test(`a bot whose grow is dropped ${MAX_GROW_DROPS} times in a row is retired and replaced at level 1`, async () => {
    const [bot] = await make([6]);
    await pass(NOW, 1);
    await sql(`UPDATE bym.save SET type = 'gone' WHERE userid = ? AND type = 'main'`, [bot!.userid]);

    let at = NOW;
    let dropped = 0;
    let retiredAt = -1;
    const replaced: number[] = [];
    for (let run = 0; run < 2 * MAX_GROW_DROPS * MAX_ATTEMPTS && retiredAt < 0; run++) {
      await dueNow(at);
      const { report } = await pass(at, 1);
      dropped += report.dropped;
      if (dropped < MAX_GROW_DROPS) expect(report.retired).toEqual([]);
      if (report.retired.includes(bot!.userid)) {
        retiredAt = run;
        replaced.push(...report.replaced);
      }
      at += HOUR;
    }

    expect(dropped).toBe(MAX_GROW_DROPS);
    expect(retiredAt).toBeGreaterThan(0);
    const row = await botRow(bot!.userid);
    expect(row.state).toBe("retired");
    expect(row.grow_drops).toBe(MAX_GROW_DROPS);
    expect(await jobs(bot!.userid)).toEqual([]);
    // The usual replacement: one fresh level 1 bot, with its first grow booked.
    expect(replaced).toHaveLength(1);
    expect((await botRow(replaced[0]!)).level).toBe(1);
    expect((await jobs(replaced[0]!)).map((job) => job.kind)).toEqual(["grow"]);
    // Retired bots are never booked again.
    expect((await pass(at, 1)).report.booked).toBe(0);
    await sql(`UPDATE bym.save SET type = 'main' WHERE userid = ? AND type = 'gone'`, [bot!.userid]);
  }, 60_000);

  test("a grow that runs clears the count of dropped grows", async () => {
    const [bot] = await make([6]);
    await pass(NOW, 1);
    await sql(`UPDATE bym.bot SET grow_drops = ? WHERE userid = ?`, [MAX_GROW_DROPS - 1, bot!.userid]);
    await dueNow(NOW + HOUR);
    expect((await pass(NOW + HOUR, 1)).report.ran.grow).toBe(1);
    expect((await botRow(bot!.userid)).grow_drops).toBe(0);
  }, 30_000);

  test("two sweeps at once never run one job twice", async () => {
    const made = await make([3, 5, 7, 9, 11, 13]);
    await pass(NOW - DAY, 6);
    await dueNow(NOW);
    const [a, b] = await Promise.all([pass(NOW, 6), pass(NOW, 6)]);
    expect((a.report.ran.grow ?? 0) + (b.report.ran.grow ?? 0)).toBe(made.length);
    expect([...a.online, ...b.online].sort()).toEqual(made.map((bot) => bot.userid).sort());
    for (const job of await jobs()) expect(new Date(job.due_at).getTime() / 1000).toBeGreaterThan(NOW + HOUR);
  }, 60_000);

  test("the rebalance runs once a day: paces nudged, the total topped up at level 1", async () => {
    // A full table of five, one a level on levels 1-5: the level 9 bot is far ahead of its spot, so it slows.
    const made = await make([1, 2, 3, 4, 9]);
    await bookFirstGrows(orm.em.fork(), NOW + 2 * DAY);

    const first = await pass(NOW, 5);
    expect(first.report.rebalanced).toBe(true);
    expect(first.report.replaced).toEqual([]);
    const paces = await sql<{ bot_userid: number; speed: number | null }>(
      `SELECT bot_userid, (payload->>'speed')::float AS speed FROM bym.bot_job WHERE kind = 'grow' AND payload->>'speed' IS NOT NULL`
    );
    expect(paces).toEqual([{ bot_userid: made[4]!.userid, speed: SLOW_PACE }]);

    expect((await pass(NOW + HOUR, 5)).report.rebalanced).toBe(false);

    // The next day the total is 8: level 1 has room for its share (1) and the slack (2), less the one it has.
    const next = await pass(NOW + DAY, 8);
    expect(next.report.rebalanced).toBe(true);
    expect(next.report.replaced).toHaveLength(2);
    // The new level 1 bots start at the bottom of the level, as new players.
    for (const userid of next.report.replaced) {
      expect(new Date((await botRow(userid)).level_since).getTime() / 1000).toBe(NOW + DAY);
    }
  }, 60_000);
});
