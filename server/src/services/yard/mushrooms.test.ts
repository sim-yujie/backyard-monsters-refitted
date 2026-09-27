import { describe, expect, test } from "bun:test";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { overlaps, rectOf, yardSize } from "../yardplanner/layoutGeometry.js";
import {
  GOLDEN_BIG,
  GOLDEN_SMALL,
  MUSHROOM_CAP,
  planMushroomPick,
  readMushrooms,
  rollReward,
  spawnMushrooms,
  type MushroomEntry,
  type MushroomYardSave,
  type Random,
} from "./mushrooms.js";

/**
 * Mushroom rules (`docs/design/yard-buildings.md` §5.6): reading the Flash
 * shape, growing on free ground, and the pick with its server-side roll.
 */

/** A random source that plays `values` in order, then repeats the last one. */
const sequence = (...values: number[]): Random => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
};

const HALL = 14;

/** A Town Hall at the origin and one worker, nothing else. */
const yard = (overrides: Partial<MushroomYardSave> = {}): MushroomYardSave => ({
  buildingdata: { "0": { id: 0, t: HALL, x: 0, y: 0, X: 0, Y: 0, l: 3 } } as BuildingDataMap,
  storedata: {},
  mushrooms: { l: [[2, 300, 200], [3, -300, 50]], s: 1_700_000_000 },
  ...overrides,
});

const refusal = (run: () => unknown): ClientSafeError => {
  try {
    run();
  } catch (err) {
    if (err instanceof ClientSafeError) return err;
    throw err;
  }
  throw new Error("expected a refusal");
};

describe("readMushrooms", () => {
  test("reads the Flash shape, [frame, X, Y], and the last spawn", () => {
    expect(readMushrooms({ l: [[2, 100, -40]], s: 1_700_000_000 })).toEqual({
      l: [[2, 100, -40]],
      s: 1_700_000_000,
    });
  });

  test("an object entry reads too; one without a position is dropped; a bad frame reads as 1", () => {
    expect(
      readMushrooms({ l: [{ frame: 4, X: 10, Y: 20 }, [1, "x", 3], [9, 5, 6]], s: 5 }).l
    ).toEqual([
      [4, 10, 20],
      [1, 5, 6],
    ]);
  });

  test("an empty or missing column is no mushrooms and no spawn yet", () => {
    expect(readMushrooms({})).toEqual({ l: [], s: 0 });
    expect(readMushrooms(null)).toEqual({ l: [], s: 0 });
  });

  test("keeps the first 20, as the Flash load did", () => {
    const l = Array.from({ length: 25 }, (_, i) => [1, i * 40, 0]);
    expect(readMushrooms({ l, s: 1 }).l).toHaveLength(MUSHROOM_CAP);
  });
});

describe("spawnMushrooms", () => {
  test("each new mushroom stands inside the plot, off every building and every other mushroom", () => {
    const save = yard();
    const existing = readMushrooms(save.mushrooms).l;

    const list = spawnMushrooms(save, existing, 10, Math.random);

    expect(list).toHaveLength(12);
    expect(list.slice(0, 2)).toEqual(existing);
    const [width, height] = yardSize(0);
    const hall = rectOf(HALL, 0, 0);
    const rects = list.map(([, x, y]) => rectOf(7, x, y));
    for (const [index, rect] of rects.entries()) {
      expect(rect.x).toBeGreaterThanOrEqual(-width / 2);
      expect(rect.x + rect.w).toBeLessThanOrEqual(width / 2);
      expect(rect.y).toBeGreaterThanOrEqual(-height / 2);
      expect(rect.y + rect.h).toBeLessThanOrEqual(height / 2);
      expect(overlaps(rect, hall)).toBe(false);
      for (const other of rects.slice(index + 1)) expect(overlaps(rect, other)).toBe(false);
    }
    for (const [frame] of list.slice(2)) {
      expect(frame).toBeGreaterThanOrEqual(1);
      expect(frame).toBeLessThanOrEqual(5);
    }
  });

  test("gives up on a spot after 5000 misses: a full plot grows nothing", () => {
    // Every draw lands on the same point, which the first mushroom already holds.
    const save = yard({ buildingdata: {} });
    const existing: MushroomEntry[] = [[1, -500, -400]];

    expect(spawnMushrooms(save, existing, 3, () => 0)).toEqual(existing);
  });
});

describe("rollReward", () => {
  test("three times in four the mushroom is ordinary", () => {
    for (const draw of [0.25, 0.5, 0.99]) {
      expect(rollReward(sequence(draw))).toEqual({ golden: false, shiny: 0 });
    }
  });

  test("golden: variant 2 (the middle third) is 8 Shiny, variants 1 and 3 are 3", () => {
    expect(rollReward(sequence(0.1, 0.0))).toEqual({ golden: true, shiny: GOLDEN_SMALL });
    expect(rollReward(sequence(0.1, 0.4))).toEqual({ golden: true, shiny: GOLDEN_BIG });
    expect(rollReward(sequence(0.1, 0.9))).toEqual({ golden: true, shiny: GOLDEN_SMALL });
  });
});

describe("planMushroomPick", () => {
  test("removes the mushroom at the index, keeps the last spawn, rolls the reward", () => {
    const pick = planMushroomPick(yard(), 1, { x: -300, y: 50 }, sequence(0.1, 0.5));

    expect(pick.report).toEqual({ id: 1, x: -300, y: 50, golden: true, shiny: GOLDEN_BIG });
    expect(pick.shiny).toBe(GOLDEN_BIG);
    expect(pick.mushrooms).toEqual({ l: [[2, 300, 200]], s: 1_700_000_000 });
  });

  test("an ordinary mushroom gives nothing and still goes", () => {
    const pick = planMushroomPick(yard(), 0, {}, sequence(0.9));

    expect(pick.report).toMatchObject({ golden: false, shiny: 0 });
    expect(pick.mushrooms.l).toEqual([[3, -300, 50]]);
  });

  test("an index the list does not have is 400 badRequest", () => {
    const err = refusal(() => planMushroomPick(yard(), 2, {}, Math.random));
    expect(err.status).toBe(400);
    expect(err.data).toEqual({ reason: "badRequest", id: 2 });
  });

  test("a position that no longer matches is 409 moved", () => {
    const err = refusal(() => planMushroomPick(yard(), 0, { x: -300, y: 50 }, Math.random));
    expect(err.status).toBe(409);
    expect(err.data).toEqual({ reason: "moved", id: 0, at: { x: 300, y: 200 } });
  });

  test("every worker busy is 409 workers", () => {
    const save = yard();
    save.buildingdata!["1"] = { id: 1, t: 20, x: 0, y: 0, X: 300, Y: 300, l: 1, cU: 100 };

    const err = refusal(() => planMushroomPick(save, 0, {}, Math.random));
    expect(err.status).toBe(409);
    expect(err.data).toEqual({ reason: "workers", workers: { total: 1, busy: 1 } });
  });

  test("a second worker picks while the first is busy", () => {
    const save = yard({ storedata: { BEW: { q: 1 } } });
    save.buildingdata!["1"] = { id: 1, t: 20, x: 0, y: 0, X: 300, Y: 300, l: 1, cU: 100 };

    expect(planMushroomPick(save, 0, {}, sequence(0.9)).report.id).toBe(0);
  });
});
