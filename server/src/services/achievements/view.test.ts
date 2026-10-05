import { describe, expect, test } from "bun:test";
import { achievementById } from "../../game-data/achievements.js";
import { emptyStats, readAchievements } from "./state.js";
import { achievementsState, progressOf, publicAchievements } from "./view.js";

/** The achievements routes' answers, pure (issue #204, WP4, `docs/design/achievements.md` §9). */

const entry = (id: number) => achievementById(id)!;

describe("progressOf", () => {
  test("one rule: the stat capped at its target; an earned entry reads full", () => {
    const stats = { ...emptyStats(), thlevel: 4, blocksbuilt: 260 };

    expect(progressOf(entry(2), stats, false)).toEqual({ value: 4, target: 5 });
    expect(progressOf(entry(12), stats, false)).toEqual({ value: 200, target: 200 });
    expect(progressOf(entry(3), stats, true)).toEqual({ value: 8, target: 8 });
  });

  test("entry 4, where one champion is enough, is 0 or 1 of 1, with each champion listed", () => {
    expect(progressOf(entry(4), emptyStats(), false)).toMatchObject({ value: 0, target: 1 });
    expect(progressOf(entry(4), { ...emptyStats(), upgrade_champ1: 1, upgrade_champ3: 1 }, false)).toMatchObject({
      value: 1,
      target: 1,
      parts: [
        { label: "Gorgo", value: 1, target: 1 },
        { label: "Drull", value: 0, target: 1 },
        { label: "Fomor", value: 1, target: 1 },
      ],
    });
  });
});

describe("achievementsState and publicAchievements", () => {
  const save = {
    achievements: {
      v: 1,
      s: { thlevel: 5 },
      c: {
        "1": { at: 100, shiny: 5, seen: 1 },
        "2": { at: 200, shiny: 10 },
        "6": { at: 300, shiny: 10, unpaid: 1 },
        // An entry not offered yet (§5.3) is never listed or counted.
        "9": { at: 300, shiny: 20, seen: 1 },
      },
      backfilledAt: 100,
    },
  };
  const record = readAchievements(save);

  test("the player's own: earned, Shiny earned, and the paid unlocks not yet shown", () => {
    const state = achievementsState(save, false);

    expect(state).toMatchObject({ earned: 2, total: 16, shinyEarned: 15 });
    expect(state.fresh).toEqual([{ id: 2, name: entry(2).name, shiny: 10 }]);
    expect(state.achievements.find((view) => view.id === 6)).toMatchObject({ status: "locked" });
    expect(state.achievements.some((view) => view.id === 9)).toBe(false);
  });

  test("an owed unlock reads earned once rewards are on: the next evaluation pays it", () => {
    expect(publicAchievements(record, false).earned).toBe(2);
    expect(publicAchievements(record, true).earned).toBe(3);
  });
});
