import { describe, expect, it } from "vitest";

import { createBattle } from "./engine.js";
import { buildPathGrid, cellOf } from "./grid.js";
import { mulberry32 } from "./rng.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingData, CombatBuildingDataMap } from "./types.js";

/**
 * Bug #61 (player arC, 23 Nov 2026; patch 8.3, the owner's fix A). Patch 7.9
 * put walls on the grid at their stored X/Y but left every other building on
 * the screen round trip, which for X - Y an odd multiple of 5 lands one cell
 * up-left of where it is drawn. arC's cannon at (230, 265) beside a wall then
 * had target cells under that wall: its route ended outside the wall and a
 * melee monster "arrived" and hit the cannon through it. Every building now
 * sits on its stored X/Y, so the wall has to fall first.
 */

const WALL = 17;
const CANNON = 21;

/**
 * arC's cannon (70 x 70, X - Y = -35) in a closed ring of walls. Its bottom-left
 * corner is arC's: wall 225 at (210, 315) touching the cannon's left side, and
 * wall 242 at (220, 335) a step right and down, sharing an edge with it.
 */
const ringedCannon = (): CombatBuildingDataMap => {
  const buildings: Record<string, CombatBuildingData> = {
    "1": { id: 1, t: CANNON, l: 1, X: 230, Y: 265 },
  };
  let id = 10;
  const add = (X: number, Y: number) => {
    buildings[String(id)] = { id, t: WALL, l: 1, X, Y };
    id += 1;
  };
  for (let X = 210; X <= 310; X += 20) add(X, 235);
  for (let Y = 255; Y <= 315; Y += 20) {
    add(210, Y);
    add(310, Y);
  }
  for (let X = 220; X <= 300; X += 20) add(X, 335);
  add(310, 335);
  return buildings;
};

describe("a building beside a wall off Flash's lattice (bug #61, patch 8.3)", () => {
  it("has no target cell under a wall", () => {
    const yard = buildEngineYard({ buildingdata: ringedCannon() });
    const grid = buildPathGrid(yard);
    const cannon = yard.buildings.find((one) => one.id === 1)!;
    expect([cannon.cx, cannon.cy]).toEqual([230, 265]);
    for (let i = 0; i < 7; i += 1) {
      for (let j = 0; j < 7; j += 1) {
        expect(grid.wallAt(cellOf(cannon.cx + 10 * i, cannon.cy + 10 * j)), `cell ${i},${j}`).toBe(-1);
      }
    }
  });

  it("is reached from outside the ring only through a wall", () => {
    const yard = buildEngineYard({ buildingdata: ringedCannon() });
    const grid = buildPathGrid(yard);
    const cannon = yard.buildings.find((one) => one.id === 1)!;
    for (const [x, y] of [[-200, 300], [0, 600], [200, 600], [260, 600], [600, 300], [260, 0]] as const) {
      const route = grid.path({ fromX: x, fromY: y, target: cannon }, mulberry32(1));
      expect(route.blockedBy, `from ${x},${y}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("takes no hit from melee monsters while every wall stands", () => {
    const flings = [
      { monsters: { C1: 10 } },
      { monsters: { C8: 6 } },
      { monsters: {}, champion: { t: 1, l: 4 } },
    ] as const;
    for (const fling of flings) {
      for (const [x, y] of [[100, 300], [140, 400], [180, 420], [200, 420]] as const) {
        for (const seed of [1, 2, 3]) {
          const yard = buildEngineYard({ buildingdata: ringedCannon() });
          const cannon = yard.buildings.find((one) => one.id === 1)!;
          const walls = yard.buildings.filter((one) => one.type === WALL);
          const battle = createBattle(yard, { seed });
          battle.apply({ kind: "fling", t: 0, x, y, r: 0, ...fling });
          const full = cannon.hp;
          for (let tick = 0; tick < 1500 && !battle.over() && cannon.hp === full; tick += 1) battle.step();
          if (cannon.hp < full) {
            const label = `${JSON.stringify(fling)} from ${x},${y} seed ${seed}`;
            expect(walls.some((wall) => wall.hp <= 0), label).toBe(true);
          }
        }
      }
    }
  });
});
