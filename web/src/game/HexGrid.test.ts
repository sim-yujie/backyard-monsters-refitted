import { describe, expect, it } from "vitest";
import { HexGrid } from "./HexGrid";

const grid = new HexGrid(150, 75);

/**
 * The reference odd-q neighbour tables from the offset-coordinate literature,
 * kept here as fixed expectations. HexGrid derives neighbours through axial
 * coordinates instead, so these assertions check the derivation rather than
 * restating it.
 */
const EVEN_COLUMN_DELTAS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [0, 1],
];

const ODD_COLUMN_DELTAS = [
  [1, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

describe("axial round trip", () => {
  it("returns the original cell for a spread of coordinates", () => {
    for (let col = -5; col <= 805; col += 37) {
      for (let row = -5; row <= 805; row += 41) {
        const axial = HexGrid.toAxial(col, row);
        expect(HexGrid.toOffset(axial.q, axial.r)).toEqual({ col, row });
      }
    }
  });

  it("matches the conversion the server and Flash client use", () => {
    // q = x, r = y - (x - (x & 1)) / 2
    expect(HexGrid.toAxial(4, 10)).toEqual({ q: 4, r: 8 });
    expect(HexGrid.toAxial(5, 10)).toEqual({ q: 5, r: 8 });
    expect(HexGrid.toAxial(0, 0)).toEqual({ q: 0, r: 0 });
  });

  it("stays exact for negative columns", () => {
    for (const col of [-1, -2, -3, -7, -12]) {
      const axial = HexGrid.toAxial(col, 3);
      expect(Number.isInteger(axial.r)).toBe(true);
      expect(HexGrid.toOffset(axial.q, axial.r)).toEqual({ col, row: 3 });
    }
  });
});

describe("pixel round trip", () => {
  it("maps a cell centre back to the same cell", () => {
    for (let col = 0; col < 24; col++) {
      for (let row = 0; row < 24; row++) {
        const centre = grid.cellToPixel(col, row);
        expect(grid.pixelToCell(centre.x, centre.y)).toEqual({ col, row });
      }
    }
  });

  it("maps points near a centre back to the same cell", () => {
    const offsets = [
      [0, 0],
      [20, 0],
      [-20, 0],
      [0, 18],
      [0, -18],
      [15, 12],
      [-15, -12],
    ];

    for (const col of [0, 1, 7, 12]) {
      for (const row of [0, 3, 9]) {
        const centre = grid.cellToPixel(col, row);
        for (const [dx, dy] of offsets) {
          expect(grid.pixelToCell(centre.x + dx!, centre.y + dy!)).toEqual({ col, row });
        }
      }
    }
  });

  it("never returns negative zero", () => {
    // Math.round gives -0 for anything in [-0.5, 0), so a point just left of
    // the origin used to come back as { col: -0 }.
    const cell = grid.pixelToCell(-1, -1);
    expect(Object.is(cell.col, -0)).toBe(false);
    expect(Object.is(cell.row, -0)).toBe(false);
  });

  it("staggers odd columns down by half a cell", () => {
    expect(grid.cellToPixel(0, 0)).toEqual({ x: 0, y: 0 });
    expect(grid.cellToPixel(1, 0)).toEqual({ x: 112.5, y: 37.5 });
    expect(grid.cellToPixel(2, 0)).toEqual({ x: 225, y: 0 });
    expect(grid.cellToPixel(0, 1)).toEqual({ x: 0, y: 75 });
  });
});

describe("neighbours", () => {
  it("returns the six odd-q neighbours of an even column", () => {
    const col = 4;
    const row = 10;
    const expected = EVEN_COLUMN_DELTAS.map(([dx, dy]) => ({
      col: col + dx!,
      row: row + dy!,
    }));
    expect(HexGrid.neighbours(col, row)).toEqual(expected);
  });

  it("returns the six odd-q neighbours of an odd column", () => {
    const col = 5;
    const row = 10;
    const expected = ODD_COLUMN_DELTAS.map(([dx, dy]) => ({
      col: col + dx!,
      row: row + dy!,
    }));
    expect(HexGrid.neighbours(col, row)).toEqual(expected);
  });

  it("gives every cell six distinct neighbours that are one step away", () => {
    for (const [col, row] of [
      [0, 0],
      [1, 0],
      [7, 13],
      [400, 400],
      [399, 401],
    ]) {
      const neighbours = HexGrid.neighbours(col!, row!);
      expect(neighbours).toHaveLength(6);
      expect(new Set(neighbours.map((n) => `${n.col},${n.row}`)).size).toBe(6);
      for (const neighbour of neighbours) {
        expect(HexGrid.distance({ col: col!, row: row! }, neighbour)).toBe(1);
      }
    }
  });

  it("is symmetric: each neighbour has the origin as a neighbour", () => {
    const origin = { col: 5, row: 10 };
    for (const neighbour of HexGrid.neighbours(origin.col, origin.row)) {
      const back = HexGrid.neighbours(neighbour.col, neighbour.row);
      expect(back).toContainEqual(origin);
    }
  });
});

describe("distance", () => {
  it("is zero for a cell against itself", () => {
    expect(HexGrid.distance({ col: 12, row: 34 }, { col: 12, row: 34 })).toBe(0);
  });

  it("counts steps across a column boundary", () => {
    expect(HexGrid.distance({ col: 0, row: 0 }, { col: 2, row: 0 })).toBe(2);
    expect(HexGrid.distance({ col: 0, row: 0 }, { col: 0, row: 3 })).toBe(3);
  });
});
