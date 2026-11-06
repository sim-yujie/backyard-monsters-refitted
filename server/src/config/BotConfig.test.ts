import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  botConfig,
  DAYS_ON_LEVEL,
  daysBetween,
  daysOn,
  DEFAULT_BOTS_GROWING_FLOW,
  DEFAULT_BOTS_FRESH_PER_DAY,
  DEFAULT_BOTS_LEVEL_SLACK,
  DEFAULT_BOTS_NEW_PER_DAY,
  DEFAULT_BOTS_QUIET_ONLINE,
  DEFAULT_BOTS_QUIET_RATE,
  DEFAULT_BOTS_FLOOR_LEVEL,
  DEFAULT_BOTS_PER_LEVEL,
  BOTS_SHOWN_FROM_LEVEL,
  botFloorLevel,
  defaultBotsTotal,
  levelWeights,
} from "./BotConfig.js";

const KEYS = [
  "BOTS_FILL",
  "BOTS_BRAIN",
  "BOTS_REVENGE",
  "BOTS_TOTAL",
  "BOTS_FLOOR_LEVEL",
  "BOTS_PACE_SCALE",
  "BOTS_QUIET_RATE",
  "BOTS_QUIET_ONLINE",
  "BOTS_GROWING_FLOW",
  "BOTS_NEW_PER_DAY",
  "BOTS_LEVEL_SLACK",
  "BOTS_FRESH_PER_DAY",
  "ENV",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("bot switches (issue #235)", () => {
  test("everything is off with the defaults when nothing is set", () => {
    expect(botConfig()).toEqual({
      fill: false,
      brain: false,
      revenge: false,
      total: defaultBotsTotal(DEFAULT_BOTS_FLOOR_LEVEL),
      pace: DAYS_ON_LEVEL,
      quietRate: DEFAULT_BOTS_QUIET_RATE,
      quietOnline: DEFAULT_BOTS_QUIET_ONLINE,
      growingFlow: DEFAULT_BOTS_GROWING_FLOW,
      newPerDay: DEFAULT_BOTS_NEW_PER_DAY,
      freshPerDay: DEFAULT_BOTS_FRESH_PER_DAY,
      levelSlack: DEFAULT_BOTS_LEVEL_SLACK,
      seeded: true,
    });
    expect(botConfig().total).toBe(185);
  });

  test("seeded Map Room 2 dev yards are tended everywhere but production (issue #233)", () => {
    process.env.ENV = "local";
    expect(botConfig().seeded).toBe(true);
    process.env.ENV = "production";
    expect(botConfig().seeded).toBe(false);
  });

  test("on or true turns a switch on; anything else leaves it off", () => {
    process.env.BOTS_FILL = "on";
    process.env.BOTS_BRAIN = " TRUE ";
    process.env.BOTS_REVENGE = "yes";
    expect(botConfig()).toMatchObject({ fill: true, brain: true, revenge: false });

    process.env.BOTS_FILL = "off";
    expect(botConfig().fill).toBe(false);
  });

  test("the count and pace scale take positive numbers and fall back otherwise", () => {
    process.env.BOTS_TOTAL = "750";
    process.env.BOTS_PACE_SCALE = "0.5";
    const config = botConfig();
    expect(config.total).toBe(750);
    expect(daysOn(config.pace, 20)).toBeCloseTo(DAYS_ON_LEVEL[20]! / 2, 9);

    for (const bad of ["", "0", "-3", "lots", "0.4"]) {
      process.env.BOTS_TOTAL = bad;
      process.env.BOTS_PACE_SCALE = bad === "0.4" ? "0" : bad;
      expect(botConfig()).toMatchObject({ total: 185, pace: DAYS_ON_LEVEL });
    }
  });

  test("the quiet rate takes 0-1, the daily cap and slack whole numbers, the flow a positive number", () => {
    process.env.BOTS_QUIET_RATE = "0";
    process.env.BOTS_QUIET_ONLINE = "0.2";
    process.env.BOTS_NEW_PER_DAY = "0";
    process.env.BOTS_LEVEL_SLACK = "3";
    process.env.BOTS_GROWING_FLOW = "0.6";
    expect(botConfig()).toMatchObject({ quietRate: 0, quietOnline: 0.2, newPerDay: 0, levelSlack: 3, growingFlow: 0.6 });

    for (const bad of ["", "1.5", "-0.1", "lots"]) {
      process.env.BOTS_QUIET_RATE = bad;
      process.env.BOTS_QUIET_ONLINE = bad;
      process.env.BOTS_NEW_PER_DAY = bad === "" ? "2.5" : bad;
      process.env.BOTS_LEVEL_SLACK = bad;
      process.env.BOTS_GROWING_FLOW = bad === "" ? "0" : bad === "1.5" ? "-1" : bad;
      expect(botConfig()).toMatchObject({
        quietRate: DEFAULT_BOTS_QUIET_RATE,
        quietOnline: DEFAULT_BOTS_QUIET_ONLINE,
        newPerDay: DEFAULT_BOTS_NEW_PER_DAY,
        levelSlack: DEFAULT_BOTS_LEVEL_SLACK,
        growingFlow: DEFAULT_BOTS_GROWING_FLOW,
      });
    }
  });

  test("the bots started at level 1 a day take any number 0 or more; 0 turns it off", () => {
    process.env.BOTS_FRESH_PER_DAY = "0";
    expect(botConfig().freshPerDay).toBe(0);
    process.env.BOTS_FRESH_PER_DAY = " 2.5 ";
    expect(botConfig().freshPerDay).toBe(2.5);
    for (const bad of ["", "-1", "lots"]) {
      process.env.BOTS_FRESH_PER_DAY = bad;
      expect(botConfig().freshPerDay).toBe(DEFAULT_BOTS_FRESH_PER_DAY);
    }
  });
});

describe("the growth curve", () => {
  test("every level 1-40 takes some time, never less than the one before", () => {
    expect(DAYS_ON_LEVEL).toHaveLength(41);
    for (let level = 2; level <= 40; level++) expect(DAYS_ON_LEVEL[level]!).toBeGreaterThanOrEqual(DAYS_ON_LEVEL[level - 1]!);
    expect(DAYS_ON_LEVEL[1]!).toBeGreaterThan(0);
  });

  test("fits the live game's real players (2026-10-23; their ages are upper bounds)", () => {
    const reach = (level: number) => daysBetween(1, level, DAYS_ON_LEVEL);
    // Levels 11-12 in about a day, 17 in 1-1.3 days, 21 and 25 within about 6, 26 within about 12.
    expect(reach(13)).toBeLessThanOrEqual(1);
    expect(reach(17)).toBeGreaterThan(0.8);
    expect(reach(17)).toBeLessThanOrEqual(1.3);
    expect(reach(21)).toBeLessThanOrEqual(6);
    expect(reach(25)).toBeGreaterThan(4);
    expect(reach(25)).toBeLessThanOrEqual(6);
    expect(reach(26)).toBeLessThanOrEqual(12);
    // Past 26, no data: each level needs about 1.4 times the points, so takes about 1.4 times as long.
    for (let level = 27; level <= 40; level++) {
      const ratio = DAYS_ON_LEVEL[level]! / DAYS_ON_LEVEL[level - 1]!;
      expect(ratio).toBeGreaterThan(1.3);
      expect(ratio).toBeLessThan(1.5);
    }
  });

  test("a number is the same days on every level; past the table, its last level", () => {
    expect(daysOn(3, 1)).toBe(3);
    expect(daysOn(3, 40)).toBe(3);
    expect(daysOn(DAYS_ON_LEVEL, 41)).toBe(DAYS_ON_LEVEL[40]!);
    expect(daysBetween(10, 12.5, 3)).toBeCloseTo(7.5, 9);
    expect(daysBetween(12, 11.5, 3)).toBe(0);
  });

  test("every level from the floor to 40 has a share of the total and no level below the floor has one", () => {
    for (const floor of [15, 25, 40]) {
      const weights = levelWeights(floor);
      expect(weights).toHaveLength(40);
      weights.forEach((weight, index) => {
        if (index + 1 < floor) expect(weight).toBe(0);
        else expect(weight).toBeGreaterThan(0);
      });
    }
    // The setting's floor by default.
    process.env.BOTS_FLOOR_LEVEL = "30";
    expect(levelWeights().indexOf(1)).toBe(29);
  });
});

describe("the level floor (owner 3 Nov 2026)", () => {
  test("is 25 unless BOTS_FLOOR_LEVEL sets a whole number 15-40", () => {
    expect(DEFAULT_BOTS_FLOOR_LEVEL).toBe(25);
    expect(botFloorLevel()).toBe(25);
    for (const good of ["15", "20", " 30 ", "40"]) {
      process.env.BOTS_FLOOR_LEVEL = good;
      expect(botFloorLevel()).toBe(Number(good));
    }
    // Below 15 a fresh bot could miss the minimum yard; past 40 no bot stands.
    for (const bad of ["", "14", "1", "0", "-25", "41", "25.5", "lots"]) {
      process.env.BOTS_FLOOR_LEVEL = bad;
      expect(botFloorLevel()).toBe(DEFAULT_BOTS_FLOOR_LEVEL);
    }
  });

  test("players are shown bots from level 15, whatever the floor", () => {
    expect(BOTS_SHOWN_FROM_LEVEL).toBe(15);
  });

  test("the default total keeps about 11.5 bots a level from the floor up: 300 at 15, 185 at 25", () => {
    expect(DEFAULT_BOTS_PER_LEVEL).toBeCloseTo(11.54, 2);
    expect(defaultBotsTotal(15)).toBe(300);
    expect(defaultBotsTotal(25)).toBe(185);
    expect(defaultBotsTotal(40)).toBe(12);
    expect(botConfig().total).toBe(185);
    process.env.BOTS_FLOOR_LEVEL = "20";
    expect(botConfig().total).toBe(equalShare(20));
    // BOTS_TOTAL still wins when set.
    process.env.BOTS_TOTAL = "300";
    expect(botConfig().total).toBe(300);
  });
});

const equalShare = (floor: number) => Math.round((300 / 26) * (41 - floor));
