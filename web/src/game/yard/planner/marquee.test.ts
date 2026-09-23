import { describe, expect, it } from "vitest";
import { diamondCorners, diamondIntersectsRect, rectFromCorners } from "./marquee";

/** A 70 x 70 tower whose top corner is at the origin. */
const tower = { x: 0, y: 0, width: 70, height: 70 };

describe("diamondCorners", () => {
  it("puts the origin at the top and closes clockwise", () => {
    expect(diamondCorners(tower)).toEqual([
      [0, 0],
      [70, 35],
      [0, 70],
      [-70, 35],
    ]);
  });

  it("stretches a non-square footprint along the right axis", () => {
    // The Inferno Portal, 190 x 160.
    expect(diamondCorners({ x: 0, y: 0, width: 190, height: 160 })).toEqual([
      [0, 0],
      [190, 95],
      [30, 175],
      [-160, 80],
    ]);
  });
});

describe("rectFromCorners", () => {
  it("normalises a drag made in any direction", () => {
    const expected = { x: 10, y: 20, width: 90, height: 60 };
    expect(rectFromCorners(10, 20, 100, 80)).toEqual(expected);
    expect(rectFromCorners(100, 80, 10, 20)).toEqual(expected);
    expect(rectFromCorners(100, 20, 10, 80)).toEqual(expected);
  });

  it("gives a zero-size rectangle for a drag that did not move", () => {
    expect(rectFromCorners(5, 5, 5, 5)).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});

describe("diamondIntersectsRect", () => {
  it("selects a diamond the rectangle contains", () => {
    expect(diamondIntersectsRect(tower, { x: -100, y: -10, width: 300, height: 200 })).toBe(true);
  });

  it("selects a diamond that contains the rectangle", () => {
    expect(diamondIntersectsRect(tower, { x: -5, y: 30, width: 10, height: 10 })).toBe(true);
  });

  it("selects on a partial overlap", () => {
    expect(diamondIntersectsRect(tower, { x: 40, y: 20, width: 60, height: 60 })).toBe(true);
  });

  it("rejects a rectangle clear of the diamond", () => {
    expect(diamondIntersectsRect(tower, { x: 200, y: 200, width: 50, height: 50 })).toBe(false);
    expect(diamondIntersectsRect(tower, { x: -300, y: 0, width: 50, height: 50 })).toBe(false);
  });

  it("rejects a rectangle inside the bounding box but outside the diamond", () => {
    // The top-left corner of the footprint's box is empty ground: the diamond's
    // west corner is at (-70, 35), so (-65, 0) is above its north-west edge.
    expect(diamondIntersectsRect(tower, { x: -68, y: 0, width: 6, height: 6 })).toBe(false);
    // The same test on the bounding box would have said yes.
    expect(-68).toBeGreaterThan(-70);
  });

  it("selects the same corner region once the rectangle reaches the edge", () => {
    expect(diamondIntersectsRect(tower, { x: -68, y: 0, width: 6, height: 40 })).toBe(true);
  });

  it("counts a rectangle just touching a corner", () => {
    expect(diamondIntersectsRect(tower, { x: 70, y: 35, width: 10, height: 10 })).toBe(true);
  });

  it("picks one wall out of a run rather than its neighbours", () => {
    // Three 20 x 20 walls in a line, 20 units apart on the yard's X axis, which
    // is +20 right and +10 down on screen.
    const walls = [0, 1, 2].map((i) => ({ x: i * 20, y: i * 10, width: 20, height: 20 }));
    // A small box wholly inside the middle wall. Its neighbours share a corner
    // with it, so a box that reached one would legitimately select both.
    const box = { x: 18, y: 18, width: 6, height: 4 };
    expect(walls.map((wall) => diamondIntersectsRect(wall, box))).toEqual([false, true, false]);
  });

  it("takes the whole run when the rectangle is dragged along it", () => {
    const walls = [0, 1, 2].map((i) => ({ x: i * 20, y: i * 10, width: 20, height: 20 }));
    const box = { x: -30, y: -10, width: 120, height: 90 };
    expect(walls.every((wall) => diamondIntersectsRect(wall, box))).toBe(true);
  });
});
