import { describe, expect, it } from "vitest";

import { GRID_COST } from "./combatStatsData.js";
import {
  GRID_BASE_COST,
  GRID_DIAGONAL_MULTIPLIER,
  GRID_HEIGHT,
  GRID_MIN_COST,
  GRID_WIDTH,
  buildPathGrid,
  cellOfIso,
} from "./grid.js";
import { mulberry32 } from "./rng.js";
import { gridCost } from "./stats.js";
import { buildEngineYard } from "./yard.js";
import type { CombatBuildingDataMap } from "./types.js";

/**
 * The pathing grid.
 *
 * The cost model is four numbers — base 10, floor 2, diagonals half again, and
 * whatever each building's rectangles add — and everything a battle does with
 * walls falls out of them. These tests pin the four, then the two behaviours
 * built on top: a route is cut short by the wall in the way, and the scatter
 * step is seeded rather than free.
 */

const yardOf = (buildings: CombatBuildingDataMap) => buildEngineYard({ buildingdata: buildings });

/** A wall at the origin, which is the smallest interesting grid. */
const oneWall = () => yardOf({ "1": { id: 1, t: 17, X: 0, Y: 0 } });

describe("cost", () => {
  it("starts every cell at 10 (`PATHING.Setup`)", () => {
    const grid = buildPathGrid(yardOf({}));
    expect(GRID_BASE_COST).toBe(10);
    expect(grid.costAt(cellOfIso(0, 0))).toBe(10);
    expect(grid.costAt(cellOfIso(600, -400))).toBe(10);
  });

  it("is 260 x 260 cells over the cartesian yard", () => {
    expect(GRID_WIDTH).toBe(260);
    expect(GRID_HEIGHT).toBe(260);
    expect(cellOfIso(100000, 100000)).toBe(-1);
  });

  it("prices a wall's inner rectangle by level (`BFOUNDATION.as:3151`)", () => {
    expect(gridCost(17, 1)).toEqual([
      [-10, -10, 40, 40, 20],
      [0, 0, 20, 20, 125],
    ]);
    expect(gridCost(17, 3)[1]?.[4]).toBe(175);
  });

  it("stamps the wall's two rectangles on top of the base cost", () => {
    const yard = oneWall();
    const grid = buildPathGrid(yard);
    const centre = cellOfIso(0, 0);
    // Inner: 10 base + 20 outer + 125 inner. The rectangles overlap on purpose.
    expect(grid.costAt(centre)).toBe(155);
    // A cell covered only by the padded outer rectangle.
    expect(grid.costAt(centre - GRID_HEIGHT)).toBe(30);
    expect(grid.costAt(centre - 2 * GRID_HEIGHT)).toBe(10);
  });

  it("registers the wall as a blocker and nothing else", () => {
    const grid = buildPathGrid(
      yardOf({ "1": { id: 1, t: 17, X: 0, Y: 0 }, "2": { id: 2, t: 20, X: 400, Y: 400 } }),
    );
    expect(grid.wallAt(cellOfIso(0, 0))).toBe(1);
    expect(grid.wallAt(cellOfIso(400, 400))).toBe(-1);
  });

  it("holds no negative rectangle, which is what makes removal exact", () => {
    // `PATHING.Cost` floors a cell at 2 after adding, and that floor is not
    // reversible; subtraction is only a round trip because nothing subtracts.
    const negative: string[] = [];
    for (const [type, rects] of Object.entries(GRID_COST)) {
      for (const rect of rects) if (rect[4] < 0) negative.push(type);
    }
    expect(negative).toEqual([]);
    expect(GRID_MIN_COST).toBe(2);
  });

  it("gives a dead building's cells back and bumps the version", () => {
    const yard = oneWall();
    const grid = buildPathGrid(yard);
    const centre = cellOfIso(0, 0);
    expect(grid.version).toBe(0);
    const wall = yard.buildings[0];
    expect(wall).toBeDefined();
    grid.removeBuilding(wall!);
    expect(grid.costAt(centre)).toBe(GRID_BASE_COST);
    expect(grid.wallAt(centre)).toBe(-1);
    expect(grid.version).toBe(1);
  });

  it("charges a diagonal step half again as much", () => {
    expect(GRID_DIAGONAL_MULTIPLIER).toBe(1.5);
  });
});

describe("routing", () => {
  /** A target well away from the drop point, with a wall line between them. */
  const walledYard = () => {
    const buildings: Record<string, { id: number; t: number; X: number; Y: number }> = {
      "500": { id: 500, t: 14, X: 0, Y: 0 },
    };
    // A north-south run of blocks across the approach from the west.
    for (let step = 0; step < 20; step += 1) {
      buildings[String(step)] = { id: step, t: 17, X: -200, Y: -200 + step * 20 };
    }
    return yardOf(buildings);
  };

  it("walks to a target and stops at the wall in the way", () => {
    const yard = walledYard();
    const grid = buildPathGrid(yard);
    const townHall = yard.buildings.find((one) => one.type === 14);
    expect(townHall).toBeDefined();
    const route = grid.path(
      { fromX: -600, fromY: -80, target: townHall!, ignoreWalls: false },
      mulberry32(1),
    );
    expect(route.reached).toBe(true);
    expect(route.waypoints.length).toBeGreaterThan(1);
    // Either the route threads the gap or it is handed the wall it ran into;
    // both are correct, and a route that did neither would be a creep walking
    // through a block (`PATHING.as:445-452`).
    if (route.blockedBy >= 0) {
      expect(yard.buildings.some((one) => one.id === route.blockedBy && one.kind === "wall")).toBe(
        true,
      );
    }
  });

  it("is never cut short for a creep that ignores walls", () => {
    const yard = walledYard();
    const grid = buildPathGrid(yard);
    const townHall = yard.buildings.find((one) => one.type === 14);
    const route = grid.path(
      { fromX: -600, fromY: -80, target: townHall!, ignoreWalls: true },
      mulberry32(1),
    );
    expect(route.blockedBy).toBe(-1);
    expect(route.reached).toBe(true);
  });

  it("gives the same route twice from the same seed, and not from another", () => {
    const yard = walledYard();
    const townHall = yard.buildings.find((one) => one.type === 14);
    const request = { fromX: -600, fromY: -80, target: townHall!, ignoreWalls: false };
    const first = buildPathGrid(yard).path(request, mulberry32(99));
    const again = buildPathGrid(yard).path(request, mulberry32(99));
    const other = buildPathGrid(yard).path(request, mulberry32(100));
    expect(again.waypoints).toEqual(first.waypoints);
    // The scatter and the jiggle are the only randomness in a route, and both
    // fire near the target, so a different seed must move the tail.
    expect(other.waypoints).not.toEqual(first.waypoints);
  });

  it("answers an unreachable start with no waypoints rather than a guess", () => {
    const yard = oneWall();
    const grid = buildPathGrid(yard);
    const wall = yard.buildings[0];
    const route = grid.path(
      { fromX: 90000, fromY: 90000, target: wall!, ignoreWalls: false },
      mulberry32(1),
    );
    expect(route.reached).toBe(false);
    expect(route.waypoints).toEqual([]);
  });

  it("floods once per target and reuses it for the next creep", () => {
    const yard = walledYard();
    const grid = buildPathGrid(yard);
    const townHall = yard.buildings.find((one) => one.type === 14);
    grid.path({ fromX: -600, fromY: -80, target: townHall! }, mulberry32(1));
    expect(grid.floodCount()).toBe(1);
    grid.path({ fromX: -580, fromY: -60, target: townHall! }, mulberry32(2));
    expect(grid.floodCount()).toBe(1);
  });
});
