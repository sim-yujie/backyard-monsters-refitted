import { describe, expect, test } from "bun:test";
import {
  bufferCeiling,
  canProduce,
  cycleSeconds,
  cyclesIn,
  harvesterRates,
  runHarvester,
  type HarvesterRates,
} from "./production.js";

/** A level 1 Twig Snapper: 2 per 10 s cycle into a 720 buffer. */
const L1: HarvesterRates = { produce: 2, cycle: 10, capacity: 720 };

describe("harvesterRates", () => {
  test("reads the ladder at the level", () => {
    expect(harvesterRates(1, 1)).toEqual(L1);
    expect(harvesterRates(4, 10)).toEqual({ produce: 56, cycle: 10, capacity: 775018 });
  });

  test("is null for anything that does not produce", () => {
    expect(harvesterRates(6, 3)).toBeNull();
    expect(harvesterRates(20, 1)).toBeNull();
  });

  test("slows the cycle with damage", () => {
    expect(harvesterRates(1, 1, 50, 100)?.cycle).toBe(30);
  });
});

describe("cycleSeconds", () => {
  test("is the base cycle at full health or unknown health", () => {
    expect(cycleSeconds(10)).toBe(10);
    expect(cycleSeconds(10, 100, 100)).toBe(10);
    expect(cycleSeconds(10, 150, 100)).toBe(10);
  });

  test("is three times the base at half health, as productionTimeout", () => {
    expect(cycleSeconds(10, 50, 100)).toBe(30);
    // 10 + ceil(10 × (4 − 4 × 0.75)) = 10 + 10
    expect(cycleSeconds(10, 75, 100)).toBe(20);
  });
});

describe("canProduce", () => {
  test("needs half health and more than none", () => {
    expect(canProduce(undefined, 100)).toBe(true);
    expect(canProduce(50, 100)).toBe(true);
    expect(canProduce(49, 100)).toBe(false);
    expect(canProduce(0, 100)).toBe(false);
  });
});

describe("cyclesIn", () => {
  test("counts the first cycle at its own length, then whole cycles", () => {
    expect(cyclesIn(3, 4, 10)).toBe(0);
    expect(cyclesIn(4, 4, 10)).toBe(1);
    expect(cyclesIn(24, 4, 10)).toBe(3);
  });
});

describe("runHarvester", () => {
  test("counts a part-way cycle down without producing", () => {
    expect(runHarvester({ stored: 10, countdown: 7 }, L1, 5)).toEqual({ stored: 10, countdown: 2 });
  });

  test("finishes the running cycle first, then whole cycles, keeping the remainder", () => {
    // 7 s to the first, then 10 s each: 7, 17, 27 → three cycles in 30 s, 4 s into the fourth.
    expect(runHarvester({ stored: 10, countdown: 7 }, L1, 31)).toEqual({ stored: 16, countdown: 6 });
  });

  test("starts a fresh cycle when it was not producing and has room", () => {
    expect(runHarvester({ stored: 0, countdown: null }, L1, 0)).toEqual({ stored: 0, countdown: 10 });
    expect(runHarvester({ stored: 0, countdown: null }, L1, 3600)).toEqual({ stored: 720, countdown: null });
  });

  test("stops at the capacity and clamps an overfull buffer", () => {
    expect(runHarvester({ stored: 719, countdown: 1 }, L1, 1000)).toEqual({ stored: 720, countdown: null });
    expect(runHarvester({ stored: 900, countdown: 5 }, L1, 10)).toEqual({ stored: 720, countdown: null });
  });

  test("multiplies each cycle by the overdrive power", () => {
    expect(runHarvester({ stored: 0, countdown: 10 }, L1, 20, 2)).toEqual({ stored: 8, countdown: 10 });
  });

  test("two runs make one: a then b equals a + b", () => {
    const start = { stored: 3, countdown: 4 };
    for (const [a, b] of [
      [0, 0],
      [3, 1],
      [4, 10],
      [17, 23],
      [100, 1000],
    ] as const) {
      expect(runHarvester(runHarvester(start, L1, a), L1, b)).toEqual(runHarvester(start, L1, a + b));
    }
  });
});

describe("bufferCeiling", () => {
  test("is the audit's bound: one cycle more than the whole ones", () => {
    expect(bufferCeiling(1, 1, 0, 60)).toBe(14);
    expect(bufferCeiling(1, 1, 0, 3600)).toBe(720);
  });

  test("is never below what the exact run produces from the same buffer", () => {
    for (const elapsed of [0, 9, 10, 61, 999]) {
      const exact = runHarvester({ stored: 5, countdown: 3 }, L1, elapsed).stored;
      expect(bufferCeiling(1, 1, 5, elapsed)).toBeGreaterThanOrEqual(exact);
    }
  });
});
