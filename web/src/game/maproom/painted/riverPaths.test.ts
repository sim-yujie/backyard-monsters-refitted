import { afterAll, describe, expect, it } from "vitest";
import { HexGrid, mapRoomGrid, setHexShape, type HexShape } from "@/game/HexGrid";
import { ribbonOutline, riverPaths, type RiverCells } from "./riverPaths";

/**
 * The river shapes (`riverPaths.ts`, look plan step 7): along the cell edges
 * through the hex corners, never across a cell's middle, the same however the
 * map is scrolled, narrow at the source and flared at the mouth.
 */

afterAll(() => {
  setHexShape("flat");
});

const key = (col: number, row: number) => `${col},${row}`;

/** Cells with the given `rv`s, water where listed, land elsewhere. */
const world = (rv: Record<string, number>, water: string[] = []): RiverCells => ({
  rvAt: (col, row) => rv[key(col, row)] ?? 0,
  isWater: (col, row) => water.includes(key(col, row)),
});

/** Corner `k` of a cell in world pixels (between neighbours `k` and `k + 1`). */
const cornerAt = (col: number, row: number, k: number) => {
  const around = HexGrid.neighbours(col, row);
  let x = 0;
  let y = 0;
  for (const one of [{ col, row }, around[k % 6]!, around[(k + 1) % 6]!]) {
    const centre = mapRoomGrid.cellToPixel(one.col, one.row);
    x += centre.x / 3;
    y += centre.y / 3;
  }
  return { x, y };
};

const range = (minCol: number, maxCol: number, minRow: number, maxRow: number) => ({ minCol, maxCol, minRow, maxRow });

describe.each<HexShape>(["pointy", "flat"])("river shapes on %s-top hexes", (shape) => {
  setHexShape(shape);

  // Cell (6, 6)'s edges 0 and 1 (widths 1 and 2) and a separate edge of cell (6, 7).
  const rivers = () => {
    setHexShape(shape);
    return { [key(6, 6)]: 1 | (2 << 2), [key(6, 7)]: 2 << 2 };
  };

  it("passes through every hex corner of its edges", () => {
    const rv = rivers();
    const paths = riverPaths(range(0, 12, 0, 12), world(rv));
    const points = paths.flatMap((path) => path.points);
    for (const [col, row, k] of [
      [6, 6, 5],
      [6, 6, 0],
      [6, 6, 1],
    ] as const) {
      const corner = cornerAt(col, row, k);
      const nearest = Math.min(...points.map((p) => Math.hypot(p.x - corner.x, p.y - corner.y)));
      expect(nearest).toBeLessThan(0.01);
    }
  });

  it("stays in the band along the edges, well away from every cell's middle", () => {
    const rv = rivers();
    const points = riverPaths(range(0, 12, 0, 12), world(rv)).flatMap((path) => path.points);
    // A hex's inner radius is at least a third of the cell width on both shapes and sizes here.
    const inner = Math.min(mapRoomGrid.cellWidth, mapRoomGrid.cellHeight) / 2;
    for (const point of points) {
      for (let col = 3; col <= 10; col++) {
        for (let row = 3; row <= 10; row++) {
          const centre = mapRoomGrid.cellToPixel(col, row);
          expect(Math.hypot(point.x - centre.x, point.y - centre.y)).toBeGreaterThan(inner * 0.55);
        }
      }
    }
  });

  it("is the same however far the map is scrolled", () => {
    const rv = rivers();
    const near = riverPaths(range(5, 8, 5, 8), world(rv));
    const far = riverPaths(range(-20, 30, -20, 30), world(rv));
    const sorted = (paths: typeof near) =>
      paths
        .flatMap((path) => path.points)
        .map((p) => `${p.x.toFixed(3)}:${p.y.toFixed(3)}:${p.half.toFixed(3)}`)
        .sort();
    expect(sorted(near)).toEqual(sorted(far));
  });

  it("is narrow at the source, wider downstream, and flares into the water", () => {
    const rv = rivers();
    // The water cell touches the river's last corner (cell 6,6's corner 1 = between neighbours 1 and 2).
    const mouthCell = HexGrid.neighbours(6, 6)[2]!;
    const paths = riverPaths(range(0, 12, 0, 12), world(rv, [key(mouthCell.col, mouthCell.row)]));
    const mouths = paths.filter((path) => path.mouth);
    expect(mouths.length).toBeGreaterThan(0);
    const points = paths.flatMap((path) => path.points);
    const widest = Math.max(...points.map((p) => p.half));
    const narrowest = Math.min(...points.map((p) => p.half));
    expect(widest).toBeGreaterThan(narrowest * 3);
  });

  it("breaks into three paths at a junction", () => {
    setHexShape(shape);
    // Three edges round one corner: cell (6,6)'s edges 0 and 1, and the edge between its neighbours 0 and 1.
    const n0 = HexGrid.neighbours(6, 6)[0]!;
    const rv = { [key(6, 6)]: 1 | (1 << 2), [key(n0.col, n0.row)]: 1 << 4 };
    expect(riverPaths(range(0, 12, 0, 12), world(rv))).toHaveLength(3);
  });

  it("draws nothing without rivers", () => {
    setHexShape(shape);
    expect(riverPaths(range(0, 12, 0, 12), world({}))).toEqual([]);
  });

  it("outlines a ribbon as one closed polygon, wider with banks", () => {
    const rv = rivers();
    const [path] = riverPaths(range(0, 12, 0, 12), world(rv));
    const water = ribbonOutline(path!.points);
    const banks = ribbonOutline(path!.points, 5);
    expect(water).toHaveLength(path!.points.length * 4);
    const spread = (outline: number[]) => Math.hypot(outline[0]! - outline[outline.length - 2]!, outline[1]! - outline[outline.length - 1]!);
    expect(spread(banks)).toBeGreaterThan(spread(water));
  });
});
