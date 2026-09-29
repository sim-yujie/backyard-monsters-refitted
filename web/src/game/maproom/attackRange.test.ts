import { describe, expect, it } from "vitest";
import type { PlayerCell } from "@/api/types";
import { HexGrid, mapRoomGrid } from "@/game/HexGrid";
import { cellDistance, rosterInRange, type OwnCell } from "@/game/attack/attackEntry";
import {
  NEIGHBOUR_EDGES,
  cellKey,
  rangeEdges,
  rangeSources,
  reachText,
  reachTo,
  reachableCells,
  type RangeSource,
} from "./attackRange";

const own = (col: number, row: number, b: 2 | 3, f: number): OwnCell => ({
  col,
  row,
  cell: {
    uid: 1,
    b,
    i: 150,
    bid: `${b}-${col}-${row}`,
    aid: null,
    n: "me",
    l: 10,
    v: 0,
    f,
    c: 0,
    dm: 0,
    d: 0,
    lo: 0,
    p: 0,
    mine: 1,
    pic_square: null,
    pi: 0,
    fr: 0,
    m: { housed: { C1: 1 } },
  } satisfies PlayerCell,
});

const source = (col: number, row: number, reach: number, kind: "main" | "outpost" = "main") =>
  ({ col, row, kind, flinger: 1, reach }) satisfies RangeSource;

describe("rangeSources", () => {
  it("takes every own cell with a flinger, yard first, Declare War only while it runs", () => {
    const cells = [own(230, 215, 3, 3), own(241, 207, 2, 4), own(250, 200, 3, 0)];
    expect(rangeSources(cells, false)).toEqual([
      { col: 241, row: 207, kind: "main", flinger: 4, reach: 10 },
      { col: 230, row: 215, kind: "outpost", flinger: 3, reach: 3 },
    ]);
    expect(rangeSources(cells, true).map((one) => one.reach)).toEqual([12, 5]);
  });

  it("stands the own-yard load in for the home cell until its zone arrives", () => {
    const home = { cell: { col: 241, row: 207 }, flinger: 4 };
    expect(rangeSources([], false, home)).toEqual([
      { col: 241, row: 207, kind: "main", flinger: 4, reach: 10 },
    ]);
    // Once the zone is in, the cell's own figure is used and not doubled.
    expect(rangeSources([own(241, 207, 2, 2)], false, home)).toHaveLength(1);
    expect(rangeSources([], false, { ...home, flinger: 0 })).toEqual([]);
  });
});

describe("reachableCells", () => {
  it("is the hex disc: 3r(r + 1) + 1 cells", () => {
    for (const reach of [1, 4, 10, 12]) {
      expect(reachableCells([source(400, 400, reach)]).size).toBe(3 * reach * (reach + 1) + 1);
    }
  });

  it("holds exactly the cells the Attack gate reaches", () => {
    const cells = [own(241, 207, 2, 4), own(230, 215, 3, 3)];
    const covered = reachableCells(rangeSources(cells, false));
    for (let col = 220; col <= 262; col++) {
      for (let row = 186; row <= 228; row++) {
        const gate = rosterInRange({ col, row }, cells, {}).flingerLevel > 0;
        expect(covered.has(cellKey(col, row)), `(${col}, ${row})`).toBe(gate);
      }
    }
  });

  it("wraps across the world's seam", () => {
    const covered = reachableCells([source(0, 0, 2)]);
    expect(covered.has(cellKey(799, 799))).toBe(true);
    expect(covered.has(cellKey(798, 0))).toBe(true);
    expect(covered.size).toBe(19);
  });
});

describe("rangeEdges", () => {
  it("names the side each neighbour touches", () => {
    // The midpoint of a shared side is halfway between the two centres, since
    // the art's stretch is affine; this pins NEIGHBOUR_EDGES to the geometry.
    for (const [col, row] of [
      [10, 10],
      [11, 10],
    ] as const) {
      const corners = mapRoomGrid.writeCellCorners(col, row, []);
      const centre = mapRoomGrid.cellToPixel(col, row);
      HexGrid.neighbours(col, row).forEach((neighbour, side) => {
        const [a, b] = NEIGHBOUR_EDGES[side]!;
        const other = mapRoomGrid.cellToPixel(neighbour.col, neighbour.row);
        expect((corners[a * 2]! + corners[b * 2]!) / 2).toBeCloseTo((centre.x + other.x) / 2);
        expect((corners[a * 2 + 1]! + corners[b * 2 + 1]!) / 2).toBeCloseTo(
          (centre.y + other.y) / 2,
        );
      });
    }
  });

  it("runs round the outside of a disc only: 6 sides for one cell, 6(2r + 1) for a ring", () => {
    expect(rangeEdges(reachableCells([source(400, 400, 0)]))).toHaveLength(6);
    expect(rangeEdges(reachableCells([source(400, 400, 3)]))).toHaveLength(6 * 7);
  });

  it("draws no line along the seam when the range crosses it", () => {
    const edges = rangeEdges(reachableCells([source(0, 400, 3)]));
    expect(edges).toHaveLength(6 * 7);
  });
});

describe("reachTo and reachText", () => {
  const sources = [source(241, 207, 10), source(230, 215, 3, "outpost")];

  it("measures from the nearest flinger that reaches", () => {
    const next = reachTo({ col: 241, row: 208 }, sources);
    expect(next).toMatchObject({ inRange: true, steps: 1 });
    expect(reachText(next)).toBe("In range · next to your yard");
    expect(reachText(reachTo({ col: 241, row: 211 }, sources))).toBe(
      "In range · 4 cells from your yard",
    );
    expect(reachText(reachTo({ col: 229, row: 215 }, sources))).toBe(
      "In range · next to your outpost",
    );
  });

  it("says how far short the closest miss falls", () => {
    const far = { col: 241, row: 219 };
    expect(cellDistance({ col: 241, row: 207 }, far)).toBe(12);
    expect(reachTo(far, sources)).toMatchObject({ inRange: false, steps: 2 });
    expect(reachText(reachTo(far, sources))).toBe("Out of range · 2 cells too far");
    expect(reachText(reachTo({ col: 241, row: 218 }, sources))).toBe(
      "Out of range · 1 cell too far",
    );
  });

  it("says nothing without a flinger, or for the flinging cell itself", () => {
    expect(reachText(reachTo({ col: 1, row: 1 }, []))).toBeNull();
    expect(reachText(reachTo({ col: 241, row: 207 }, sources))).toBeNull();
  });
});
