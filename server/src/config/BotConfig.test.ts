import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  botConfig,
  DAYS_ON_LEVEL,
  daysBetween,
  daysOn,
  DEFAULT_BOTS_GROWING_FLOW,
  DEFAULT_BOTS_LEVEL_SLACK,
  DEFAULT_BOTS_NEW_PER_DAY,
  DEFAULT_BOTS_QUIET_RATE,
  DEFAULT_BOTS_TOTAL,
  LEVEL_WEIGHTS,
} from "./BotConfig.js";

const KEYS = [
  "BOTS_FILL",
  "BOTS_BRAIN",
  "BOTS_REVENGE",
  "BOTS_TOTAL",
  "BOTS_PACE_SCALE",
  "BOTS_QUIET_RATE",
  "BOTS_GROWING_FLOW",
  "BOTS_NEW_PER_DAY",
  "BOTS_LEVEL_SLACK",
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
      total: DEFAULT_BOTS_TOTAL,
      pace: DAYS_ON_LEVEL,
      quietRate: DEFAULT_BOTS_QUIET_RATE,
      growingFlow: DEFAULT_BOTS_GROWING_FLOW,
      newPerDay: DEFAULT_BOTS_NEW_PER_DAY,
      levelSlack: DEFAULT_BOTS_LEVEL_SLACK,
      seeded: true,
    });
    expect(DEFAULT_BOTS_TOTAL).toBe(500);
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
      expect(botConfig()).toMatchObject({ total: DEFAULT_BOTS_TOTAL, pace: DAYS_ON_LEVEL });
    }
  });

  test("the quiet rate takes 0-1, the daily cap and slack whole numbers, the flow a positive number", () => {
    process.env.BOTS_QUIET_RATE = "0";
    process.env.BOTS_NEW_PER_DAY = "0";
    process.env.BOTS_LEVEL_SLACK = "3";
    process.env.BOTS_GROWING_FLOW = "0.6";
    expect(botConfig()).toMatchObject({ quietRate: 0, newPerDay: 0, levelSlack: 3, growingFlow: 0.6 });

    for (const bad of ["", "1.5", "-0.1", "lots"]) {
      process.env.BOTS_QUIET_RATE = bad;
      process.env.BOTS_NEW_PER_DAY = bad === "" ? "2.5" : bad;
      process.env.BOTS_LEVEL_SLACK = bad;
      process.env.BOTS_GROWING_FLOW = bad === "" ? "0" : bad === "1.5" ? "-1" : bad;
      expect(botConfig()).toMatchObject({
        quietRate: DEFAULT_BOTS_QUIET_RATE,
        newPerDay: DEFAULT_BOTS_NEW_PER_DAY,
        levelSlack: DEFAULT_BOTS_LEVEL_SLACK,
        growingFlow: DEFAULT_BOTS_GROWING_FLOW,
      });
    }
  });
});

describe("the growth curve [PLACEHOLDER]", () => {
  test("a day or more for each level 1-40, never faster later, fast early and slow late", () => {
    expect(DAYS_ON_LEVEL).toHaveLength(41);
    for (let level = 2; level <= 40; level++) expect(DAYS_ON_LEVEL[level]!).toBeGreaterThanOrEqual(DAYS_ON_LEVEL[level - 1]!);
    expect(DAYS_ON_LEVEL[1]!).toBeGreaterThan(0);
    // About a real player's climb: level 10 in a day or two, 20 in about ten, 30 in about three months, 40 in about 600 days.
    expect(daysBetween(1, 10, DAYS_ON_LEVEL)).toBeLessThan(2);
    expect(daysBetween(1, 20, DAYS_ON_LEVEL)).toBeGreaterThan(5);
    expect(daysBetween(1, 20, DAYS_ON_LEVEL)).toBeLessThan(15);
    expect(daysBetween(1, 30, DAYS_ON_LEVEL)).toBeGreaterThan(60);
    expect(daysBetween(1, 30, DAYS_ON_LEVEL)).toBeLessThan(120);
    expect(daysBetween(1, 40, DAYS_ON_LEVEL)).toBeGreaterThan(450);
    expect(daysBetween(1, 41, DAYS_ON_LEVEL)).toBeGreaterThan(800);
  });

  test("a number is the same days on every level; past the table, its last level", () => {
    expect(daysOn(3, 1)).toBe(3);
    expect(daysOn(3, 40)).toBe(3);
    expect(daysOn(DAYS_ON_LEVEL, 41)).toBe(DAYS_ON_LEVEL[40]!);
    expect(daysBetween(10, 12.5, 3)).toBeCloseTo(7.5, 9);
    expect(daysBetween(12, 11.5, 3)).toBe(0);
  });

  test("every level 1-40 has a share of the total", () => {
    expect(LEVEL_WEIGHTS).toHaveLength(40);
    for (const weight of LEVEL_WEIGHTS) expect(weight).toBeGreaterThan(0);
  });
});
