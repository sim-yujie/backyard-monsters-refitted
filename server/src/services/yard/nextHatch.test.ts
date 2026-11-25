import { describe, expect, test } from "bun:test";

import { nextHatchAt } from "./nextHatch.js";

describe("nextHatchAt (live map, beta 9)", () => {
  test("the soonest producing hatchery's countdown", () => {
    const monsters = { h: [["C1", 120, []], ["C2", 30, []], ["", 0, []]], hstage: [1, 1, 0] };
    expect(nextHatchAt(monsters, 1000)).toBe(1030);
  });

  test("a hatchery waiting for housing, or none at all, gives nothing", () => {
    expect(nextHatchAt({ h: [["C1", 0, []]], hstage: [2] }, 1000)).toBeUndefined();
    expect(nextHatchAt({}, 1000)).toBeUndefined();
    expect(nextHatchAt(null, 1000)).toBeUndefined();
  });

  test("the overdrive brings it forward while it runs", () => {
    // 100 s of work at 2x for the next 30 s: 60 s of work in 30 s, then 40 s at 1x.
    expect(nextHatchAt({ h: [["C1", 100, []]], hstage: [1], overdrivepower: 2, overdrivetime: 30 }, 0)).toBe(70);
    // All of it inside the overdrive.
    expect(nextHatchAt({ h: [["C1", 40, []]], hstage: [1], overdrivepower: 4, overdrivetime: 30 }, 0)).toBe(10);
  });
});
