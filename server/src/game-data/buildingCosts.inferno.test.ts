import { describe, expect, test } from "bun:test";
import {
  COSTS,
  costOf,
  fortifyStepsOf,
  hallTypeOf,
  INFERNO_BUILDABLE_TYPES,
  INFERNO_COST_ROWS,
  INFERNO_COSTS,
  INFERNO_TRAITS,
  maxLevel,
  productionOf,
  propsFor,
  siloCapacity,
  UNDER_HALL_TYPE,
} from "./buildingCosts.js";

/**
 * The Inferno props table (`client/scripts/INFERNOYARDPROPS.as`), generated
 * beside the main and outpost ones (WP 1.1, `docs/design/inferno.md` §2.5).
 *
 * A golden test: every number below is copied from the Flash file by hand, not
 * from the generated table, so a generator that stops reading a field fails
 * here rather than charging the player nothing.
 */

/** `[type, quantity by Under Hall level 0..6, level cap]`, design §2.5. */
const INFERNO_BUILDABLE: readonly (readonly [number, readonly number[], number])[] = [
  [1, [0, 1, 2, 4, 5, 6, 6], 10],
  [2, [0, 1, 2, 4, 5, 6, 6], 10],
  [3, [0, 1, 2, 4, 5, 6, 6], 10],
  [4, [0, 1, 2, 4, 5, 6, 6], 10],
  [6, [0, 2, 2, 3, 4, 5, 5], 10],
  [8, [0, 1, 1, 1, 1, 1, 1], 4],
  [9, [0, 0, 0, 1, 1, 1, 1], 3],
  // Flash blocked it; buildable by owner decision 2026-10-29 (Flash's own row).
  [10, [0, 0, 0, 1, 1, 1, 1], 1],
  [13, [0, 1, 2, 3, 4, 5, 5], 3],
  [17, [0, 0, 30, 60, 120, 200, 220], 3],
  [21, [0, 2, 3, 3, 4, 4, 6], 7],
  [24, [0, 0, 8, 15, 20, 28, 35], 1],
  [26, [1, 1, 1, 1, 2, 2, 2], 4],
  [128, [0, 1, 1, 1, 1, 1, 1], 6],
  [129, [0, 0, 0, 2, 2, 4, 4], 6],
  [130, [0, 2, 3, 3, 4, 4, 6], 7],
  [132, [0, 0, 0, 1, 2, 2, 3], 6],
];

/** Under Hall level 0..6: what the yard may hold of `type`. */
const capAt = (type: number, hall: number): number => INFERNO_COSTS[type]?.quantity[hall] ?? 0;

describe("the Inferno cost table", () => {
  test("offers exactly design §2.5's buildings, with their caps and level caps", () => {
    expect([...INFERNO_BUILDABLE_TYPES]).toEqual(INFERNO_BUILDABLE.map(([type]) => type));
    for (const [type, caps, levels] of INFERNO_BUILDABLE) {
      caps.forEach((cap, hall) => expect(capAt(type, hall), `${type} at UH${hall}`).toBe(cap));
      expect(maxLevel(type, "inferno"), `${type} levels`).toBe(levels);
    }
  });

  test("blocks the surface-only types and the Under Hall", () => {
    for (const type of [5, 11, 12, 14, 15, 16, 19, 20, 22, 23, 25, 51, 113, 114, 115, 116, 118, 119]) {
      expect(INFERNO_BUILDABLE_TYPES, `${type}`).not.toContain(type);
    }
    expect(INFERNO_TRAITS[5]?.blocked).toBe(true);
    expect(INFERNO_TRAITS[14]?.blocked).toBe(true);
    expect(INFERNO_TRAITS[15]?.blocked).toBe(true);
    expect(INFERNO_TRAITS[128]?.blocked).toBe(false);
    expect(INFERNO_TRAITS[10]?.blocked).toBe(false);
  });

  test("the Under Hall is type 14 with Flash's six steps (INFERNOYARDPROPS.as:1079)", () => {
    expect(UNDER_HALL_TYPE).toBe(14);
    expect(hallTypeOf("inferno")).toBe(14);
    expect(INFERNO_COSTS[14]?.name).toBe("Under Hall");
    expect(INFERNO_COSTS[14]?.costs.map(([r1, r2, r3, r4, time]) => [r1, r2, r3, r4, time])).toEqual([
      [0, 0, 0, 0, 10],
      [7000, 7000, 0, 0, 600],
      [42000, 42000, 0, 0, 14400],
      [240000, 240000, 0, 0, 57600],
      [1400000, 1400000, 0, 0, 172800],
      [7560000, 7560000, 0, 0, 345600],
    ]);
  });

  test("keeps the Juicer at Flash's 1M/1M/1M from Under Hall 3 (I16, R2)", () => {
    expect(costOf(9, "inferno")?.costs[0]).toEqual([1000000, 1000000, 1000000, 0, 43200, [[14, 1, 1], [128, 1, 1]]]);
    expect(capAt(9, 2)).toBe(0);
    expect(capAt(9, 3)).toBe(1);
  });

  test("gates the Incubator on a Housing Bunker, the Locker on an Incubator, the Academy on UH3 + Locker 2", () => {
    expect(costOf(13, "inferno")?.costs[0]?.[5]).toEqual([[14, 1, 1], [128, 1, 1]]);
    expect(costOf(8, "inferno")?.costs[0]?.[5]).toEqual([[14, 1, 1], [13, 1, 1]]);
    expect(costOf(26, "inferno")?.costs[0]?.[5]).toEqual([[14, 1, 3], [8, 1, 2]]);
  });

  test("prices the Quake and Magma Towers as Flash (design §2.9)", () => {
    expect(costOf(129, "inferno")?.costs[0]).toEqual([312500, 187500, 125000, 0, 18000, [[14, 1, 3]]]);
    expect(costOf(132, "inferno")?.costs[0]).toEqual([187500, 250000, 62500, 0, 18000, [[14, 1, 3]]]);
    expect(costOf(129, "inferno")?.costs[5]).toEqual([16500000, 12687500, 7562500, 0, 475200, [[14, 1, 6]]]);
    expect(costOf(132, "inferno")?.costs[5]).toEqual([16000000, 15000000, 3000000, 0, 791200, [[14, 1, 6]]]);
  });

  test("carries the Housing Bunker's monster room, 780 at level 4 (R11)", () => {
    expect(INFERNO_TRAITS[128]?.capacity).toEqual([200, 300, 520, 780, 1140, 1820]);
    expect(INFERNO_TRAITS[128]?.hp).toEqual([4000, 14000, 25000, 43000, 75000, 130000]);
  });

  test("gives the four harvesters and the silo their own economy ladders", () => {
    for (const type of [1, 2, 3, 4]) {
      const stats = productionOf(type, "inferno");
      expect(stats?.produce.length, `${type}`).toBe(10);
      expect(stats?.cycleTime.length, `${type}`).toBe(10);
    }
    expect(siloCapacity(1, "inferno")).toBe(7500);
    expect(siloCapacity(10, "inferno")).toBe(3840000);
    expect(siloCapacity(0, "inferno")).toBe(0);
  });

  test("nothing in the Inferno fortifies", () => {
    for (const [type] of INFERNO_COST_ROWS) expect(fortifyStepsOf(type, "inferno")).toEqual([]);
  });

  test("leaves the main and outpost tables alone", () => {
    expect(propsFor("main")).toBe(COSTS);
    expect(propsFor("inferno")).toBe(INFERNO_COSTS);
    expect(hallTypeOf("main")).toBe(14);
    expect(costOf(14)?.costs.length).toBeGreaterThan(6);
  });
});
