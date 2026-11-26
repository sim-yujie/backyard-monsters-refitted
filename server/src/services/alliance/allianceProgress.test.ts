import { describe, expect, test } from "bun:test";

import { GOAL_MENU, GOAL_POINTS, GOAL_TIER_RAISE, STEP_PRICES } from "../../config/AllianceConfig.js";
import { AllianceType } from "../../enums/Alliance.js";
import { goalAmounts, goalMenuFor, goalPoints, goalTarget, isGoalOnMenu } from "./allianceProgress.js";
import { composeShout } from "./shoutText.js";
import { AllianceMessageType } from "../../enums/Alliance.js";

/** The goal rules of 12 Nov 2026 (owner): what counts, targets, points. */
describe("alliance goal rules", () => {
  test("Hatch monsters is off the menu (owner, 12 Nov 2026): hatching counts towards no goal, an old goal's shout says nothing", () => {
    expect(GOAL_MENU.some((g) => g.kind === "hatch")).toBe(false);
    for (const type of [AllianceType.MIDAS, AllianceType.CONQUEST, AllianceType.FORTRESS]) {
      expect(goalMenuFor(type).some((g) => g.kind === "hatch")).toBe(false);
    }
    expect(isGoalOnMenu("hatch")).toBe(false);
    expect(isGoalOnMenu("tribeDestroy")).toBe(true);
    expect(goalAmounts({ hatch: 3, "hatch:C1": 3, "hatch:C12": 1 })).toEqual({});
    expect(goalAmounts({ hatch: 3, tribeDestroy: 1 })).toEqual({ tribeDestroy: 1 });
    // An old "goal set" / "goal reached" line for it has nothing to say, so the feed leaves it out.
    expect(composeShout(AllianceMessageType.GOAL_SET, "Gil", JSON.stringify({ kind: "hatch", tier: "easy" }))).toBe("");
    expect(composeShout(AllianceMessageType.GOAL_DONE, "Gil", JSON.stringify({ kind: "hatch", tier: "easy", points: 15 }))).toBe("");
    expect(composeShout(AllianceMessageType.GOAL_SET, "Gil", JSON.stringify({ kind: "loot", tier: "easy" }))).toBe(
      "Gil set a goal: Loot resources (Easy)."
    );
  });

  test("win attacks on players: only attackWin:player counts, never a plain attackWin (camps, bots)", () => {
    expect(goalAmounts({ attackWin: 1 })).toEqual({});
    expect(goalAmounts({ attackWin: 1, "attackWin:player": 1 })).toEqual({ attackWin: 1 });
  });

  test("a cancelled upgrade comes back as -1; other negative counts are ignored", () => {
    expect(goalAmounts({ upgradeResource: 1 })).toEqual({ upgrade: 1 });
    expect(goalAmounts({ upgradeDefence: -1 })).toEqual({ upgrade: -1 });
    expect(goalAmounts({ upgradeResource: 1, upgradeDefence: -1 })).toEqual({});
    expect(goalAmounts({ catapultHit: -2, lootR1: -5 })).toEqual({});
    expect(goalAmounts({ lootR1: 5, lootR4: 7, catapultHit: 2 })).toEqual({ loot: 12, catapultHit: 2 });
  });

  test("Midas targets: Easy as set 12 Nov, Medium x5 and Hard x10 since 24 Nov (owner); Conquest x2, Fortress x4; no member-count scaling", () => {
    const targets = Object.fromEntries(GOAL_MENU.map((g) => [g.kind, g.targets]));
    expect(targets).toEqual({
      tribeDestroy: [200, 2_750, 10_000],
      takeover: [60, 800, 3_000],
      hold: [90, 1_200, 4_500],
      attackWin: [300, 4_000, 15_000],
      defenceWin: [30, 400, 1_500],
      dailyQuests: [100, 1_400, 5_000],
      loot: [450_000_000, 6_000_000_000, 22_500_000_000],
      catapultHit: [900, 12_000, 45_000],
      upgrade: [90, 1_200, 4_500],
      harvest: [500_000_000, 6_500_000_000, 22_000_000_000],
      kitRebuild: [6, 80, 300],
      outpostDefended: [30, 400, 1_600],
    });
    expect(GOAL_TIER_RAISE).toEqual({ easy: 1, medium: 5, hard: 10 });
    const loot = GOAL_MENU.find((g) => g.kind === "loot")!;
    expect(goalTarget(AllianceType.CONQUEST, loot, "hard")).toBe(45_000_000_000);
    expect(goalTarget(AllianceType.FORTRESS, loot, "hard")).toBe(90_000_000_000);
    expect(GOAL_POINTS).toEqual({ easy: 15, medium: 37, hard: 70 });
    const takeover = GOAL_MENU.find((g) => g.kind === "takeover")!;
    expect(goalTarget(AllianceType.CONQUEST, takeover, "medium")).toBe(1_600);
    expect(goalTarget(AllianceType.FORTRESS, takeover, "medium")).toBe(3_200);
    expect(goalTarget(AllianceType.FORTRESS, takeover, "easy")).toBe(240);
    expect(goalPoints(AllianceType.CONQUEST, "hard")).toBe(140);
    expect(goalPoints(AllianceType.FORTRESS, "easy")).toBe(60);
    expect(goalMenuFor(AllianceType.MIDAS).some((g) => g.kind === "harvest")).toBe(true);
    expect(goalMenuFor(AllianceType.CONQUEST).some((g) => g.kind === "harvest")).toBe(false);
  });

  test("the whole Midas sky takes about 24 weeks of 5 Medium goals and 13 of 5 Hard (owner, 19 Nov 2026)", () => {
    const sky = 4 * STEP_PRICES.reduce((sum, p) => sum + p, 0);
    expect(sky).toBe(4320);
    expect(Math.ceil(sky / (5 * goalPoints(AllianceType.MIDAS, "medium")))).toBe(24);
    expect(Math.ceil(sky / (5 * goalPoints(AllianceType.MIDAS, "hard")))).toBe(13);
  });
});
