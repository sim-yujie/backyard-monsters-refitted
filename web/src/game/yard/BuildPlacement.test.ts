import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { insideFootprint, PlacementGrid } from "./BuildPlacement";
import { readYard, type Yard } from "./yardModel";

/**
 * Where a new building may go (`docs/design/yard-buildings.md` §5.3): the
 * planner's occupancy grid with every building stamped in (mushrooms never block, #263),
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

  it("a mushroom is never in the way: the server moves it (#263)", () => {
    const grid = new PlacementGrid(
      yardOf([HALL], { mushrooms: { l: [{ X: 320, Y: -280, frame: 1 }] } }),
    );
    expect(grid.check(CANNON, 300, -300).problem).toBeNull();
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

// #231: the faint outlines round what stands near the building in hand.
describe("PlacementGrid.nearby", () => {
  const TRAP = 24; // Booby Trap, 20 x 20
  const DECORATION = 55; // 30 x 30

  // A cannon held with its origin at (300, -300) looks 140 units out on every
  // side (two small towers' widths): x in [160, 510), y in [-440, -90).
  const NEAR: BuildingData[] = [
    { id: 2, t: BLOCK, X: 450, Y: -200 },
    { id: 3, t: TRAP, X: 200, Y: -120 },
    { id: 4, t: DECORATION, X: 340, Y: -420 },
    { id: 5, t: CANNON, X: 100, Y: -150 }, // reaches x = 170, so half in
  ];
  const FAR: BuildingData[] = [
    { id: 6, t: CANNON, X: -400, Y: 300 },
    { id: 7, t: BLOCK, X: 300, Y: 0 },
  ];

  const idsAt = (grid: PlacementGrid, type: number, x: number, y: number): number[] => {
    const byPlace = new Map([...NEAR, ...FAR, HALL].map((one) => [`${one.X},${one.Y}`, one.id]));
    return grid
      .nearby(type, x, y)
      .map((one) => byPlace.get(`${one.x},${one.y}`) ?? -1)
      .sort((a, b) => a - b);
  };

  it("finds buildings, walls, traps and decorations close by, and nothing further out", () => {
    const grid = new PlacementGrid(yardOf([HALL, ...NEAR, ...FAR]));
    expect(idsAt(grid, CANNON, 300, -300)).toEqual([2, 3, 4, 5]);
  });

  it("hands back each footprint's type and origin, for drawing", () => {
    const grid = new PlacementGrid(yardOf([HALL, { id: 2, t: BLOCK, X: 450, Y: -200 }]));
    expect(grid.nearby(CANNON, 300, -300)).toEqual([{ type: BLOCK, x: 450, y: -200 }]);
  });

  it("looks further round a big building than round a wall", () => {
    // A Town Hall (130) looks 260 out; a wall gets the 140 floor.
    const grid = new PlacementGrid(yardOf([{ id: 2, t: CANNON, X: 360, Y: 0 }]));
    expect(grid.nearby(14, 0, 0)).toHaveLength(1);
    expect(grid.nearby(BLOCK, 100, 0)).toHaveLength(0);
    expect(grid.nearby(BLOCK, 240, 0)).toHaveLength(1);
  });

  it("leaves mushrooms out", () => {
    const grid = new PlacementGrid(
      yardOf([HALL], { mushrooms: { l: [{ X: 320, Y: -200, frame: 1 }] } }),
    );
    expect(grid.nearby(CANNON, 300, -300)).toEqual([]);
  });

  it("includes a drop still waiting for its answer, and keeps it once the yard has it", () => {
    const grid = new PlacementGrid(yardOf([HALL]));
    const before = grid.version;
    const handle = grid.hold(BLOCK, 200, 200);
    expect(grid.version).toBeGreaterThan(before);
    expect(grid.nearby(BLOCK, 220, 200)).toEqual([{ type: BLOCK, x: 200, y: 200 }]);

    grid.rebase(yardOf([HALL, { id: 2, t: BLOCK, X: 200, Y: 200 }]));
    grid.release(handle);
    expect(grid.nearby(BLOCK, 220, 200)).toEqual([{ type: BLOCK, x: 200, y: 200 }]);
  });
});

describe("insideFootprint", () => {
  it("is the footprint's own rectangle, far edges open", () => {
    expect(insideFootprint(CANNON, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(true);
    expect(insideFootprint(CANNON, { x: 0, y: 0 }, { x: 69, y: 69 })).toBe(true);
    expect(insideFootprint(CANNON, { x: 0, y: 0 }, { x: 70, y: 10 })).toBe(false);
  });
});
