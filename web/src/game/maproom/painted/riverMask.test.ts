import { describe, expect, it } from "vitest";
import { EDGE_RANGE, HALF_RANGE, MAX_SIDE, buildRiverMask } from "./riverMask";
import type { RiverPath, RiverPoint } from "./riverPaths";

/**
 * The rivers' distance picture (`riverMask.ts`) that the painted ground's shader paints them from:
 * depth, the signed distance to the water's edge, the mouth and the half width, per texel.
 */

const CELL = 100;

/** A straight river along y = 50 from x = 0 to 100, half width `half`, mouth share `mouth`. */
const straight = (half: number, mouth = 0, y = 50): RiverPath => {
  const points: RiverPoint[] = [];
  for (let i = 0; i <= 10; i++) points.push({ x: i * 10, y, half, mouth });
  return { points, mouth: mouth > 0, wetStart: 0, wetEnd: 0, falls: [] };
};

const rect = { x0: 0, y0: 0, x1: 100, y1: 100 };

/** The four bytes of the texel round world point (x, y), as 0..1 shares. */
const at = (mask: ReturnType<typeof buildRiverMask>, x: number, y: number) => {
  const tx = Math.floor(((x - mask.rect.x0) / (mask.rect.x1 - mask.rect.x0)) * mask.width);
  const ty = Math.floor(((y - mask.rect.y0) / (mask.rect.y1 - mask.rect.y0)) * mask.height);
  const o = (ty * mask.width + tx) * 4;
  return { depth: mask.bytes[o]! / 255, edge: mask.bytes[o + 1]! / 255, mouth: mask.bytes[o + 2]! / 255, half: mask.bytes[o + 3]! / 255 };
};

/** The signed distance to the water's edge (cell widths) from the edge channel. */
const edgeDistance = (share: number) => (share * 2 - 1) * EDGE_RANGE;

describe("river distance picture", () => {
  it("is deepest mid-stream, on the edge at the half width, and blank far off", () => {
    const mask = buildRiverMask([straight(5)], rect, CELL, 50);
    expect(mask.any).toBe(true);
    const middle = at(mask, 50, 50);
    expect(middle.depth).toBeGreaterThan(0.7);
    expect(edgeDistance(middle.edge)).toBeGreaterThan(0.035);
    // 5 points out (the half width) is the water's edge.
    expect(Math.abs(edgeDistance(at(mask, 50, 55).edge))).toBeLessThan(0.015);
    // Out on the bank the distance is negative and grows.
    expect(edgeDistance(at(mask, 50, 60).edge)).toBeLessThan(-0.03);
    // Far from the river: nothing (the edge channel's far end).
    expect(at(mask, 50, 90)).toEqual({ depth: 0, edge: 0, mouth: 0, half: 0 });
  });

  it("records the half width and the mouth", () => {
    const mask = buildRiverMask([straight(8, 0.6)], rect, CELL, 50);
    const middle = at(mask, 50, 50);
    expect(middle.half * HALF_RANGE).toBeCloseTo(0.08, 2);
    expect(middle.mouth).toBeCloseTo(0.6, 1);
  });

  it("joins two rivers, the nearer water winning each texel", () => {
    const mask = buildRiverMask([straight(4, 0, 40), straight(4, 0, 60)], rect, CELL, 50);
    expect(at(mask, 50, 40).depth).toBeGreaterThan(0.7);
    expect(at(mask, 50, 60).depth).toBeGreaterThan(0.7);
    // Half-way between, both are 10 points off: 6 points out of the water.
    expect(edgeDistance(at(mask, 50, 50).edge)).toBeCloseTo(-0.06, 1);
  });

  it("stays within the largest texture side", () => {
    const mask = buildRiverMask([straight(5)], { x0: 0, y0: 0, x1: 100_000, y1: 500 }, CELL, 40);
    expect(mask.width).toBeLessThanOrEqual(MAX_SIDE);
    expect(mask.height).toBeLessThanOrEqual(MAX_SIDE);
    expect(mask.bytes).toHaveLength(mask.width * mask.height * 4);
  });

  it("is empty without rivers", () => {
    const mask = buildRiverMask([], rect, CELL, 20);
    expect(mask.any).toBe(false);
    expect(mask.bytes.every((value) => value === 0)).toBe(true);
  });
});
