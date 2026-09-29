import { describe, expect, test } from "bun:test";
import { fallenIn, garrisonsAfterBattle, withGarrisons, withoutFallenGarrisons } from "./bunkerGarrison.js";

/**
 * A fallen Monster Bunker loses its garrison (issue #130), as Flash's Export
 * leaves a bunker at zero health with no `m` (`BUILDING22.as:683-700`).
 */

const yard = () => ({
  "5": { x: 0, y: 0, id: 5, t: 22, l: 2, m: { C1: 4, C3: 2 } },
  "6": { x: 0, y: 0, id: 6, t: 22, l: 1, m: { C2: 1 } },
  "9": { x: 0, y: 0, id: 12, t: 128, l: 1, m: { C5: 1 } },
  "7": { x: 0, y: 0, t: 22, l: 1, m: { C4: 3 } } as never,
  "8": { x: 0, y: 0, id: 8, t: 20, l: 1, m: { C1: 9 } },
  "10": { x: 0, y: 0, id: 10, t: 22, l: 1, m: {} },
});

describe("withoutFallenGarrisons", () => {
  test("empties only the fallen bunkers, keeping everything else on their entries", () => {
    const before = yard();
    const { buildingdata, emptied } = withoutFallenGarrisons(before, new Set([5, 12]));
    expect(buildingdata["5"]).toEqual({ x: 0, y: 0, id: 5, t: 22, l: 2 });
    expect(buildingdata["9"]).toEqual({ x: 0, y: 0, id: 12, t: 128, l: 1 });
    expect(buildingdata["6"]).toBe(before["6"]);
    expect(emptied).toEqual([5, 12]);
    // The rows it was handed are not changed under the caller.
    expect(before["5"].m).toEqual({ C1: 4, C3: 2 });
  });

  test("knows an entry with no `id` by its key, as the engine does", () => {
    expect(withoutFallenGarrisons(yard(), new Set([7])).buildingdata["7"]).not.toHaveProperty("m");
  });

  test("leaves a fallen building that is not a bunker, and an empty bunker, alone", () => {
    const { buildingdata, emptied } = withoutFallenGarrisons(yard(), new Set([8, 10]));
    expect(buildingdata["8"].m).toEqual({ C1: 9 });
    expect(buildingdata["10"].m).toEqual({});
    expect(emptied).toEqual([]);
  });

  test("copes with no buildingdata", () => {
    expect(withoutFallenGarrisons(null, new Set([1]))).toEqual({ buildingdata: {}, emptied: [] });
  });
});

describe("fallenIn", () => {
  test("is the ids a health map has at zero", () => {
    expect([...fallenIn({ "5": 0, "6": 1200, "12": 0, "7": -3 })].sort((a, b) => a - b)).toEqual([5, 7, 12]);
    expect(fallenIn(null).size).toBe(0);
  });
});

describe("withGarrisons (#195)", () => {
  const yard = {
    "5": { id: 5, t: 22, l: 1, X: 0, Y: 0, m: { C1: 4, C3: 2 } },
    "9": { id: 12, t: 128, l: 1, X: 200, Y: 0, m: { C5: 1 } },
    "7": { id: 7, t: 20, l: 1, X: 400, Y: 0 },
  };

  test("each bunker the battle fought with holds what it left, by engine id", () => {
    const after = withGarrisons(yard as never, { 5: { C1: 1, C3: 2 }, 12: {} });
    expect(after["5"] as unknown).toEqual({ id: 5, t: 22, l: 1, X: 0, Y: 0, m: { C1: 1, C3: 2 } });
    // An empty garrison drops `m`, as a fallen bunker's does.
    expect(after["9"] as unknown).toEqual({ id: 12, t: 128, l: 1, X: 200, Y: 0 });
    expect(after["7"]).toBe(yard["7"] as never);
  });

  test("leaves a bunker the battle had no garrison for as it was", () => {
    expect(withGarrisons(yard as never, {})["5"]).toBe(yard["5"] as never);
  });
});

describe("garrisonsAfterBattle (#195)", () => {
  const yard = {
    "5": { id: 5, t: 22, l: 1, X: 0, Y: 0, m: { C1: 4 } },
    "6": { id: 6, t: 22, l: 1, X: 200, Y: 0, m: { C2: 3 } },
  };

  test("a fallen bunker keeps only its defenders that were out; one the battle had none for is emptied", () => {
    const after = garrisonsAfterBattle(yard as never, {
      buildinghealthdata: { "5": 0, "6": 0 },
      bunkerGarrisons: { 5: { C1: 1 } },
    });
    expect((after["5"] as { m?: unknown }).m).toEqual({ C1: 1 });
    expect("m" in (after["6"] as object)).toBe(false);
  });
});
