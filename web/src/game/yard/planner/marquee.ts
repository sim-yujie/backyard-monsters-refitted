import type { Rect } from "../YardGrid";

/**
 * Box select (design §3, F6): which footprints a dragged rectangle touches.
 *
 * The rectangle is axis-aligned in world pixels, because that is what a drag
 * across the screen is. A footprint is an isometric diamond. So this is a
 * convex-polygon intersection, and the cheapest correct answer is the
 * separating-axis test over four axes: the rectangle's two, and the diamond's
 * two edge normals.
 *
 * Testing the footprint's bounding box instead would sweep in the towers either
 * side of the one the player dragged over, which on a wall run is the
 * difference between selecting a line and selecting a blob.
 */

/** A footprint diamond in world pixels, given its top corner and footprint. */
export interface Diamond {
  /** The footprint's top corner: the building's origin on screen. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The diamond's four corners, clockwise from the top.
 *
 * `+width` in yard units goes down-right on screen and `+height` down-left,
 * each half as far vertically as horizontally (`YardGrid.footprintCorners`).
 */
export const diamondCorners = (shape: Diamond): readonly (readonly [number, number])[] => {
  const { x, y, width, height } = shape;
  return [
    [x, y],
    [x + width, y + width / 2],
    [x + width - height, y + (width + height) / 2],
    [x - height, y + height / 2],
  ];
};

/** A rectangle from two screen-drag corners, in any order. */
export const rectFromCorners = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
): Rect => ({
  x: Math.min(ax, bx),
  y: Math.min(ay, by),
  width: Math.abs(bx - ax),
  height: Math.abs(by - ay),
});

/** The four axes to separate on: the rectangle's two and the diamond's two. */
const AXES: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  // The diamond's edges run (+2, +1) and (-2, +1) in screen pixels, so their
  // normals are (1, -2) and (1, 2).
  [1, -2],
  [1, 2],
];

/** Whether a footprint diamond touches an axis-aligned rectangle. */
export const diamondIntersectsRect = (shape: Diamond, rect: Rect): boolean => {
  const diamond = diamondCorners(shape);
  const box: readonly (readonly [number, number])[] = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ];

  for (const [ax, ay] of AXES) {
    const a = project(diamond, ax, ay);
    const b = project(box, ax, ay);
    // A gap on any axis means the two shapes cannot touch.
    if (a.max < b.min || b.max < a.min) return false;
  }
  return true;
};

const project = (
  points: readonly (readonly [number, number])[],
  ax: number,
  ay: number,
): { min: number; max: number } => {
  let min = Infinity;
  let max = -Infinity;
  for (const [x, y] of points) {
    const value = x * ax + y * ay;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
};
