import { describe, expect, it } from "vitest";
import { cellCentre, flatTopShape, pointyTopShape, type CellShape } from "./cellShape";
import {
  CLOUD_EDGE_HIGH,
  CLOUD_EDGE_LOW,
  cloudTime,
  DECK_MIN_CELLS,
  DECK_PIXELS,
  deckLevel,
  FOG_DISTANCE_CAP,
  fogDepth,
  fogDistances,
  fogInRange,
  fogShare,
  surelyClear,
  surelyCloud,
} from "./clouds";
import { Ground } from "./groundKinds";

const SHAPES: [string, CellShape][] = [
  ["flat", flatTopShape()],
  ["pointy", pointyTopShape()],
];

/** A small world's ground data: every cell fog except `seen` (meadow). */
const world = (width: number, height: number, seen: [number, number][]) => {
  const bytes = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index++) bytes[index * 4 + 3] = Ground.FOG;
  for (const [col, row] of seen) bytes[(row * width + col) * 4 + 3] = Ground.MEADOW;
  return { bytes, width, height };
};

const fogIn = (data: { bytes: Uint8Array; width: number; height: number }) => (col: number, row: number) =>
  col < 0 || row < 0 || col >= data.width || row >= data.height || (data.bytes[(row * data.width + col) * 4 + 3]! & 15) === Ground.FOG;

describe.each(SHAPES)("painted fog (%s hexes)", (_name, shape) => {
  it("gives the same share whichever of two side-by-side cells the sum starts from", () => {
    // A ragged edge of sight: a seen patch with a gap, in a sea of fog.
    const data = world(12, 12, [[5, 5], [6, 5], [5, 6], [7, 6], [6, 7], [4, 4]]);
    const isFog = fogIn(data);
    for (let col = 3; col <= 8; col++) {
      for (let row = 3; row <= 8; row++) {
        const here = cellCentre(shape, col, row);
        for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [-1, 1]] as const) {
          const there = cellCentre(shape, col + dc, row + dr);
          // Only true neighbours share a side; the midpoint lies on it.
          const gap = Math.hypot((there.x - here.x) / shape.unitX, (there.y - here.y) / shape.unitY);
          if (gap > 1.8) continue;
          const x = (here.x + there.x) / 2;
          const y = (here.y + there.y) / 2;
          const a = fogShare(shape, x, y, isFog, { col, row });
          const b = fogShare(shape, x, y, isFog, { col: col + dc, row: row + dr });
          expect(a).toBeCloseTo(b, 9);
        }
      }
    }
  });

  it("keeps a lone seen cell's middle clear and a fog cell's middle under cloud", () => {
    const data = world(9, 9, [[4, 4]]);
    const isFog = fogIn(data);
    const middle = cellCentre(shape, 4, 4);
    expect(surelyClear(fogShare(shape, middle.x, middle.y, isFog))).toBe(true);
    for (const [col, row] of [[4, 2], [2, 4], [6, 6], [4, 6]] as const) {
      const centre = cellCentre(shape, col, row);
      expect(surelyCloud(fogShare(shape, centre.x, centre.y, isFog))).toBe(true);
    }
  });

  it("is about a half on a straight edge of sight, between the edge's two bounds", () => {
    // Left half seen, right half fog.
    const seen: [number, number][] = [];
    for (let col = 0; col < 6; col++) for (let row = 0; row < 12; row++) seen.push([col, row]);
    const data = world(12, 12, seen);
    const isFog = fogIn(data);
    const a = cellCentre(shape, 5, 6);
    const b = cellCentre(shape, 6, 6);
    const share = fogShare(shape, (a.x + b.x) / 2, (a.y + b.y) / 2, isFog);
    expect(share).toBeGreaterThan(CLOUD_EDGE_LOW);
    expect(share).toBeLessThan(CLOUD_EDGE_HIGH + 0.1);
    expect(Math.abs(share - 0.5)).toBeLessThan(0.2);
  });

  it("measures each cell's distance into the fog, out to the cap", () => {
    const data = world(40, 40, [[20, 20]]);
    const out = new Uint8Array(40 * 40);
    fogDistances(shape, data, out);
    const at = (col: number, row: number) => out[row * 40 + col]!;
    expect(at(20, 20)).toBe(0);
    const centre = cellCentre(shape, 20, 20);
    let ones = 0;
    for (let row = 0; row < 40; row++) {
      for (let col = 0; col < 40; col++) {
        if (at(col, row) !== 1) continue;
        ones++;
        const c = cellCentre(shape, col, row);
        // Beside the seen cell: one cell-width apart (sqrt 3 hex units).
        expect(Math.hypot((c.x - centre.x) / shape.unitX, (c.y - centre.y) / shape.unitY)).toBeCloseTo(Math.sqrt(3), 5);
      }
    }
    expect(ones).toBe(6);
    // Corners of the world are far beyond the cap.
    expect(at(0, 0)).toBe(FOG_DISTANCE_CAP);
    expect(at(39, 39)).toBe(FOG_DISTANCE_CAP);
    // Nothing reads further than the cap.
    expect(Math.max(...out)).toBe(FOG_DISTANCE_CAP);
  });

  it("smooths the distance: about a half on the edge, rising into the fog", () => {
    const seen: [number, number][] = [];
    for (let col = 0; col < 10; col++) for (let row = 0; row < 30; row++) seen.push([col, row]);
    const data = world(30, 30, seen);
    const out = new Uint8Array(30 * 30);
    fogDistances(shape, data, out);
    const distanceAt = (col: number, row: number) =>
      col < 0 || row < 0 || col >= 30 || row >= 30 ? FOG_DISTANCE_CAP : out[row * 30 + col]!;
    const deep = cellCentre(shape, 16, 15);
    const near = cellCentre(shape, 12, 15);
    const inSight = cellCentre(shape, 5, 15);
    expect(fogDepth(shape, inSight.x, inSight.y, distanceAt)).toBeCloseTo(0, 6);
    expect(fogDepth(shape, deep.x, deep.y, distanceAt)).toBeGreaterThan(fogDepth(shape, near.x, near.y, distanceAt));
  });
});

describe("painted fog helpers", () => {
  it("finds fog in a range, and counts a view past the world's edge as fog", () => {
    const allSeen: [number, number][] = [];
    for (let col = 0; col < 20; col++) for (let row = 0; row < 20; row++) allSeen.push([col, row]);
    const clear = world(20, 20, allSeen);
    expect(fogInRange(clear, { minCol: 2, maxCol: 10, minRow: 2, maxRow: 10 })).toBe(false);
    expect(fogInRange(clear, { minCol: -1, maxCol: 10, minRow: 2, maxRow: 10 })).toBe(true);
    expect(fogInRange(clear, { minCol: 2, maxCol: 20, minRow: 2, maxRow: 10 })).toBe(true);
    const oneFog = world(20, 20, allSeen.filter(([c, r]) => !(c === 7 && r === 8)));
    expect(fogInRange(oneFog, { minCol: 2, maxCol: 10, minRow: 2, maxRow: 10 })).toBe(true);
    expect(fogInRange(oneFog, { minCol: 11, maxCol: 19, minRow: 2, maxRow: 10 })).toBe(false);
  });

  it("steps the clouds' clock by Quality and stills it on Low", () => {
    expect(cloudTime(1000 + 130, 1000, "high")).toBeCloseTo(0.125, 9);
    expect(cloudTime(1000 + 130, 1000, "medium")).toBe(0);
    expect(cloudTime(1000 + 260, 1000, "medium")).toBeCloseTo(0.25, 9);
    expect(cloudTime(1000 + 99999, 1000, "low")).toBe(0);
  });
});

describe("the cloud picture's repeat (Civ-sized heaps)", () => {
  const repeatCells = (cellPixels: number) => 2 ** Math.floor(deckLevel(cellPixels));

  it("never repeats in fewer than DECK_MIN_CELLS cells, so a big heap (a third of it) is over a cell close up", () => {
    for (const cellPixels of [40, 130, 200, 400, 1000]) {
      expect(repeatCells(cellPixels)).toBeGreaterThanOrEqual(DECK_MIN_CELLS);
      expect(repeatCells(cellPixels) / 3).toBeGreaterThan(1);
    }
  });

  it("keeps the far sea's repeat between half and all of DECK_PIXELS on screen", () => {
    for (const cellPixels of [0.5, 1, 2.7, 6, 13, 30, 60, 100]) {
      const pixels = repeatCells(cellPixels) * cellPixels;
      expect(pixels).toBeGreaterThan(DECK_PIXELS / 2 - 1e-6);
      expect(pixels).toBeLessThanOrEqual(DECK_PIXELS + 1e-6);
    }
  });

  it("changes smoothly with the zoom (no jump the cross-fade could not hide)", () => {
    let previous = deckLevel(0.5);
    for (let cellPixels = 0.5; cellPixels < 600; cellPixels *= 1.01) {
      const level = deckLevel(cellPixels);
      expect(Math.abs(level - previous)).toBeLessThan(0.02);
      expect(level).toBeLessThanOrEqual(previous + 1e-9);
      previous = level;
    }
  });
});
