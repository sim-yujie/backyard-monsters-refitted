import { DOMAdapter } from "pixi.js";
import { describe, expect, it } from "vitest";
import { cellCentre, paintedCellShape } from "./cellShape";
import { placementFragment } from "./groundShader";
import {
  FADE_START,
  GRID_SHARE,
  MAX_SIDE,
  NO_SQUARES,
  PLACEMENT_GRIDS,
  capped,
  holds,
  placementProgram,
  squaresFor,
  withSlack,
  worldBounds,
} from "./PlacementLayer";

// GlProgram reads the GPU's float precision from a test canvas; these tests run without a DOM.
DOMAdapter.set({ ...DOMAdapter.get(), createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement });

describe("sprite placement atlas (MR2 plan step 10)", () => {
  it("covers a cell range's world rectangle with a cell's margin each way", () => {
    const shape = paintedCellShape();
    const range = { minCol: 10, maxCol: 20, minRow: 5, maxRow: 15 };
    const [x0, y0, x1, y1] = worldBounds(shape, range);
    const first = cellCentre(shape, 10, 5);
    const last = cellCentre(shape, 20, 15);
    expect(x0).toBeLessThanOrEqual(first.x - shape.cellWidth);
    expect(y0).toBeLessThanOrEqual(first.y - shape.cellHeight);
    expect(x1).toBeGreaterThanOrEqual(last.x + shape.cellWidth);
    expect(y1).toBeGreaterThanOrEqual(last.y + shape.cellHeight);
  });

  it("asks for every square a pixel in the rectangle can look at (three squares of margin)", () => {
    const rect = squaresFor([100, 200, 300, 400], 10);
    expect(rect).toEqual({ x: 7, y: 17, w: 27, h: 27 });
    // Squares 10..29 hold the rectangle itself; the margin adds 3 before and 3 (plus the end) after.
    expect(rect.x + 3).toBe(10);
    expect(rect.x + rect.w).toBe(34);
  });

  it("knows when the worked-out squares still hold the view", () => {
    const have = { x: 0, y: 0, w: 100, h: 50 };
    expect(holds(have, { x: 10, y: 10, w: 20, h: 20 })).toBe(true);
    expect(holds(have, { x: 0, y: 0, w: 100, h: 50 })).toBe(true);
    expect(holds(have, { x: 90, y: 10, w: 20, h: 20 })).toBe(false);
    expect(holds(have, { x: -1, y: 10, w: 20, h: 20 })).toBe(false);
    // Nothing wanted is always held; nothing worked out holds nothing else.
    expect(holds(NO_SQUARES, NO_SQUARES)).toBe(true);
    expect(holds(NO_SQUARES, { x: 0, y: 0, w: 1, h: 1 })).toBe(false);
  });

  it("works out a quarter more each way, so a small pan needs no new pass", () => {
    const needed = { x: 100, y: 200, w: 40, h: 20 };
    const grown = withSlack(needed);
    expect(grown).toEqual({ x: 90, y: 195, w: 60, h: 30 });
    expect(holds(grown, needed)).toBe(true);
    expect(holds(grown, { ...needed, x: needed.x + 10 })).toBe(true);
    expect(withSlack(NO_SQUARES)).toEqual(NO_SQUARES);
  });

  it("keeps a too-big view's middle squares, and then holds them (no pass every frame)", () => {
    const needed = { x: 0, y: 0, w: MAX_SIDE + 1000, h: 10 };
    const grown = withSlack(needed);
    expect(grown.w).toBe(MAX_SIDE);
    expect(grown.x).toBe(500);
    expect(holds(grown, needed)).toBe(false);
    expect(capped(needed)).toEqual({ x: 500, y: 0, w: MAX_SIDE, h: 10 });
    expect(holds(grown, capped(needed))).toBe(true);
    expect(capped({ x: 5, y: 6, w: 7, h: 8 })).toEqual({ x: 5, y: 6, w: 7, h: 8 });
  });

  it("has one grid per sprite kind, smaller squares fading out sooner", () => {
    expect(PLACEMENT_GRIDS).toEqual(["decals", "rocks", "features", "marsh"]);
    for (const grid of PLACEMENT_GRIDS) {
      expect(GRID_SHARE[grid]).toBeGreaterThan(0);
      expect(GRID_SHARE[grid]).toBeLessThan(1);
    }
    // The ground details are the smallest pieces and go first when zooming out.
    expect(FADE_START.decals).toBeGreaterThan(FADE_START.rocks);
  });

  it("builds each grid's program once, from the ground shader's shared code", () => {
    for (const grid of PLACEMENT_GRIDS) {
      expect(placementProgram(grid)).toBe(placementProgram(grid));
      const fragment = placementFragment(grid);
      expect(fragment).toContain("uniform vec4 uPlaceRect;");
      expect(fragment).toContain("gl_FragCoord");
      // One main only: the ground's own is cut off.
      expect(fragment.match(/void main\(\)/g)).toHaveLength(1);
      expect(fragment).not.toContain("${");
    }
    expect(placementFragment("decals")).toContain("decalPlace(id)");
    expect(placementFragment("rocks")).toContain("rockPlace(id)");
    expect(placementFragment("features")).toContain("featurePlace(id, DENSITY)");
    expect(placementFragment("marsh")).toContain("marshPlace(id, DENSITY)");
  });
});
