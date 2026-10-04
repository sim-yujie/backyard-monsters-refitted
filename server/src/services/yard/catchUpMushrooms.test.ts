import { describe, expect, test } from "bun:test";
import { catchUpYard, type CatchUpSave } from "./catchUp.js";
import { catchUpMushrooms } from "./catchUpMushrooms.js";
import { overlaps, rectOf } from "../yardplanner/layoutGeometry.js";
import {
  MUSHROOM_CAP,
  MUSHROOM_RESPAWN_SECONDS,
  readMushrooms,
  type MushroomYardSave,
} from "./mushrooms.js";

/**
 * Catch-up step 3, mushrooms (`docs/design/yard-buildings.md` §5.6): one per
 * 17,280 s since the last spawn, at most 10 at a time and 10 in the yard
 * (owner decision 2026-09-28).
 */

const LAST = 1_700_000_000;
const PERIOD = MUSHROOM_RESPAWN_SECONDS;

const saveOf = (count: number, s: number | undefined = LAST): MushroomYardSave => ({
  buildingdata: { "0": { id: 0, t: 14, x: 0, y: 0, X: 0, Y: 0, l: 3 } },
  storedata: {},
  mushrooms: {
    l: Array.from({ length: count }, (_, i) => [1, -480 + i * 40, 360]),
    ...(s === undefined ? {} : { s }),
  },
});

const countOf = (save: MushroomYardSave): number => readMushrooms(save.mushrooms).l.length;

describe("catchUpMushrooms", () => {
  test("less than one period since the last spawn grows nothing and leaves s alone", () => {
    const save = saveOf(3);

    catchUpMushrooms(save, LAST + PERIOD - 1);

    expect(countOf(save)).toBe(3);
    expect(save.mushrooms!.s).toBe(LAST);
  });

  test("one mushroom per whole period; s moves to now and the part-period is dropped", () => {
    const save = saveOf(3);

    catchUpMushrooms(save, LAST + 2 * PERIOD + 500);

    expect(countOf(save)).toBe(5);
    expect(save.mushrooms!.s).toBe(LAST + 2 * PERIOD + 500);
  });

  test("a mushroom a building stands on pops up on free ground, period or not (#263)", () => {
    const save = saveOf(2);
    // A wall put down on the second mushroom.
    save.buildingdata!["5"] = { id: 5, t: 17, X: -440, Y: 360 } as never;

    catchUpMushrooms(save, LAST + 1);

    const { l, s } = readMushrooms(save.mushrooms);
    expect(s).toBe(LAST);
    expect(l).toHaveLength(2);
    expect(l[0]).toEqual([1, -480, 360]);
    expect(l[1]).not.toEqual([1, -440, 360]);
    expect(l[1]![0]).toBe(1);
    const wall = rectOf(17, -440, 360);
    const hall = rectOf(14, 0, 0);
    const moved = rectOf(7, l[1]![1], l[1]![2]);
    expect(overlaps(moved, wall) || overlaps(moved, hall)).toBe(false);
  });

  test("at most 10 in one catch-up", () => {
    const save = saveOf(0);

    catchUpMushrooms(save, LAST + 30 * PERIOD);

    expect(countOf(save)).toBe(10);
  });

  test("never more than 10 in the yard; s still moves when the yard is full", () => {
    const save = saveOf(7);
    catchUpMushrooms(save, LAST + 10 * PERIOD);
    expect(countOf(save)).toBe(MUSHROOM_CAP);

    const full = saveOf(10);
    catchUpMushrooms(full, LAST + 3 * PERIOD);
    expect(countOf(full)).toBe(10);
    expect(full.mushrooms!.s).toBe(LAST + 3 * PERIOD);
  });

  test("a yard already above 10 keeps every mushroom and grows none", () => {
    const save = saveOf(16);
    const before = structuredClone(save.mushrooms!.l);

    catchUpMushrooms(save, LAST + 5 * PERIOD);

    expect(countOf(save)).toBe(16);
    expect(save.mushrooms!.l).toEqual(before);
    expect(save.mushrooms!.s).toBe(LAST + 5 * PERIOD);
  });

  test("a yard that never had a spawn gets one burst", () => {
    const save: MushroomYardSave = { ...saveOf(0), mushrooms: {} };

    catchUpMushrooms(save, LAST);

    expect(countOf(save)).toBe(10);
    expect(save.mushrooms!.s).toBe(LAST);
  });

  test("idempotent: a second run at the same moment changes nothing", () => {
    const save = saveOf(2);
    catchUpMushrooms(save, LAST + PERIOD);
    const after = structuredClone(save.mushrooms);

    catchUpMushrooms(save, LAST + PERIOD);

    expect(save.mushrooms).toEqual(after);
  });
});

describe("catchUpYard runs the mushroom step", () => {
  test("mushrooms grow in a full catch-up and nothing is reported for them", () => {
    const save = { ...saveOf(1), savetime: LAST, points: "0" } as CatchUpSave;

    const completed = catchUpYard(save, LAST + PERIOD);

    expect(countOf(save)).toBe(2);
    expect(completed).toEqual([]);
  });
});
