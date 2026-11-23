import { describe, expect, it } from "vitest";

import { buildPathGrid, cellOf } from "./grid.js";
import { mulberry32 } from "./rng.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingData, CombatBuildingDataMap } from "./types.js";

/**
 * Player arC's yard has a diagonal "staircase" of walls, each block 5 units
 * sideways and 20 down from the last (75% of an edge touching). Monsters
 * walked through it (diagnosed 18 Nov 2026, fixed in patch 7.9).
 *
 * A wall whose stored X - Y is an odd multiple of 5 (X ends in 5 and Y in 0,
 * or the reverse) used to be anchored by the screen round trip (`screenOf`
 * floors (X+Y)/2, `fromIso` truncates) one unit low on each positive axis.
 * When that axis was a multiple of 10, the 2x2 cell registration dropped a
 * whole cell, and a one-cell slit opened between it and the next block. A
 * wall is now anchored on its stored X/Y (`buildEngineYard`), which on
 * Flash's 10-unit lattice (X - Y a multiple of 10) is the same point.
 */

const WALL = 17;

/** A closed ring: straight top, left and bottom, the right side a staircase. */
const ring = (stepSideways: number): CombatBuildingDataMap => {
  const buildings: Record<string, CombatBuildingData> = {
    // A harvester well inside the ring.
    "1": { id: 1, t: 1, l: 1, X: 140, Y: 140, st: 1000 }, // 70 x 70
  };
  let id = 10;
  const add = (X: number, Y: number) => {
    buildings[String(id)] = { id, t: WALL, l: 1, X, Y };
    id += 1;
  };
  // Right side: from (300, 100) down, `stepSideways` left per block.
  let rightX = 300;
  for (let Y = 100; Y <= 300; Y += 20) {
    add(rightX, Y);
    rightX -= stepSideways;
  }
  const lastX = rightX + stepSideways;
  for (let X = 100; X < 300; X += 20) add(X, 100); // top
  for (let Y = 120; Y <= 300; Y += 20) add(100, Y); // left
  for (let X = 120; X < lastX; X += 20) add(X, 300); // bottom
  return buildings;
};

const routeFromOutside = (buildings: CombatBuildingDataMap) => {
  const yard = buildEngineYard({ buildingdata: buildings });
  const grid = buildPathGrid(yard);
  const target = yard.buildings.find((building) => building.id === 1)!;
  return grid.path({ fromX: 600, fromY: 200, target }, mulberry32(1));
};

describe("a staircase of walls blocks (patch 7.9)", () => {
  it("blocks when each block is 10 sideways (Flash's own drag lattice, X = Y mod 10)", () => {
    const route = routeFromOutside(ring(10));
    expect(route.reached).toBe(true);
    expect(route.blockedBy).toBeGreaterThanOrEqual(0); // cut at a wall
  });

  it("blocks when each block is 5 sideways (75% touching)", () => {
    const route = routeFromOutside(ring(5));
    expect(route.reached).toBe(true);
    // Before 7.9: blockedBy was -1, the route slipped through a one-cell slit.
    expect(route.blockedBy).toBeGreaterThanOrEqual(0);
  });

  it("no slit: wall (385,40) registers on its stored X/Y, covering row y=50", () => {
    const yard = buildEngineYard({
      buildingdata: {
        "1": { id: 1, t: WALL, X: 385, Y: 40 },
        "2": { id: 2, t: WALL, X: 380, Y: 60 },
      },
    });
    const upper = yard.buildings[0]!;
    // Anchored where it is drawn (the screen round trip gave (384, 39)).
    expect([upper.cx, upper.cy]).toEqual([385, 40]);
    // Still drawn from the screen point, as before.
    expect([upper.sx, upper.sy]).toEqual([345, 212]);
    const grid = buildPathGrid(yard);
    // Cell (380..390, 50..60) lies inside wall 1 on screen and now on the grid.
    expect(grid.wallAt(cellOf(385, 55))).toBe(1);
    expect(grid.wallAt(cellOf(385, 45))).toBe(1);
    expect(grid.wallAt(cellOf(385, 65))).toBe(2);
  });

  it("anchors a wall on Flash's lattice where the round trip did, and every other building on its X/Y too (patch 8.3)", () => {
    const yard = buildEngineYard({
      buildingdata: {
        "1": { id: 1, t: WALL, X: 380, Y: 60 },
        "2": { id: 2, t: WALL, X: -125, Y: 35 },
        "3": { id: 3, t: 1, l: 1, X: 385, Y: 40 },
      },
    });
    const [onLattice, negative, harvester] = yard.buildings;
    expect([onLattice!.cx, onLattice!.cy]).toEqual([380, 60]);
    expect([negative!.cx, negative!.cy]).toEqual([-125, 35]);
    // Patch 8.3: a non-wall is anchored on its stored X/Y as well, not on the
    // screen round trip's (384, 39).
    expect([harvester!.cx, harvester!.cy]).toEqual([385, 40]);
  });
});
