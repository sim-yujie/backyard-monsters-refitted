import { describe, expect, test } from "bun:test";
import {
  BUILDING_COST_ROWS,
  COSTS,
  costOf,
  fortifyStepsOf,
  hallTypeOf,
  maxLevel,
  OUTPOST_CORE_TYPE,
  OUTPOST_COST_ROWS,
  OUTPOST_COSTS,
  OUTPOST_TRAITS,
  productionOf,
  propsFor,
} from "./buildingCosts.js";
import { townHallLevel, upgradeSteps } from "../services/yardplanner/costs.js";

/**
 * The outpost props table (`client/scripts/OUTPOST_YARD_PROPS.as`), generated
 * beside the main one. Mirrors `web/src/game/yard/buildingCosts.outpost.test.ts`:
 * the two copies hold identical rows, and the server charges what the client
 * shows. Line citations are into the ActionScript file.
 */

/** `[type, quantity[1], level cap]`, research §1.2. */
const OUTPOST_BUILDABLE: readonly (readonly [number, number, number])[] = [
  [1, 4, 10],
  [2, 4, 10],
  [3, 4, 10],
  [4, 4, 10],
  [5, 1, 4],
  [9, 1, 3],
  [10, 1, 1],
  [13, 2, 3],
  [15, 1, 6],
  [16, 1, 1],
  [17, 100, 5],
  [20, 4, 10],
  [21, 4, 10],
  [22, 2, 4],
  [23, 2, 6],
  [24, 25, 1],
  [25, 2, 6],
  [115, 2, 6],
  [117, 5, 1],
  [118, 1, 6],
];

describe("the outpost cost table", () => {
  test("offers exactly research §1.2's buildings, with its caps and level caps", () => {
    const offered = OUTPOST_COST_ROWS.filter(
      ([type, , , group, , quantity]) =>
        group >= 1 && group <= 4 && !OUTPOST_TRAITS[type]?.blocked && (quantity[1] ?? 0) > 0
    ).map(([type]) => type);
    expect(offered).toEqual(OUTPOST_BUILDABLE.map(([type]) => type));
    for (const [type, cap, levels] of OUTPOST_BUILDABLE) {
      expect(OUTPOST_COSTS[type]?.quantity[1]).toBe(cap);
      expect(maxLevel(type, "outpost")).toBe(levels);
    }
  });

  test("gives the core 200,000 hp, no build cost and four fortify steps", () => {
    // `OUTPOST_YARD_PROPS.as:5152-5245`.
    expect(OUTPOST_CORE_TYPE).toBe(112);
    expect(COSTS[112]).toBeUndefined();
    expect(costOf(112, "outpost")?.costs).toEqual([[0, 0, 0, 0, 10, []]]);
    expect(OUTPOST_TRAITS[112]?.hp).toEqual([200000]);
    expect(fortifyStepsOf(112, "outpost").map((step) => step.slice(0, 5))).toEqual([
      [250000, 50000, 25000, 0, 14400],
      [500000, 500000, 500000, 0, 57600],
      [2500000, 2500000, 1000000, 0, 172800],
      [5000000, 5000000, 2500000, 0, 345600],
    ]);
    expect(fortifyStepsOf(112, "main")).toEqual([]);
  });

  test("prices the outpost's own entries, with the core as the hall", () => {
    // Flinger `:605-611`, against the main yard's Map Room 2 price (`GLOBAL.as:684-690`).
    expect(costOf(5, "outpost")?.costs[0]).toEqual([10000, 10000, 5000, 0, 900, [[112, 1, 1]]]);
    expect(costOf(5)?.costs[0]).toEqual([1000, 1000, 500, 0, 900, [[14, 1, 1]]]);
    expect(upgradeSteps(23, 0, 8, "outpost")).toHaveLength(6);
    expect(upgradeSteps(23, 0, 8)).toHaveLength(8);
    // An outpost harvester's `produce` (`:22`, research §1.3: 56 per 10 s at L10).
    expect(productionOf(1, "outpost")?.produce.at(-1)).toBe(56);
  });

  test("picks the table and the hall by yard kind", () => {
    expect(propsFor("main")).toBe(COSTS);
    expect(propsFor("outpost")).toBe(OUTPOST_COSTS);
    expect(Object.keys(COSTS)).toHaveLength(BUILDING_COST_ROWS.length);
    expect(hallTypeOf("main")).toBe(14);
    expect(hallTypeOf("outpost")).toBe(112);
    const outpost = { "0": { t: 112, l: 1 }, "1": { t: 14, l: 7 } };
    expect(townHallLevel(outpost as never, "outpost")).toBe(1);
    expect(townHallLevel(outpost as never)).toBe(7);
    expect(townHallLevel({ "0": { t: 112, l: 1 } } as never)).toBe(0);
  });
});
