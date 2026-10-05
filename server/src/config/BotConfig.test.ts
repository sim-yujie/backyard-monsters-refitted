import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { botConfig, DEFAULT_BOTS_DAYS_PER_LEVEL, DEFAULT_BOTS_TOTAL } from "./BotConfig.js";

const KEYS = ["BOTS_FILL", "BOTS_BRAIN", "BOTS_REVENGE", "BOTS_TOTAL", "BOTS_DAYS_PER_LEVEL", "ENV"];
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
      daysPerLevel: DEFAULT_BOTS_DAYS_PER_LEVEL,
      seeded: true,
    });
    expect(DEFAULT_BOTS_TOTAL).toBe(500);
    expect(DEFAULT_BOTS_DAYS_PER_LEVEL).toBe(3);
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

  test("the count and pace take positive numbers and fall back otherwise", () => {
    process.env.BOTS_TOTAL = "750";
    process.env.BOTS_DAYS_PER_LEVEL = "1.5";
    expect(botConfig()).toMatchObject({ total: 750, daysPerLevel: 1.5 });

    for (const bad of ["", "0", "-3", "lots", "0.4"]) {
      process.env.BOTS_TOTAL = bad;
      process.env.BOTS_DAYS_PER_LEVEL = bad === "0.4" ? "0" : bad;
      expect(botConfig()).toMatchObject({ total: DEFAULT_BOTS_TOTAL, daysPerLevel: DEFAULT_BOTS_DAYS_PER_LEVEL });
    }
  });
});
