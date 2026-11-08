import { describe, expect, test } from "bun:test";
import { ACHIEVEMENT_STATS, ACHIEVEMENTS, achievementById, AVAILABLE_ACHIEVEMENTS } from "./achievements.js";

/** The catalogue (`docs/design/achievements.md` §5.1, owner decisions of 2026-10-05). */
describe("the achievements catalogue", () => {
  test("holds Flash's 22, numbered 1 to 22 in order, then the web's 23 to 27", () => {
    expect(ACHIEVEMENTS.map((entry) => entry.id)).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
    expect(achievementById(7)?.name).toBe("Camp Crusher");
    expect(achievementById(0)).toBeUndefined();
    expect(achievementById(28)).toBeUndefined();
  });

  test("22 are shown, worth 330 Shiny; all 27 are worth 400", () => {
    expect(AVAILABLE_ACHIEVEMENTS).toHaveLength(22);
    expect(AVAILABLE_ACHIEVEMENTS.reduce((sum, entry) => sum + entry.shiny, 0)).toBe(330);
    expect(ACHIEVEMENTS.reduce((sum, entry) => sum + entry.shiny, 0)).toBe(400);
  });

  test("beta 7's five are hidden, with the owner's targets and Shiny (#392)", () => {
    const hidden = ACHIEVEMENTS.filter((entry) => entry.hidden).map(
      (entry) => `${entry.id} ${entry.name} ${entry.rules[0]!.target} ${entry.shiny}`
    );
    expect(hidden).toEqual([
      "23 Neighbourly 30 15",
      "24 Regular 30 25",
      "25 Popular 80 15",
      "26 Kozu Hunter 100 20",
      "27 Landlord 100 25",
    ]);
    expect(ACHIEVEMENTS.filter((entry) => entry.hidden).every((entry) => entry.available)).toBe(true);
  });

  test("the one tied to a missing feature stays hidden; the Inferno's four wait on the Inferno switch", () => {
    const hidden = ACHIEVEMENTS.filter((entry) => !entry.available).map((entry) => entry.id);
    expect(hidden).toEqual([14]);
    const inferno = ACHIEVEMENTS.filter((entry) => entry.inferno).map((entry) => entry.id);
    expect(inferno).toEqual([18, 19, 20, 21]);
    expect(AVAILABLE_ACHIEVEMENTS.map((entry) => entry.id)).not.toContain(18);
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
      23: "neighbourly>=30",
      24: "loginstreak>=30",
      25: "friends>=80",
      26: "kozuattacks>=100",
      27: "outposts>=100",
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
      expect(entry.flash).toMatch(entry.id <= 22 ? /^ACHIEVEMENTS\.as:/ : /^web$/);
    }
    expect(new Set(ACHIEVEMENTS.map((entry) => entry.name)).size).toBe(27);
  });
});
