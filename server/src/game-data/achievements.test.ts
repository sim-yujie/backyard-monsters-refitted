import { describe, expect, test } from "bun:test";
import { ACHIEVEMENT_STATS, ACHIEVEMENTS, achievementById, AVAILABLE_ACHIEVEMENTS } from "./achievements.js";

/** The catalogue (`docs/design/achievements.md` §5.1, owner decisions of 2026-10-05). */
describe("the achievements catalogue", () => {
  test("holds Flash's 22, numbered 1 to 22 in order", () => {
    expect(ACHIEVEMENTS.map((entry) => entry.id)).toEqual(Array.from({ length: 22 }, (_, i) => i + 1));
    expect(achievementById(7)?.name).toBe("Camp Crusher");
    expect(achievementById(0)).toBeUndefined();
    expect(achievementById(23)).toBeUndefined();
  });

  test("16 are shown, worth 220 Shiny; all 22 are worth 300", () => {
    expect(AVAILABLE_ACHIEVEMENTS).toHaveLength(16);
    expect(AVAILABLE_ACHIEVEMENTS.reduce((sum, entry) => sum + entry.shiny, 0)).toBe(220);
    expect(ACHIEVEMENTS.reduce((sum, entry) => sum + entry.shiny, 0)).toBe(300);
  });

  test("the six tied to missing features stay hidden", () => {
    const hidden = ACHIEVEMENTS.filter((entry) => !entry.available).map((entry) => entry.id);
    expect(hidden).toEqual([9, 14, 18, 19, 20, 21]);
  });

  test("has Flash's rules", () => {
    const rules = Object.fromEntries(
      ACHIEVEMENTS.map((entry) => [entry.id, entry.rules.map((rule) => `${rule.stat}>=${rule.target}`).join(",")])
    );
    expect(rules).toEqual({
      1: "thlevel>=2",
      2: "thlevel>=5",
      3: "thlevel>=8",
      4: "upgrade_champ1>=1,upgrade_champ2>=1,upgrade_champ3>=1",
      5: "upgrade_champ1>=1,upgrade_champ2>=1,upgrade_champ3>=1",
      6: "map2>=1",
      7: "wmoutpost>=1",
      8: "playeroutpost>=5",
      9: "hugerage>=1",
      10: "wm2hall>=1",
      11: "monstersblended>=5000",
      12: "blocksbuilt>=200",
      13: "starterkit>=1",
      14: "alliance>=1",
      15: "stockpile>=1",
      16: "heavytraps>=8",
      17: "unlock_monster>=1",
      18: "descent>=1",
      19: "descent>=14",
      20: "underhall>=5",
      21: "infernoquests>=10",
      22: "thlevel>=10",
    });
    expect(ACHIEVEMENTS.filter((entry) => entry.mode === "any").map((entry) => entry.id)).toEqual([4]);
  });

  test("every entry is complete: a known stat, a name, a description, Shiny between 5 and 25, a Flash citation", () => {
    for (const entry of ACHIEVEMENTS) {
      for (const rule of entry.rules) {
        expect(ACHIEVEMENT_STATS).toContain(rule.stat);
        expect(rule.target).toBeGreaterThan(0);
      }
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.description).toMatch(/\.$/);
      expect(entry.shiny).toBeGreaterThanOrEqual(5);
      expect(entry.shiny).toBeLessThanOrEqual(25);
      expect(entry.flash).toMatch(/^ACHIEVEMENTS\.as:/);
    }
    expect(new Set(ACHIEVEMENTS.map((entry) => entry.name)).size).toBe(22);
  });
});
