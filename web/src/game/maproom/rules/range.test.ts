import { describe, expect, it } from "vitest";
import { HexGrid } from "@/game/HexGrid";
import {
  DECLARE_WAR_RANGE,
  hexDistance,
  inReach,
  mainYardRange,
  outpostRange,
  withDeclareWar,
  type RangeCell,
} from "./range";

/**
 * The Map Room 2 range rule (issue #190): a hex ring, as Flash drew it
 * (`MapRoomPopup.as:975-1016`), with Declare War's two cells only while the
 * powerup runs.
 */

const cell = (x: number, y: number): RangeCell => ({ x, y });

describe("hexDistance", () => {
  // Odd-q: the parity that shapes the neighbours is the column's, so each
  // centre is tried on an even and an odd column, each on an even and an odd row.
  const centres = [cell(100, 100), cell(100, 101), cell(101, 100), cell(101, 101)];

  it.each(centres)("puts all six neighbours of ($x, $y) one step away", (centre) => {
    const neighbours = HexGrid.neighbours(centre.x, centre.y);
    expect(neighbours).toHaveLength(6);
    for (const { col, row } of neighbours) {
      expect(hexDistance(centre, cell(col, row))).toBe(1);
      expect(hexDistance(cell(col, row), centre)).toBe(1);
    }
  });

  it("names the six neighbours of an even and an odd column exactly", () => {
    // Even column: the diagonal neighbours sit on the row above.
    const even = [
      [101, 100],
      [101, 99],
      [100, 99],
      [99, 99],
      [99, 100],
      [100, 101],
    ];
    // Odd column: they sit on the row below.
    const odd = [
      [102, 101],
      [102, 100],
      [101, 99],
      [100, 100],
      [100, 101],
      [101, 101],
    ];
    for (const [x, y] of even) expect(hexDistance(cell(100, 100), cell(x!, y!))).toBe(1);
    for (const [x, y] of odd) expect(hexDistance(cell(101, 100), cell(x!, y!))).toBe(1);
    // And the two cells a square rule would also call neighbours are not.
    expect(hexDistance(cell(100, 100), cell(101, 101))).toBe(2);
    expect(hexDistance(cell(101, 100), cell(100, 99))).toBe(2);
  });

  it("is zero to itself", () => {
    expect(hexDistance(cell(5, 7), cell(5, 7))).toBe(0);
  });

  it("counts steps around the ring, not the larger axis difference", () => {
    // Three columns across and three rows down: a square rule says 3.
    expect(hexDistance(cell(100, 100), cell(103, 103))).toBe(5);
    // Straight down a column is one step a row.
    expect(hexDistance(cell(100, 100), cell(100, 106))).toBe(6);
    // Across columns the rows drift for free: 4 across, 2 up is still 4.
    expect(hexDistance(cell(100, 100), cell(104, 98))).toBe(4);
  });

  it("agrees with the axial distance HexGrid draws with, away from the seam", () => {
    for (let x = 90; x <= 110; x++) {
      for (let y = 90; y <= 110; y++) {
        expect(hexDistance(cell(100, 100), cell(x, y))).toBe(
          HexGrid.distance({ col: 100, row: 100 }, { col: x, row: y }),
        );
      }
    }
  });

  it("wraps at both edges of the world", () => {
    expect(hexDistance(cell(0, 400), cell(799, 400))).toBe(1);
    expect(hexDistance(cell(400, 0), cell(400, 799))).toBe(1);
    expect(hexDistance(cell(1, 1), cell(798, 799))).toBe(4);
    // Every neighbour of a corner cell, drawn across the seam, is one step.
    for (const { col, row } of HexGrid.neighbours(0, 0)) {
      expect(hexDistance(cell(0, 0), cell((col + 800) % 800, (row + 800) % 800))).toBe(1);
    }
  });

  it("is symmetric", () => {
    const points = [cell(0, 0), cell(3, 797), cell(799, 5), cell(400, 401), cell(7, 2)];
    for (const a of points) {
      for (const b of points) expect(hexDistance(a, b)).toBe(hexDistance(b, a));
    }
  });
});

describe("reach", () => {
  it("follows Flash's ladders: 2 + 2 per level for a yard, 1 per level for an outpost", () => {
    expect([0, 1, 2, 3, 4, 9].map(mainYardRange)).toEqual([0, 4, 6, 8, 10, 10]);
    expect([0, 1, 2, 3, 4, 9].map(outpostRange)).toEqual([0, 1, 2, 3, 4, 4]);
    expect(mainYardRange(-1)).toBe(0);
    expect(outpostRange(-1)).toBe(0);
  });

  it("keeps the server's reading of a save with no flinger level: the longest reach", () => {
    expect(mainYardRange(undefined)).toBe(10);
    expect(outpostRange(undefined)).toBe(4);
  });

  it("adds Declare War's two cells only while it runs", () => {
    expect(withDeclareWar(10, false)).toBe(10);
    expect(withDeclareWar(10, true)).toBe(10 + DECLARE_WAR_RANGE);
    expect(withDeclareWar(0, true)).toBe(0);
  });

  it("reaches a cell r steps away and refuses one r + 1 away", () => {
    const home = cell(241, 207);
    for (let x = 225; x <= 257; x++) {
      for (let y = 191; y <= 223; y++) {
        const steps = hexDistance(home, cell(x, y));
        expect(inReach(home, cell(x, y), 10)).toBe(steps <= 10);
      }
    }
    expect(inReach(home, cell(241, 217), 10)).toBe(true);
    expect(inReach(home, cell(241, 218), 10)).toBe(false);
  });

  it("reaches nothing with no reach, not even next door", () => {
    expect(inReach(cell(10, 10), cell(10, 11), 0)).toBe(false);
  });
});
