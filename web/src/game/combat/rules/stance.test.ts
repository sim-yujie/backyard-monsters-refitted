import { describe, expect, it } from "vitest";

import { createBattle } from "./engine.js";
import { replayAttack } from "./replay.js";
import {
  CHAMPION_STANCES,
  STANCE_TILTS,
  THREAT_CAP,
  WEIGHT_BOUNDS,
  ZERO_WEIGHTS,
  cannotBeat,
  exposure,
  focusFeature,
  isChampionStance,
  stanceBonus,
  stanceWeights,
  threatFeature,
  type ChampionStance,
} from "./stance.js";
import { findChampionTarget } from "./targeting.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingDataMap, FlingLog } from "./types.js";

/**
 * Issue #220: a champion's Mode when it attacks. Hybrid is the Flash champion;
 * Offensive and Defensive score Flash's own candidate lists (`stance.ts`).
 */

const RESOURCES = { r1: 1_000_000, r2: 0, r3: 0, r4: 0 };

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({ buildingdata: buildings, buildinghealthdata: {}, resources: RESOURCES });

/**
 * A level 5 Town Hall closest to the drop, under two level 5 Sniper Towers a
 * little further on, and a harvester the other way, out of their reach.
 */
const CROSSROADS: CombatBuildingDataMap = {
  "1": { id: 1, t: 14, l: 5, X: 250, Y: 250 },
  "2": { id: 2, t: 21, l: 5, X: 400, Y: 300 },
  "3": { id: 3, t: 21, l: 5, X: 300, Y: 400 },
  "4": { id: 4, t: 1, l: 5, X: -350, Y: -350, st: 5000 },
};

const logOf = (stance?: ChampionStance, monsters: Record<string, number> = {}): FlingLog => ({
  v: 1,
  seed: 22001,
  events: [
    {
      kind: "fling",
      t: 0,
      x: 0,
      y: 0,
      r: 100,
      monsters,
      champion: { t: 1, l: 1, ...(stance ? { s: stance } : {}) },
    },
  ],
});

/** The buildings a Gorgo walks to in turn, from the drop, over the first `ticks`. */
const targetsOf = (stance: ChampionStance | undefined, ticks = 6000): number[] => {
  const battle = createBattle(yardOf(CROSSROADS), { seed: 22001, levels: {} });
  const event = logOf(stance).events[0];
  if (event) battle.apply(event);
  const seen: number[] = [];
  for (let step = 0; step < ticks && !battle.over(); step += 1) {
    battle.step();
    const champion = battle.creeps().find((creep) => creep.champion);
    if (champion && champion.targetBuilding >= 0 && seen.at(-1) !== champion.targetBuilding) {
      seen.push(champion.targetBuilding);
    }
  }
  return seen;
};

const replayOf = (stance: ChampionStance | undefined, buildings = CROSSROADS) =>
  replayAttack({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: RESOURCES,
    kind: "main",
    log: logOf(stance, { C1: 10 }),
    levels: {},
    playerLevel: 20,
    tailTicks: 6000,
  });

describe("stance weights", () => {
  it("knows the three Modes and nothing else", () => {
    expect(CHAMPION_STANCES).toEqual(["offensive", "hybrid", "defensive"]);
    for (const stance of CHAMPION_STANCES) expect(isChampionStance(stance)).toBe(true);
    for (const other of ["Hybrid", "", 1, null, undefined, "legacy"]) {
      expect(isChampionStance(other)).toBe(false);
    }
  });

  it("makes Hybrid, and no Mode at all, the Flash champion: no weights", () => {
    expect(STANCE_TILTS.hybrid).toEqual(ZERO_WEIGHTS);
    expect(stanceWeights("hybrid")).toBeNull();
    expect(stanceWeights(undefined)).toBeNull();
  });

  it("adds the tilt to a base, so a brain's weights can sit under it, and clamps the sum", () => {
    expect(stanceWeights("offensive")).toEqual(STANCE_TILTS.offensive);
    const base = { ...ZERO_WEIGHTS, tower: 1000, threat: -50, focus: 30 };
    const tilted = stanceWeights("defensive", base);
    expect(tilted?.tower).toBe(WEIGHT_BOUNDS.tower[1]);
    expect(tilted?.threat).toBe(STANCE_TILTS.defensive.threat - 50);
    expect(tilted?.focus).toBe(STANCE_TILTS.defensive.focus + 30);
    // A base on its own makes Hybrid score too.
    expect(stanceWeights("hybrid", base)?.focus).toBe(30);
  });

  it("scores in distance units, threat as a penalty", () => {
    const weights = { ...ZERO_WEIGHTS, tower: 200, threat: 400, focus: 150 };
    const features = { tower: 1, loot: 0, finish: 0, focus: focusFeature(2), threat: 0.5, stay: 0 };
    expect(stanceBonus(weights, features)).toBe(200 + 60 - 200);
    expect(focusFeature(9)).toBe(1);
  });

  it("measures threat as the share of health a building costs, and gates on it", () => {
    // 2 damage a tick for the 1,000 ticks a 10,000-health building takes at 10 a tick: 2,000 of 4,000.
    expect(exposure(2, 10_000, 10, 4_000)).toBe(0.5);
    expect(exposure(0, 10_000, 10, 4_000)).toBe(0);
    expect(exposure(2, 10_000, 0, 4_000)).toBe(Number.POSITIVE_INFINITY);
    expect(threatFeature(Number.POSITIVE_INFINITY)).toBe(THREAT_CAP);
    expect(cannotBeat(0.5, 1.5)).toBe(false);
    expect(cannotBeat(0.7, 1.5)).toBe(true);
    expect(cannotBeat(5, 0)).toBe(false);
  });
});

describe("findChampionTarget with a Mode", () => {
  const context = { bunkerInUse: () => false };

  it("takes the lowest distance less bonus, ties in id order", () => {
    const yard = yardOf({
      "1": { id: 1, t: 1, l: 1, X: 100, Y: 100, st: 100 },
      "2": { id: 2, t: 20, l: 1, X: 200, Y: 200 },
    });
    expect(findChampionTarget(yard, 0, 0, context, false)?.id).toBe(1);
    const towerFirst = { bonus: (b: { kind: string }) => (b.kind === "tower" ? 500 : 0), skip: () => false };
    expect(findChampionTarget(yard, 0, 0, context, false, towerFirst)?.id).toBe(2);
  });

  it("falls through a stage the gate empties, and takes its pick without the gate when nothing is left", () => {
    const yard = yardOf({
      "1": { id: 1, t: 20, l: 1, X: 100, Y: 100 },
      "2": { id: 2, t: 13, l: 1, X: 300, Y: 300 },
    });
    const noTowers = { bonus: () => 0, skip: (b: { kind: string }) => b.kind === "tower" };
    // The tower is the only one of Flash's lists; the gate sends it to any main building.
    expect(findChampionTarget(yard, 0, 0, context, false, noTowers)?.id).toBe(2);
    const towerOnly = yardOf({ "1": { id: 1, t: 20, l: 1, X: 100, Y: 100 } });
    expect(findChampionTarget(towerOnly, 0, 0, context, false, noTowers)?.id).toBe(1);
  });
});

describe("a champion's Mode in battle (issue #220)", () => {
  it("picks a different first building in each Mode on the same yard", () => {
    // Hybrid, as Flash: the closest, the Town Hall. Offensive: the towers
    // first. Defensive: the harvester out of the towers' reach.
    expect(targetsOf("hybrid")[0]).toBe(1);
    expect(targetsOf("offensive")[0]).toBe(2);
    expect(targetsOf("defensive")[0]).toBe(4);
  });

  it("fights a log with no Mode exactly as Hybrid", () => {
    expect(targetsOf(undefined)).toEqual(targetsOf("hybrid"));
    const none = replayOf(undefined);
    const hybrid = replayOf("hybrid");
    expect(hybrid.digest).toBe(none.digest);
    expect(hybrid.checkpoints).toEqual(none.checkpoints);
  });

  it("replays each Mode identically, and each Mode differently", () => {
    const digests = CHAMPION_STANCES.map((stance) => {
      const first = replayOf(stance);
      const second = replayOf(stance);
      expect(second.digest).toBe(first.digest);
      expect(second.checkpoints).toEqual(first.checkpoints);
      expect(second.championHp).toBe(first.championHp);
      return first.digest;
    });
    expect(new Set(digests).size).toBe(3);
  });
});
