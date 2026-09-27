import { describe, expect, test } from "bun:test";
import { catchUpYard, type CatchUpSave } from "./catchUp.js";
import { catchUpMushrooms } from "./catchUpMushrooms.js";
import { MUSHROOM_RESPAWN_SECONDS, readMushrooms, type MushroomYardSave } from "./mushrooms.js";

/**
 * Catch-up step 3, mushrooms (`docs/design/yard-buildings.md` §5.6): one per
 * 17,280 s since the last spawn, at most 10 at a time and 20 in the yard.
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

  test("at most 10 in one catch-up", () => {
    const save = saveOf(0);

    catchUpMushrooms(save, LAST + 30 * PERIOD);

    expect(countOf(save)).toBe(10);
  });

  test("never more than 20 in the yard; s still moves when the yard is full", () => {
    const save = saveOf(15);
    catchUpMushrooms(save, LAST + 10 * PERIOD);
    expect(countOf(save)).toBe(20);

    const full = saveOf(20);
    catchUpMushrooms(full, LAST + 3 * PERIOD);
    expect(countOf(full)).toBe(20);
    expect(full.mushrooms!.s).toBe(LAST + 3 * PERIOD);
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
