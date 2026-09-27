import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { insideFootprint, PlacementGrid } from "./BuildPlacement";
import { readYard, type Yard } from "./yardModel";

/**
 * Where a new building may go (`docs/design/yard-buildings.md` §5.3): the
 * planner's occupancy grid with every building and mushroom stamped in,
 * against the smallest plot, 1000 x 800, `[-500, 500) x [-400, 400)`.
 * The server measures the same rectangles (`server/src/services/yard/build.ts`).
 */

const yardOf = (buildings: BuildingData[], extra: Partial<BaseLoadResponse> = {}): Yard =>
  readYard({
    error: 0,
    currenttime: 1,
    savetime: 1,
    buildingdata: Object.fromEntries(buildings.map((one) => [String(one.id), one])),
    storedata: {},
    ...extra,
  } as unknown as BaseLoadResponse);

const HALL: BuildingData = { id: 1, t: 14, X: -65, Y: -65, l: 3 };
const CANNON = 20; // 70 x 70
const BLOCK = 17; // 20 x 20

describe("PlacementGrid", () => {
  it("centres the footprint on the pointer, snapped to 5 units", () => {
    const grid = new PlacementGrid(yardOf([HALL]));
    expect(grid.spotAt(CANNON, 300, -300)).toEqual({ x: 265, y: -335 });
    expect(grid.spotAt(BLOCK, 12, 13)).toEqual({ x: 0, y: 5 });
  });

  it("open grass is fine", () => {
    const grid = new PlacementGrid(yardOf([HALL]));
    expect(grid.check(CANNON, 300, -300)).toEqual({ x: 300, y: -300, problem: null, blockedBy: null });
  });

  it("the footprint must end inside the plot", () => {
    const grid = new PlacementGrid(yardOf([HALL]));
    expect(grid.check(CANNON, 430, 0).problem).toBeNull();
    expect(grid.check(CANNON, 435, 0).problem).toBe("outOfBounds");
    expect(grid.check(CANNON, -505, 0).problem).toBe("outOfBounds");
  });

  it("a bigger plot (ENL) moves the edge", () => {
    const grid = new PlacementGrid(yardOf([HALL], { storedata: { ENL: { q: 1 } } }));
    expect(grid.check(CANNON, 435, 0).problem).toBeNull();
  });

  it("names the building in the way", () => {
    const grid = new PlacementGrid(yardOf([HALL]));
    expect(grid.check(CANNON, 0, 0)).toMatchObject({ problem: "overlap", blockedBy: 1 });
    expect(grid.nameOf(1)).toBe("Town Hall");
  });

  it("a building with id 0 still blocks", () => {
    const grid = new PlacementGrid(yardOf([{ ...HALL, id: 0 }]));
    expect(grid.check(CANNON, 0, 0)).toMatchObject({ problem: "overlap", blockedBy: 0 });
  });

  it("walls sit edge to edge", () => {
    const grid = new PlacementGrid(yardOf([HALL, { id: 2, t: BLOCK, X: 200, Y: 200 }]));
    expect(grid.check(BLOCK, 220, 200).problem).toBeNull();
    expect(grid.check(BLOCK, 215, 200).problem).toBe("overlap");
  });

  it("mushrooms are in the way too", () => {
    const grid = new PlacementGrid(
      yardOf([HALL], { mushrooms: { l: [{ X: 320, Y: -280, frame: 1 }] } }),
    );
    expect(grid.check(CANNON, 300, -300).problem).toBe("mushroom");
  });

  it("a held spot refuses a second drop on it until it is released", () => {
    const grid = new PlacementGrid(yardOf([HALL]));
    const handle = grid.hold(BLOCK, 200, 200);
    expect(grid.check(BLOCK, 200, 200)).toMatchObject({ problem: "overlap", blockedBy: null });
    expect(grid.check(BLOCK, 220, 200).problem).toBeNull();

    grid.release(handle);
    expect(grid.check(BLOCK, 200, 200).problem).toBeNull();
  });

  it("a held spot survives a rebase; releasing it leaves the real building stamped", () => {
    const grid = new PlacementGrid(yardOf([HALL]));
    const handle = grid.hold(BLOCK, 200, 200);
    grid.rebase(yardOf([HALL]));
    expect(grid.check(BLOCK, 200, 200).problem).toBe("overlap");

    // The server's answer has the wall in it now.
    grid.rebase(yardOf([HALL, { id: 2, t: BLOCK, X: 200, Y: 200 }]));
    grid.release(handle);
    expect(grid.check(BLOCK, 200, 200)).toMatchObject({ problem: "overlap", blockedBy: 2 });
  });
});

describe("insideFootprint", () => {
  it("is the footprint's own rectangle, far edges open", () => {
    expect(insideFootprint(CANNON, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(true);
    expect(insideFootprint(CANNON, { x: 0, y: 0 }, { x: 69, y: 69 })).toBe(true);
    expect(insideFootprint(CANNON, { x: 0, y: 0 }, { x: 70, y: 10 })).toBe(false);
  });
});
