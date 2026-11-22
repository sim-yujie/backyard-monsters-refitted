import { describe, expect, it } from "vitest";
import { hccLimits } from "./hatchPlan";
import { boxesOf, presetLimits, presetListOf } from "./hccPresets";

/** Beta 9: the HCC's levels and presets, as the client mirrors the server's rules (`hccPresets.ts`). */
describe("HCC levels and presets on the client", () => {
  it("levels: 7 x 20 and 2 presets, 10 x 20 and 4, 10 x 30 and 6", () => {
    expect([1, 2, 3].map(hccLimits)).toEqual([
      { level: 1, stacks: 7, size: 20, presets: 2 },
      { level: 2, stacks: 10, size: 20, presets: 4 },
      { level: 3, stacks: 10, size: 30, presets: 6 },
    ]);
  });

  it("the main yard's list follows its HCC; an outpost's its own, or 6 run from a level 3 home", () => {
    expect(presetLimits("home", 1)).toEqual({ slots: 2, boxes: 7, size: 20 });
    expect(presetLimits("home", 3)).toEqual({ slots: 6, boxes: 10, size: 30 });
    expect(presetLimits("out", 1)).toEqual({ slots: 2, boxes: 10, size: 20 });
    expect(presetLimits("out", 2)).toEqual({ slots: 4, boxes: 10, size: 20 });
    expect(presetLimits("out", 1, 3)).toEqual({ slots: 6, boxes: 10, size: 20 });
  });

  it("reads a list in order and counts boxes per stack", () => {
    const wire = { home: [[["C1", 30], ["C2", 40], ["C1", 30]] as [string, number][], []], out: [[["C7", 5]] as [string, number][]] };
    expect(presetListOf(wire, "home")).toEqual([[["C1", 30], ["C2", 40], ["C1", 30]], []]);
    expect(presetListOf(wire, "out")).toEqual([[["C7", 5]]]);
    expect(presetListOf(null, "home")).toEqual([]);
    expect(boxesOf([["C1", 30], ["C2", 40], ["C1", 30]], 20)).toBe(6);
    expect(boxesOf([["C1", 30], ["C2", 40], ["C1", 30]], 30)).toBe(4);
  });
});
