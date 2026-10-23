import { describe, expect, it } from "vitest";

import { createBattle, type CreepSnapshot } from "./engine.js";
import { buildEngineYard, screenDistanceSquared, type EngineYard } from "./yard.js";
import type { CombatBuildingDataMap } from "./types.js";

/**
 * Walls block a shot on foot (engine note 20, owner decision 2026-10-23):
 * `PATHING.LineOfSight` (`PATHING.as:573-597`) as `CreepBase.canShootBuilding`
 * (`:735-748`), `ChampionBase.canHitBuilding` (`:424-438`) and
 * `Fomor.canShootCreep` (`Fomor.as:34-46`) ask it.
 *
 * A line of eleven walls covers X -100..120 across Y 0..20. The attacker lands
 * at (0, -40), with its target just beyond the line and in its range.
 */

const WALL_LEFT = -100;
const WALL_RIGHT = 120;

const yardBehindWalls = (extra: CombatBuildingDataMap): EngineYard => {
  const buildings: Record<string, CombatBuildingDataMap[string]> = { ...extra };
  for (let index = 0; index <= 10; index += 1) {
    const id = 10 + index;
    buildings[String(id)] = { id, t: 17, l: 1, X: WALL_LEFT + index * 20, Y: 0 };
  }
  return buildEngineYard({
    buildingdata: buildings,
    buildinghealthdata: {},
    resources: { r1: 1_000_000, r2: 0, r3: 0, r4: 0 },
  });
};

/** A harvester whose anchor is 60 past the line. */
const HARVESTER = { "2": { id: 2, t: 1, l: 1, X: 0, Y: 60, st: 100_000 } };

/**
 * Whether the straight line between two yard points plainly crosses the wall
 * line while every wall stands. The box is drawn a little inside the walls, so
 * a line the grid's cells could call either way never counts.
 */
const throughWalls = (yard: EngineYard, fromX: number, fromY: number, toX: number, toY: number) => {
  if (yard.buildings.some((building) => building.type === 17 && building.hp <= 0)) return false;
  for (let step = 0; step <= 200; step += 1) {
    const x = fromX + ((toX - fromX) * step) / 200;
    const y = fromY + ((toY - fromY) * step) / 200;
    if (x > WALL_LEFT + 10 && x < WALL_RIGHT - 10 && y > 2 && y < 18) return true;
  }
  return false;
};

const attackerOf = (creeps: readonly CreepSnapshot[]) => creeps.find((creep) => !creep.friendly);

/** Lands one attacker and reports where it stood at its first hit on the harvester. */
const firstHitOnHarvester = (land: { monsters: Record<string, number>; champion?: { t: number; l: number } }) => {
  const yard = yardBehindWalls(HARVESTER);
  const battle = createBattle(yard, { seed: 8 });
  battle.apply({ kind: "fling", t: 0, x: 0, y: -40, r: 0, ...land });
  const harvester = yard.buildings.find((building) => building.id === 2)!;
  for (let step = 0; step < 4000 && !battle.over(); step += 1) {
    battle.step();
    if (harvester.hp < harvester.maxHp) {
      const attacker = attackerOf(battle.creeps())!;
      return {
        yard,
        attacker,
        blocked: throughWalls(yard, attacker.ix, attacker.iy, harvester.cx, harvester.cy),
      };
    }
  }
  return undefined;
};

describe("walls block a shot on foot (engine note 20)", () => {
  it("holds a walking Rezghul's fire until it has a clear line to the building", () => {
    const hit = firstHitOnHarvester({ monsters: { C19: 1 } });
    expect(hit).toBeDefined();
    expect(hit!.attacker.flying).toBe(false);
    expect(hit!.blocked).toBe(false);
  });

  it("holds a walking level 1 Fomor's fire the same way (`ChampionBase.as:435`)", () => {
    const hit = firstHitOnHarvester({ monsters: {}, champion: { t: 3, l: 1 } });
    expect(hit).toBeDefined();
    expect(hit!.attacker.flying).toBe(false);
    expect(hit!.blocked).toBe(false);
  });

  it("lets a flying Fomor shoot the building over the walls (`ChampionBase.as:432-434`)", () => {
    const hit = firstHitOnHarvester({ monsters: {}, champion: { t: 3, l: 3 } });
    expect(hit).toBeDefined();
    expect(hit!.attacker.flying).toBe(true);
    expect(hit!.attacker.iy).toBeLessThan(0);
    expect(hit!.blocked).toBe(true);
  });

  it("never lets a flying Fomor shoot a defender through the walls (`Fomor.as:34-46`)", () => {
    // A Monster Bunker beyond the line sends a Rezghul, which reaches the air.
    const yard = yardBehindWalls({
      "1": { id: 1, t: 22, l: 1, X: 0, Y: 80 },
      "2": { id: 2, t: 1, l: 1, X: 0, Y: 600, st: 100_000 },
    });
    const battle = createBattle(yard, { seed: 8, bunkers: { 1: { C19: 1 } } });
    battle.apply({
      kind: "fling",
      t: 0,
      x: 0,
      y: -60,
      r: 0,
      monsters: {},
      champion: { t: 3, l: 3 },
    });
    const health = new Map<number, number>();
    let hits = 0;
    for (let step = 0; step < 1500 && !battle.over(); step += 1) {
      battle.step();
      const fomor = attackerOf(battle.creeps());
      for (const creep of battle.creeps()) {
        if (!creep.friendly) continue;
        const before = health.get(creep.id);
        health.set(creep.id, creep.hp);
        if (!fomor || before === undefined || creep.hp >= before) continue;
        // Towers never hurt a defender, so only Fomor did this.
        hits += 1;
        expect(fomor.flying).toBe(true);
        const close = screenDistanceSquared(fomor.ix, fomor.iy, creep.ix, creep.iy) < 2500;
        if (!close) expect(throughWalls(yard, fomor.ix, fomor.iy, creep.ix, creep.iy)).toBe(false);
      }
    }
    expect(hits).toBeGreaterThan(0);
  });
});
