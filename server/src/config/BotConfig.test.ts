import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  botPace,
  DAYS_ON_LEVEL,
  daysBetween,
  daysOn,
  DEFAULT_BOTS_FLOOR_LEVEL,
  botFloorLevel,
  levelWeights,
  seededYardsOn,
} from "./BotConfig.js";
import { isSwitchOn, positiveNumber } from "./envValues.js";

const KEYS = ["BOTS_FLOOR_LEVEL", "BOTS_PACE_SCALE", "ENV"];
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

describe("what is left of the bot settings (bot system removed in beta 9)", () => {
  test("seeded Map Room 2 dev yards are given everywhere but production (issue #233)", () => {
    expect(seededYardsOn({})).toBe(true);
    expect(seededYardsOn({ ENV: "local" })).toBe(true);
    expect(seededYardsOn({ ENV: "production" })).toBe(false);
  });

  test("the pace scale stretches the growth curve, and anything but a positive number reads as 1", () => {
    expect(botPace()).toBe(DAYS_ON_LEVEL);
    expect(botPace("2")).toEqual(DAYS_ON_LEVEL.map((days) => days * 2));
    for (const bad of ["", "0", "-1", "fast"]) expect(botPace(bad)).toBe(DAYS_ON_LEVEL);
    process.env.BOTS_PACE_SCALE = "0.1";
    expect(botPace()).toEqual(DAYS_ON_LEVEL.map((days) => days * 0.1));
  });
});

describe("the environment readers (envValues.ts)", () => {
  test("on or true turns a switch on; anything else leaves it off", () => {
    for (const on of ["on", "ON", " true ", "True"]) expect(isSwitchOn(on)).toBe(true);
    for (const off of [undefined, "", "off", "1", "yes", "false"]) expect(isSwitchOn(off)).toBe(false);
  });

  test("a positive number, or the fallback", () => {
    expect(positiveNumber("2.5", 1)).toBe(2.5);
    for (const bad of [undefined, "", "0", "-3", "many"]) expect(positiveNumber(bad, 7)).toBe(7);
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
});
