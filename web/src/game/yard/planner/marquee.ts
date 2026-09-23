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
 *
 * The blueprint view draws footprints as rectangles, so the test takes any
 * convex polygon and derives its axes from its edges.
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

/** A convex polygon's corners, in order around its edge. */
export type Corners = readonly (readonly [number, number])[];

/**
 * Whether a convex polygon touches an axis-aligned rectangle.
 *
 * Separating-axis test over the rectangle's two axes and one normal per
 * polygon edge. A diamond adds two axes, a blueprint tile adds none new, and
 * either way a gap on any axis means the shapes cannot touch.
 */
export const polygonIntersectsRect = (corners: Corners, rect: Rect): boolean => {
  const box: Corners = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ];

  const axes: [number, number][] = [
    [1, 0],
    [0, 1],
  ];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    // Axis-aligned edges are already covered by the rectangle's own axes.
    if (ex === 0 || ey === 0) continue;
    axes.push([-ey, ex]);
  }

  for (const [ax, ay] of axes) {
    const a = project(corners, ax, ay);
    const b = project(box, ax, ay);
    if (a.max < b.min || b.max < a.min) return false;
  }
  return true;
};

/** Whether a footprint diamond touches an axis-aligned rectangle. */
export const diamondIntersectsRect = (shape: Diamond, rect: Rect): boolean =>
  polygonIntersectsRect(diamondCorners(shape), rect);

const project = (
  points: Corners,
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
