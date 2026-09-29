import { describe, expect, it } from "vitest";
import { pointerInPlanPane, splitPanes, STACK_BELOW } from "./CompareView";

/** The compare split (#9): side by side when wide, stacked when narrow. */

describe("splitPanes", () => {
  it("splits a wide canvas into two columns, plan's on the left", () => {
    expect(splitPanes(1440, 900)).toEqual([
      { x: 0, y: 0, width: 720, height: 900 },
      { x: 720, y: 0, width: 720, height: 900 },
    ]);
  });

  it("stacks the panes on a narrow canvas, plan's on top", () => {
    expect(STACK_BELOW).toBe(700);
    expect(splitPanes(412, 915)).toEqual([
      { x: 0, y: 0, width: 412, height: 457 },
      { x: 0, y: 457, width: 412, height: 458 },
    ]);
  });
});

describe("pointerInPlanPane", () => {
  it("maps a point over the slot's pane onto the same spot of the plan's", () => {
    const columns = splitPanes(1440, 900);
    expect(pointerInPlanPane({ x: 900, y: 300 }, columns)).toEqual({ x: 180, y: 300 });
    expect(pointerInPlanPane({ x: 100, y: 300 }, columns)).toEqual({ x: 100, y: 300 });

    const rows = splitPanes(412, 915);
    expect(pointerInPlanPane({ x: 100, y: 600 }, rows)).toEqual({ x: 100, y: 143 });
  });
});
