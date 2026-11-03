import { afterEach, describe, expect, it } from "vitest";
import { HexGrid, hexShape, mapRoomGrid, setHexShape, type HexShape } from "./HexGrid";
import { NEIGHBOUR_EDGES } from "./maproom/attackRange";
import { hexDistance, hexNeighbours } from "./maproom/rules/range";

/**
 * Pointy-top hexes (`MR2_HEX_SHAPE=pointy`, MR2 look plan step 1) next to
 * today's flat-top: the same promises for both shapes, and the shared rules
 * agreeing with the grid the map draws and picks with.
 */

const SHAPES: HexShape[] = ["flat", "pointy"];
const grids: Record<HexShape | "classic", HexGrid> = {
  flat: new HexGrid(150, 75, "flat"),
  pointy: new HexGrid(150, 150, "pointy"),
  classic: new HexGrid(150, 100, "pointy"),
};

/** Odd-r reference table: even rows, then odd rows, in axial order E, NE, NW, W, SW, SE. */
const POINTY_EVEN_ROW = [
  [1, 0],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];
const POINTY_ODD_ROW = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [0, 1],
  [1, 1],
];

const key = (cells: Array<{ x: number; y: number }>) => cells.map(({ x, y }) => `${x},${y}`).sort();

afterEach(() => {
  setHexShape("flat");
});

describe("pointy-top offset conversion", () => {
  it("round-trips through axial", () => {
    for (let col = -5; col <= 805; col += 37) {
      for (let row = -5; row <= 805; row += 41) {
        const axial = HexGrid.toAxial(col, row, "pointy");
        expect(HexGrid.toOffset(axial.q, axial.r, "pointy")).toEqual({ col, row });
      }
    }
  });

  it("matches the odd-r reference neighbour table", () => {
    for (const [col, row] of [
      [4, 4],
      [4, 5],
      [7, 2],
      [7, 3],
    ] as const) {
      const deltas = row % 2 === 0 ? POINTY_EVEN_ROW : POINTY_ODD_ROW;
      const expected = deltas.map(([dc, dr]) => ({ col: col + dc!, row: row + dr! }));
      expect(HexGrid.neighbours(col, row, "pointy")).toEqual(expected);
    }
  });
});

describe.each(["flat", "pointy", "classic"] as const)("%s grid", (name) => {
  const shape: HexShape = name === "flat" ? "flat" : "pointy";
  const grid = grids[name];

  it("neighbours are symmetric and one step away", () => {
    for (let col = 2; col < 12; col++) {
      for (let row = 2; row < 12; row++) {
        for (const n of HexGrid.neighbours(col, row, shape)) {
          expect(HexGrid.distance({ col, row }, n, shape)).toBe(1);
          expect(HexGrid.neighbours(n.col, n.row, shape)).toContainEqual({ col, row });
        }
      }
    }
  });

  it("agrees with the shared rules' neighbours and distance (the server's)", () => {
    for (let col = 0; col < 800; col += 53) {
      for (let row = 0; row < 800; row += 47) {
        const mine = HexGrid.neighbours(col, row, shape).map((c) => ({
          x: (c.col + 800) % 800,
          y: (c.row + 800) % 800,
        }));
        expect(key(mine)).toEqual(key(hexNeighbours(col, row, shape)));
        const other = { col: col + 5, row: row + 3 };
        expect(HexGrid.distance({ col, row }, other, shape)).toBe(
          hexDistance({ x: col, y: row }, { x: other.col, y: other.row }, shape),
        );
      }
    }
  });

  it("wraps at the world's edge in the shared rules", () => {
    const corner = hexNeighbours(0, 0, shape);
    for (const n of corner) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(hexDistance({ x: 0, y: 0 }, n, shape)).toBe(1);
    }
    expect(hexDistance({ x: 0, y: 0 }, { x: 799, y: 0 }, shape)).toBe(1);
    expect(hexDistance({ x: 0, y: 0 }, { x: 0, y: 799 }, shape)).toBe(1);
  });

  it("a range ring of r holds 3r(r+1)+1 cells", () => {
    for (const reach of [1, 3, 6]) {
      let count = 0;
      for (let dc = -reach; dc <= reach; dc++) {
        for (let dr = -reach; dr <= reach; dr++) {
          if (HexGrid.distance({ col: 40, row: 40 }, { col: 40 + dc, row: 40 + dr }, shape) <= reach) count++;
        }
      }
      expect(count).toBe(3 * reach * (reach + 1) + 1);
    }
  });

  it("picks every cell's own centre", () => {
    for (let col = -3; col < 20; col++) {
      for (let row = -3; row < 20; row++) {
        const centre = grid.cellToPixel(col, row);
        expect(grid.pixelToCell(centre.x, centre.y)).toEqual({ col, row });
      }
    }
  });

  it("picks the drawn hex for every point well inside its outline", () => {
    for (let col = 3; col < 9; col++) {
      for (let row = 3; row < 9; row++) {
        const centre = grid.cellToPixel(col, row);
        const corners = grid.writeCellCorners(col, row, []);
        // Points along the way from the centre to each corner and each side's
        // middle, stopping just short of the edge.
        for (let i = 0; i < 6; i++) {
          const cx = corners[i * 2]!;
          const cy = corners[i * 2 + 1]!;
          const nx = corners[((i + 1) % 6) * 2]!;
          const ny = corners[((i + 1) % 6) * 2 + 1]!;
          for (const [tx, ty] of [
            [cx, cy],
            [(cx + nx) / 2, (cy + ny) / 2],
          ] as const) {
            for (const t of [0.25, 0.5, 0.75, 0.97]) {
              const x = centre.x + (tx - centre.x) * t;
              const y = centre.y + (ty - centre.y) * t;
              expect(grid.pixelToCell(x, y), `${shape} ${col},${row} towards corner ${i} at ${t}`).toEqual({
                col,
                row,
              });
            }
          }
        }
      }
    }
  });

  it("shares each side with the neighbour on it (NEIGHBOUR_EDGES, used by the range line)", () => {
    const col = 6;
    const row = 6;
    const corners = grid.writeCellCorners(col, row, []);
    HexGrid.neighbours(col, row, shape).forEach((n, side) => {
      const edge = [...NEIGHBOUR_EDGES[side]!]
        .map((i) => `${corners[i * 2]!.toFixed(3)},${corners[i * 2 + 1]!.toFixed(3)}`)
        .sort();
      const theirs = grid.writeCellCorners(n.col, n.row, []);
      const theirPoints = new Set(
        [0, 1, 2, 3, 4, 5].map((i) => `${theirs[i * 2]!.toFixed(3)},${theirs[i * 2 + 1]!.toFixed(3)}`),
      );
      for (const point of edge) expect(theirPoints.has(point), `${shape} side ${side}`).toBe(true);
    });
  });

  it("halfWidthAt matches the drawn outline", () => {
    expect(grid.halfWidthAt(0)).toBe(75);
    expect(grid.halfWidthAt(grid.cellHeight / 2)).toBeCloseTo(shape === "pointy" ? 0 : 37.5);
    expect(grid.halfWidthAt(grid.cellHeight)).toBe(0);
  });
});

describe("pointy-top geometry (Classic, 150 x 100)", () => {
  const grid = grids.classic;

  it("steps a column by the full width and a row by three quarters of the height", () => {
    expect(grid.cellToPixel(1, 0)).toEqual({ x: 150, y: 0 });
    expect(grid.cellToPixel(0, 1)).toEqual({ x: 75, y: 75 });
    expect(grid.cellToPixel(0, 2)).toEqual({ x: 0, y: 150 });
  });

  it("has a point at the top and bottom and straight sides", () => {
    expect(grid.cellCorners(0, 0)).toEqual([
      { x: -75, y: 25 },
      { x: -75, y: -25 },
      { x: 0, y: -50 },
      { x: 75, y: -25 },
      { x: 75, y: 25 },
      { x: 0, y: 50 },
    ]);
  });

  it("covers 800 x 800 cells", () => {
    expect(grid.worldBounds(800, 800)).toEqual({ width: 150 * 800.5 + 75, height: 75 * 800 + 50 });
  });
});

describe("setHexShape", () => {
  it("reshapes the world grid and the static helpers together", () => {
    expect(hexShape()).toBe("flat");
    expect(mapRoomGrid.colStep).toBe(112.5);
    expect(setHexShape("pointy")).toBe(true);
    expect(setHexShape("pointy")).toBe(false);
    expect(hexShape()).toBe("pointy");
    expect(mapRoomGrid.cellHeight).toBe(150);
    expect(mapRoomGrid.colStep).toBe(150);
    expect(mapRoomGrid.rowStep).toBe(112.5);
    // Classic keeps Flash's 3/4 view: 100 tall, row step 75.
    expect(setHexShape("pointy", true)).toBe(true);
    expect(mapRoomGrid.cellHeight).toBe(100);
    expect(mapRoomGrid.rowStep).toBe(75);
    expect(HexGrid.neighbours(4, 4)).toEqual(HexGrid.neighbours(4, 4, "pointy"));
    setHexShape("flat");
    expect(mapRoomGrid.cellToPixel(1, 0)).toEqual({ x: 112.5, y: 37.5 });
    expect(HexGrid.neighbours(4, 4)).toEqual(HexGrid.neighbours(4, 4, "flat"));
  });
});
