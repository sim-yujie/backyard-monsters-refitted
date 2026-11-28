import { describe, expect, test } from "bun:test";
import {
  GOO_BONUS_STEP_START,
  TRIBE_GOO_BONUS_BEFORE_STEPS,
  stepStartSeconds,
  tribeGooBonusPercent,
  withTribeGooBonus,
} from "./tribeGooBonus.js";

const START = "2026-11-28T10:00:00Z";
const T0 = Date.parse(START) / 1000;
const H = 3_600;

describe("tribeGooBonusPercent (patch 9.1 step-down)", () => {
  test("is 25% before the step-down (patch 6.9)", () => {
    expect(TRIBE_GOO_BONUS_BEFORE_STEPS).toBe(25);
  });

  test("stays 25% for good when no start is set", () => {
    expect(tribeGooBonusPercent(0, null)).toBe(25);
    expect(tribeGooBonusPercent(T0 + 1_000 * H, null)).toBe(25);
  });

  test("25% before the start, 20% from it, 10% from +48 h, none from +96 h", () => {
    expect(tribeGooBonusPercent(T0 - 1, START)).toBe(25);
    expect(tribeGooBonusPercent(T0, START)).toBe(20);
    expect(tribeGooBonusPercent(T0 + 48 * H - 1, START)).toBe(20);
    expect(tribeGooBonusPercent(T0 + 48 * H, START)).toBe(10);
    expect(tribeGooBonusPercent(T0 + 96 * H - 1, START)).toBe(10);
    expect(tribeGooBonusPercent(T0 + 96 * H, START)).toBe(0);
    expect(tribeGooBonusPercent(T0 + 365 * 24 * H, START)).toBe(0);
  });

  test("the shipped start is unset or a valid UTC time ending in Z", () => {
    if (GOO_BONUS_STEP_START === null) return;
    expect(GOO_BONUS_STEP_START).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/);
    expect(stepStartSeconds(GOO_BONUS_STEP_START)).not.toBeNull();
  });
});

describe("withTribeGooBonus", () => {
  test("adds 25% Goo from a tribe before the step-down and leaves the other resources alone", () => {
    expect(withTribeGooBonus({ r1: 1000, r2: 500, r3: 200, r4: 1000 }, true, T0 - 1, START)).toEqual({
      r1: 1000,
      r2: 500,
      r3: 200,
      r4: 1250,
    });
  });

  test("follows the clock: 1.20, then 1.10, then nothing", () => {
    expect(withTribeGooBonus({ r4: 1000 }, true, T0, START).r4).toBe(1200);
    expect(withTribeGooBonus({ r4: 1000 }, true, T0 + 48 * H, START).r4).toBe(1100);
    const credit = { r1: 5, r2: 5, r3: 5, r4: 1000 };
    expect(withTribeGooBonus(credit, true, T0 + 96 * H, START)).toBe(credit);
  });

  test("rounds down", () => {
    expect(withTribeGooBonus({ r1: 0, r2: 0, r3: 0, r4: 3 }, true, T0 - 1, START).r4).toBe(3);
    expect(withTribeGooBonus({ r1: 0, r2: 0, r3: 0, r4: 7 }, true, T0 - 1, START).r4).toBe(8);
    expect(withTribeGooBonus({ r4: 9 }, true, T0 + 48 * H, START).r4).toBe(9);
  });

  test("changes nothing for a player's yard", () => {
    const credit = { r1: 10, r2: 10, r3: 10, r4: 1000 };
    expect(withTribeGooBonus(credit, false, T0 - 1, START)).toBe(credit);
  });

  test("changes nothing when there is no Goo", () => {
    const credit = { r1: 10, r2: 10, r3: 10, r4: 0 };
    expect(withTribeGooBonus(credit, true, T0 - 1, START)).toBe(credit);
  });
});
