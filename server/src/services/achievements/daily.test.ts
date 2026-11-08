import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import { achievementConfig } from "../../config/AchievementConfig.js";
import {
  countsAsVisit,
  dayOf,
  loginPending,
  loginStep,
  NEIGHBOURLY_TARGET,
  recordLogin,
  recordVisit,
  visitPending,
  visitStep,
} from "./daily.js";
import { readAchievements } from "./state.js";

/** The daily trackers behind Neighbourly and Regular (#392), pure. */

const DAY = 86_400;
const NOW = 20_398 * DAY + 3_600;
const TODAY = dayOf(NOW);

describe("loginStep (Regular)", () => {
  test("the first load ever starts a run of 1", () => {
    expect(loginStep(undefined, NOW)).toEqual({ daily: { login: TODAY, streak: 1 }, streak: 1 });
  });

  test("a load the day after adds a day; a second load the same day changes nothing", () => {
    const step = loginStep({ login: TODAY - 1, streak: 29 }, NOW);
    expect(step).toEqual({ daily: { login: TODAY, streak: 30 }, streak: 30 });
    expect(loginStep(step!.daily, NOW + 3 * 3_600)).toBeNull();
  });

  test("a missed day starts the run again; the days are UTC", () => {
    expect(loginStep({ login: TODAY - 2, streak: 12 }, NOW)?.streak).toBe(1);
    // 23:59 then 00:01 UTC are two days in a row.
    const late = TODAY * DAY - 60;
    const first = loginStep(undefined, late)!;
    expect(loginStep(first.daily, late + 120)?.streak).toBe(2);
  });

  test("a clock gone back a day does nothing", () => {
    expect(loginStep({ login: TODAY + 1, streak: 5 }, NOW)).toBeNull();
  });

  test("the other tracker is kept", () => {
    expect(loginStep({ visitDay: TODAY, visits: ["9"] }, NOW)?.daily).toEqual({
      visitDay: TODAY,
      visits: ["9"],
      login: TODAY,
      streak: 1,
    });
  });
});

describe("visitStep (Neighbourly)", () => {
  test("each yard counts once a day", () => {
    const first = visitStep(undefined, "101", NOW)!;
    expect(first).toEqual({ daily: { visitDay: TODAY, visits: ["101"] }, visits: 1 });
    expect(visitStep(first.daily, "101", NOW + 60)).toBeNull();
    expect(visitStep(first.daily, "102", NOW + 60)?.visits).toBe(2);
  });

  test("a new day starts the count again", () => {
    expect(visitStep({ visitDay: TODAY - 1, visits: ["1", "2", "3"] }, "2", NOW)).toEqual({
      daily: { visitDay: TODAY, visits: ["2"] },
      visits: 1,
    });
  });

  test("past the target nothing more is kept", () => {
    const visits = Array.from({ length: NEIGHBOURLY_TARGET }, (_, i) => String(i));
    expect(visitStep({ visitDay: TODAY, visits }, "999", NOW)).toBeNull();
  });
});

describe("countsAsVisit", () => {
  test("someone else's main yard or outpost counts; the player's own and wild camps do not", () => {
    expect(countsAsVisit(5, { baseid: "1", userid: 6, type: "main" })).toBe(true);
    expect(countsAsVisit(5, { baseid: "1", userid: 6, type: "outpost" })).toBe(true);
    expect(countsAsVisit(5, { baseid: "1", userid: 5, type: "main" })).toBe(false);
    expect(countsAsVisit(5, { baseid: "1", userid: 0, type: "tribe" })).toBe(false);
    expect(countsAsVisit(5, { baseid: "1", userid: 6, type: "tribe" })).toBe(false);
    expect(countsAsVisit(5, { baseid: "1", userid: 6, type: "inferno" })).toBe(false);
  });
});

describe("the checks before any lock", () => {
  test("a login already counted today, or a yard already visited, needs no write", () => {
    const save = { achievements: { v: 1, s: {}, c: {}, d: { login: TODAY, streak: 3, visitDay: TODAY, visits: ["7"] } } };
    expect(loginPending(save, NOW)).toBe(false);
    expect(loginPending(save, NOW + DAY)).toBe(true);
    expect(visitPending(save, "7", NOW)).toBe(false);
    expect(visitPending(save, "8", NOW)).toBe(true);
  });

  test("once Neighbourly is earned, visits are not counted at all", () => {
    const save = { achievements: { v: 1, s: { neighbourly: 30 }, c: { "23": { at: 1, shiny: 15 } } } };
    expect(visitPending(save, "8", NOW)).toBe(false);
  });

  test("the trackers survive a read; junk in them is dropped", () => {
    const record = readAchievements({
      achievements: { v: 1, s: {}, c: {}, d: { login: TODAY, streak: -4, visits: ["a", 3, "a", ""] } },
    });
    expect(record.d).toEqual({ login: TODAY, visits: ["a"] });
    expect(readAchievements({ achievements: { v: 1, s: {}, c: {}, d: "x" } }).d).toBeUndefined();
  });
});

type Row = Record<string, unknown>;

/** One main row in memory, a friend count, and the locked transaction's writes. */
const db = { row: null as Row | null, friends: 0, transactions: 0, bell: [] as Row[] };

const em = {
  async execute() {
    return [{ n: db.friends }];
  },
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    db.transactions += 1;
    let entity: Row | null = null;
    const fork = {
      async findOne() {
        entity = db.row && structuredClone(db.row);
        return entity;
      },
      async insertMany(_entity: unknown, rows: Row[]) {
        db.bell.push(...rows);
      },
      async nativeDelete() {},
      getConnection: () => ({ execute: async () => [] }),
      async flush() {},
    };
    const result = await cb(fork);
    if (entity) db.row = structuredClone(entity);
    return result;
  },
} as unknown as EntityManager;

const startingRewards = achievementConfig.rewards;
const main = () => db.row as Row & { basesaveid: number; userid: number };

describe("recordLogin and recordVisit, under the main row's lock", () => {
  beforeEach(() => {
    db.row = {
      basesaveid: 7,
      userid: 2503,
      type: "main",
      credits: 100,
      outposts: [],
      achievements: { v: 1, s: {}, c: {}, backfilledAt: 1, d: { login: TODAY - 1, streak: 29 } },
    };
    db.friends = 80;
    db.transactions = 0;
    db.bell = [];
    achievementConfig.rewards = true;
  });

  afterEach(() => {
    achievementConfig.rewards = startingRewards;
  });

  test("the 30th day in a row with 80 friends pays Regular and Popular, once", async () => {
    expect(await recordLogin(em, main(), NOW)).toBe(true);
    const record = readAchievements(db.row!);
    expect(record.d).toEqual({ login: TODAY, streak: 30 });
    expect(record.s).toMatchObject({ loginstreak: 30, friends: 80 });
    expect(Object.keys(record.c).sort()).toEqual(["24", "25"]);
    expect(db.row!.credits).toBe(140);

    // The same day again: nothing is even locked.
    expect(await recordLogin(em, main(), NOW + 60)).toBe(false);
    expect(db.transactions).toBe(1);
  });

  test("the 30th yard visited today pays Neighbourly; the player's own yard never counts", async () => {
    const visits = Array.from({ length: NEIGHBOURLY_TARGET - 1 }, (_, i) => String(500 + i));
    db.row!.achievements = { v: 1, s: {}, c: {}, backfilledAt: 1, d: { visitDay: TODAY, visits } };

    expect(await recordVisit(em, main(), { baseid: "77", userid: 2503, type: "main" }, NOW)).toBe(false);
    expect(await recordVisit(em, main(), { baseid: "500", userid: 9, type: "main" }, NOW)).toBe(false);
    expect(db.transactions).toBe(0);

    expect(await recordVisit(em, main(), { baseid: "900", userid: 9, type: "outpost" }, NOW)).toBe(true);
    const record = readAchievements(db.row!);
    expect(record.s.neighbourly).toBe(30);
    expect(record.c["23"]).toMatchObject({ shiny: 15 });
    expect(await recordVisit(em, main(), { baseid: "901", userid: 9, type: "main" }, NOW)).toBe(false);
  });
});
