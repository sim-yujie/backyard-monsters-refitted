import { describe, expect, test } from "bun:test";

import { factorPieces, parseHistory, weightedFactor } from "./productionHistory.js";

describe("factorPieces", () => {
  test("a plain factor is one piece", () => {
    expect(factorPieces(0, 100, 1.2)).toEqual([{ from: 0, to: 100, factor: 1.2 }]);
  });

  test("splits at each step, the current factor after the last", () => {
    const schedule = { past: [{ until: 30, factor: 1 }, { until: 60, factor: 1.1 }], current: 1.3 };
    expect(factorPieces(0, 100, schedule)).toEqual([
      { from: 0, to: 30, factor: 1 },
      { from: 30, to: 60, factor: 1.1 },
      { from: 60, to: 100, factor: 1.3 },
    ]);
  });

  test("skips steps already passed and stops at the window's end", () => {
    const schedule = { past: [{ until: 5, factor: 9 }, { until: 200, factor: 1 }], current: 2 };
    expect(factorPieces(10, 100, schedule)).toEqual([{ from: 10, to: 100, factor: 1 }]);
  });
});

describe("weightedFactor", () => {
  test("weights each piece by the ticks paid in it", () => {
    const ticksFrom = (start: number) => Math.max(0, Math.floor((100 - start) / 10));
    expect(weightedFactor(0, 100, { past: [{ until: 50, factor: 1 }], current: 2 }, ticksFrom)).toBe(1.5);
  });
});

describe("parseHistory", () => {
  test("reads the stored list, drops junk, sorts by time", () => {
    expect(parseHistory('[{"until":20,"factor":1.1},{"until":10,"factor":1},{"until":"x"}]')).toEqual([
      { until: 10, factor: 1 },
      { until: 20, factor: 1.1 },
    ]);
    expect(parseHistory(null)).toEqual([]);
  });
});
