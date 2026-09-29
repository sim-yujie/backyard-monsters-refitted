import type { Point } from "../YardGrid";

/**
 * When the pointer is on the middle of the yard, for the planner's readout
 * (#54, #56).
 *
 * The plot spans `[-w/2, w/2) x [-h/2, h/2)`, so its centre is yard (0, 0)
 * exactly and the mark is drawn on a cell corner. A point has no area to
 * hover, so the readout answers for the pathing grid's 10-unit cell around it
 * — the same cell F4 would sample — or for anything within
 * {@link CENTRE_HIT_PX} screen pixels of the mark, whichever is larger. At fit
 * zoom that cell is about 4 px across, too small to find (#56); the pixel
 * radius keeps the mark as easy to hover at every zoom as the crosshair drawn
 * on it, which also holds its size on screen.
 */

/** The middle cell's width, in yard units. */
export const CENTRE_CELL = 10;

/** How close to the mark, in screen pixels, the pointer counts as on it. */
export const CENTRE_HIT_PX = 12;

/** What the readout says there. */
export const CENTRE_NOTE = "Yard centre";

export const onYardCentre = (
  /** The pointer, in yard units. */
  yard: Point,
  /** The pointer, in canvas pixels. */
  pointer: Point,
  /** The mark, yard (0, 0), in canvas pixels. */
  centre: Point,
): boolean =>
  (Math.abs(yard.x) <= CENTRE_CELL / 2 && Math.abs(yard.y) <= CENTRE_CELL / 2) ||
  Math.hypot(pointer.x - centre.x, pointer.y - centre.y) <= CENTRE_HIT_PX;
