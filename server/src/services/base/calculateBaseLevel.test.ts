import { describe, expect, test } from "bun:test";
import { calculateBaseLevel, playerLevelOf } from "./calculateBaseLevel.js";

describe("playerLevelOf (issue #167)", () => {
  test("reads the level off a save's points and base value, as `BASE.BaseLevel()` does", () => {
    expect(playerLevelOf({ points: "0", basevalue: "0" })).toBe(1);
    expect(playerLevelOf({ points: "600", basevalue: "300" })).toBe(2);
    expect(playerLevelOf({ points: "7000", basevalue: "500" })).toBe(5);
    expect(playerLevelOf({ points: "5000", basevalue: "2000" })).toBe(calculateBaseLevel("5000", "2000"));
  });

  test("is level 1 for a save with no points recorded", () => {
    expect(playerLevelOf({})).toBe(1);
    expect(playerLevelOf({ points: null, basevalue: null })).toBe(1);
  });
});
