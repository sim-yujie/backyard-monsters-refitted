import { describe, expect, test } from "bun:test";

import { parseAchievementRewards } from "./AchievementConfig.js";

describe("ACHIEVEMENT_REWARDS", () => {
  test("is on when unset or set to anything but off (owner, 2026-10-05)", () => {
    expect(parseAchievementRewards(undefined)).toBe(true);
    expect(parseAchievementRewards("")).toBe(true);
    expect(parseAchievementRewards("on")).toBe(true);
    expect(parseAchievementRewards("yes")).toBe(true);
  });

  test("is off only when set to off, in any case and with spaces", () => {
    expect(parseAchievementRewards("off")).toBe(false);
    expect(parseAchievementRewards(" OFF ")).toBe(false);
  });
});
