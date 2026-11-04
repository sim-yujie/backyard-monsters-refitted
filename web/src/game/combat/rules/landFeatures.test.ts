import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createBattle, type BattleOptions } from "./engine.js";
import { battleDefence, neighbourDefenceBonus, parseDefenderForces, type DefenderForces } from "./defence.js";
import {
  combineDefenceBonus,
  LAND_FEATURE_EFFECTS,
  LandFeature,
  landDefenceBonus,
  landFeatureOf,
  landIncome,
  rangePercentOf,
} from "./landFeatures.js";
import { replayAttack } from "./replay.js";
import { towerRange, towerStats } from "./stats.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingDataMap } from "./types.js";

/**
 * Map Room 2 land features (`landFeatures.ts`, design A of
 * `docs/mr2-civ-study.md`): the table, how a feature reaches the battle
 * through the stored defence, and that no feature is the battle as it was.
 */

const yardOf = (buildings: CombatBuildingDataMap) =>
  buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 100000, r2: 0, r3: 0, r4: 0 },
  });

const run = (battle: ReturnType<typeof createBattle>, ticks: number): void => {
  for (let step = 0; step < ticks && !battle.over(); step += 1) battle.step();
};

/** A level 1 Cannon Tower (damage 20) against one Pokey (200 health, 60 a swing). */
const CANNON: CombatBuildingDataMap = { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } };
/** The same tower being upgraded: silent, so the Pokey only swings. */
const SILENT: CombatBuildingDataMap = { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0, cU: 600 } };

const pokeyBattle = (buildings: CombatBuildingDataMap, extra: Partial<BattleOptions> = {}) => {
  const yard = yardOf(buildings);
  const battle = createBattle(yard, { seed: 1, shellBlastsWhereItLands: false, ...extra });
  battle.apply({ kind: "fling", t: 0, x: -100, y: -100, r: 200, monsters: { C1: 1 } });
  return { yard, battle };
};

const firstHurt = (extra: Partial<BattleOptions>): number | undefined => {
  const { battle } = pokeyBattle(CANNON, extra);
  for (let step = 0; step < 400; step += 1) {
    battle.step();
    const hurt = battle.recentEvents(0).find((event) => event.kind === "hurt")?.amount;
    if (hurt !== undefined) return hurt;
  }
  return undefined;
};

const lost = (yard: ReturnType<typeof yardOf>) => yard.buildings[0]!.maxHp - yard.buildings[0]!.hp;

const FIXTURES = fileURLToPath(new URL("../../../../test/fixtures/combat/", import.meta.url));
const SANDBOX = fileURLToPath(new URL("../../../../test/fixtures/baseload-sandbox-yard.json", import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const read = (path: string): Record<string, any> => JSON.parse(readFileSync(path, "utf8"));

/** The bench battle on the sandbox yard, as `neighbourBonus.test.ts` runs it. */
const mixedWaves = (extra: Partial<BattleOptions> = {}) => {
  const fixture = read(`${FIXTURES}mixed-waves.json`);
  const sandbox = read(SANDBOX);
  return replayAttack({
    buildingdata: sandbox.buildingdata,
    buildinghealthdata: sandbox.buildinghealthdata,
    resources: sandbox.resources,
    kind: fixture.kind,
    log: fixture.log,
    levels: fixture.levels,
    playerLevel: fixture.playerLevel,
    tailTicks: fixture.tailTicks,
    ...extra,
  });
};

const FORCES: DefenderForces = { bunkers: {}, defenderLevels: {}, defenderChampions: [] };

describe("the design A table", () => {
  it("holds the approved numbers", () => {
    expect(LAND_FEATURE_EFFECTS[LandFeature.OPEN]).toEqual({ hp: 0, damage: 0, range: 0, income: [0, 0, 0, 0] });
    expect(LAND_FEATURE_EFFECTS[LandFeature.FOREST]).toEqual({
      hp: 20,
      damage: 0,
      range: -10,
      income: [50, 0, 0, 0],
    });
    expect(LAND_FEATURE_EFFECTS[LandFeature.ROCKS]).toEqual({ hp: 10, damage: 10, range: 0, income: [0, 50, 0, 0] });
    expect(LAND_FEATURE_EFFECTS[LandFeature.MARSH]).toEqual({ hp: -10, damage: 0, range: 0, income: [0, 0, 25, 50] });
    expect(LAND_FEATURE_EFFECTS[LandFeature.TWIG_NODE].income).toEqual([100, 0, 0, 0]);
    expect(LAND_FEATURE_EFFECTS[LandFeature.GOO_NODE].income).toEqual([0, 0, 0, 100]);
  });

  it("reads anything it does not know as open ground", () => {
    for (const raw of [undefined, null, -1, 8, 1.5, "1", Number.NaN]) expect(landFeatureOf(raw)).toBe(0);
    expect(landFeatureOf(3)).toBe(LandFeature.MARSH);
  });

  it("gives no battle bonus for open ground or a resource node", () => {
    expect(landDefenceBonus(LandFeature.OPEN)).toBeUndefined();
    expect(landDefenceBonus(LandFeature.PEBBLE_NODE)).toBeUndefined();
    expect(landDefenceBonus(LandFeature.FOREST)).toEqual({ hp: 0.2, damage: 0, range: -0.1 });
    expect(landDefenceBonus(LandFeature.MARSH)).toEqual({ hp: -0.1, damage: 0 });
  });

  it("scales income after the height rule, never below 1", () => {
    expect(landIncome(10, LandFeature.FOREST, 1)).toBe(15);
    expect(landIncome(10, LandFeature.FOREST, 2)).toBe(10);
    expect(landIncome(7, LandFeature.MARSH, 3)).toBe(8);
    expect(landIncome(7, LandFeature.MARSH, 4)).toBe(10);
    expect(landIncome(1, LandFeature.GOO_NODE, 4)).toBe(2);
    expect(landIncome(9, LandFeature.OPEN, 1)).toBe(9);
  });
});

describe("stacking with the neighbour bonus", () => {
  it("multiplies health and damage, and keeps the feature's range", () => {
    const both = combineDefenceBonus(neighbourDefenceBonus(1), landDefenceBonus(LandFeature.FOREST))!;
    expect(1 + both.hp!).toBeCloseTo(1.05 * 1.2, 12);
    expect(1 + both.damage!).toBeCloseTo(1.05, 12);
    expect(rangePercentOf(both)).toBe(-10);
  });

  it("serves the stored feature and neighbours as one bonus", () => {
    const forces = parseDefenderForces({ ...FORCES, neighbours: 2, land: LandFeature.ROCKS });
    expect(forces?.land).toBe(LandFeature.ROCKS);
    const bonus = battleDefence(forces).defenceBonus!;
    expect(1 + bonus.hp!).toBeCloseTo(1.09 * 1.1, 12);
    expect(1 + bonus.damage!).toBeCloseTo(1.09 * 1.1, 12);
  });

  it("drops open ground and nonsense from a stored defence", () => {
    expect(parseDefenderForces({ ...FORCES, land: 0 })?.land).toBeUndefined();
    expect(parseDefenderForces({ ...FORCES, land: "2" })?.land).toBeUndefined();
    expect(parseDefenderForces({ ...FORCES, land: 99 })?.land).toBeUndefined();
    expect(battleDefence({ ...FORCES, land: LandFeature.TWIG_NODE })).toEqual({});
  });
});

describe("switched off: the battle as it always was", () => {
  it("replays the bench battle to the same digest with no land served", () => {
    const plain = mixedWaves();
    const served = mixedWaves(battleDefence(parseDefenderForces({ ...FORCES })));
    expect(served.digest).toBe(plain.digest);
    expect(served.damage).toBe(plain.damage);
  }, 60_000);

  it("leaves towerRange as it was with no land change", () => {
    for (const height of [0, 99, 100, 125, 160, 196]) {
      expect(towerRange(20, 3, "outpost", height, 0)).toBe(towerRange(20, 3, "outpost", height));
    }
  });
});

describe("switched on", () => {
  it("puts int(20 x 1.1) = 22 on the Cannon's first shot on rocks", () => {
    expect(firstHurt({})).toBe(20);
    expect(firstHurt(battleDefence({ ...FORCES, land: LandFeature.ROCKS }))).toBe(22);
  });

  it("makes a forest building take 1 / 1.2 of each swing, and a marsh one 1 / 0.9", () => {
    const plain = pokeyBattle(SILENT);
    const forest = pokeyBattle(SILENT, battleDefence({ ...FORCES, land: LandFeature.FOREST }));
    const marsh = pokeyBattle(SILENT, battleDefence({ ...FORCES, land: LandFeature.MARSH }));
    for (const side of [plain, forest, marsh]) run(side.battle, 600);
    const swings = lost(plain.yard) / 60;
    expect(swings).toBeGreaterThan(0);
    expect(lost(forest.yard)).toBeCloseTo((swings * 60) / 1.2, 6);
    expect(lost(marsh.yard)).toBeCloseTo((swings * 60) / 0.9, 6);
  });

  it("shortens a forest tower's reach after the height: int(int(h x r / 125) x 0.9)", () => {
    const table = Math.trunc(towerStats(20, 3, "outpost")!.range!);
    const raised = Math.trunc((160 * table) / 125);
    expect(towerRange(20, 3, "outpost", 160, -10)).toBe(Math.trunc((raised * 90) / 100));
    // A camp loads as a main yard: no height, but the feature still counts.
    const camp = Math.trunc(towerStats(20, 3, "main")!.range!);
    expect(towerRange(20, 3, "main", 160, -10)).toBe(Math.trunc((camp * 90) / 100));
  });

  it("does more to the sandbox yard on marsh and less on rocks", () => {
    const plain = mixedWaves();
    const marsh = mixedWaves(battleDefence({ ...FORCES, land: LandFeature.MARSH }));
    const rocks = mixedWaves(battleDefence({ ...FORCES, land: LandFeature.ROCKS }));
    // A forest trades reach for health: in this battle its shorter towers let
    // more through, so it only has to change the fight.
    const forest = mixedWaves(battleDefence({ ...FORCES, land: LandFeature.FOREST }));
    expect(forest.digest).not.toBe(plain.digest);
    expect(marsh.damage).toBeGreaterThanOrEqual(plain.damage);
    expect(rocks.damage).toBeLessThanOrEqual(plain.damage);
  }, 60_000);
});
