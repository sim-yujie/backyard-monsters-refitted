import { describe, expect, test } from "bun:test";

import { GOAL_MENU, GOAL_POINTS, STEP_PRICES } from "../../config/AllianceConfig.js";
import { AllianceType } from "../../enums/Alliance.js";
import { goalAmounts, goalMenuFor, goalPlayers, goalPoints, goalTarget } from "./allianceProgress.js";

/** The goal rules of 12 Nov 2026 (owner): what counts, targets, points, sized-for labels. */
describe("alliance goal rules", () => {
  test("hatching counts housing space from hatch:<monster>, not heads", () => {
    // 3 Pokeys take 10 each.
    expect(goalAmounts({ hatch: 3, "hatch:C1": 3 })).toEqual({ hatch: 30 });
    // Heads with no monster named count as a Pokey's space.
    expect(goalAmounts({ hatch: 2 })).toEqual({ hatch: 20 });
    // An unknown monster id counts as a Pokey's space too.
    expect(goalAmounts({ hatch: 1, "hatch:ZZ9": 1 })).toEqual({ hatch: 10 });
    // One D.A.V.E. takes 160.
    expect(goalAmounts({ hatch: 1, "hatch:C12": 1 })).toEqual({ hatch: 160 });
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

  test("Midas targets and points as the owner set them; Conquest x2, Fortress x4; no member-count scaling", () => {
    const targets = Object.fromEntries(GOAL_MENU.map((g) => [g.kind, g.targets]));
    expect(targets).toMatchObject({
      tribeDestroy: [200, 550, 1000],
      takeover: [60, 160, 300],
      hold: [90, 240, 450],
      attackWin: [300, 800, 1500],
      defenceWin: [30, 80, 150],
      hatch: [18_000, 48_000, 90_000],
      dailyQuests: [100, 280, 500],
      loot: [450_000_000, 1_200_000_000, 2_250_000_000],
      catapultHit: [900, 2400, 4500],
      upgrade: [90, 240, 450],
      harvest: [500_000_000, 1_300_000_000, 2_200_000_000],
      kitRebuild: [6, 16, 30],
      outpostDefended: [30, 80, 160],
    });
    expect(GOAL_POINTS).toEqual({ easy: 15, medium: 37, hard: 70 });
    const takeover = GOAL_MENU.find((g) => g.kind === "takeover")!;
    expect(goalTarget(AllianceType.CONQUEST, takeover, "medium")).toBe(320);
    expect(goalTarget(AllianceType.FORTRESS, takeover, "medium")).toBe(640);
    expect(goalPoints(AllianceType.CONQUEST, "hard")).toBe(140);
    expect(goalPoints(AllianceType.FORTRESS, "easy")).toBe(60);
    expect(goalMenuFor(AllianceType.MIDAS).some((g) => g.kind === "harvest")).toBe(true);
    expect(goalMenuFor(AllianceType.CONQUEST).some((g) => g.kind === "harvest")).toBe(false);
  });

  test("each tier says who it is sized for: Midas 3/8/15, Conquest 6/16/30, Fortress 12/32/60", () => {
    const players = (type: AllianceType) => (["easy", "medium", "hard"] as const).map((t) => goalPlayers(type, t));
    expect(players(AllianceType.MIDAS)).toEqual([3, 8, 15]);
    expect(players(AllianceType.CONQUEST)).toEqual([6, 16, 30]);
    expect(players(AllianceType.FORTRESS)).toEqual([12, 32, 60]);
  });

  test("8 players finishing 5 Medium goals a week fill the whole Midas sky in about 13 weeks", () => {
    const sky = 4 * STEP_PRICES.reduce((sum, p) => sum + p, 0);
    expect(sky).toBe(2400);
    expect(Math.ceil(sky / (5 * goalPoints(AllianceType.MIDAS, "medium")))).toBe(13);
  });
});
