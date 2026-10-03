import type { StrokeStyle } from "pixi.js";
import type { YardArea } from "./planner/placement";

/**
 * The faint outlines drawn round the footprints near whatever is in hand
 * (#231), so a new building or a moved one can be lined up against its
 * neighbours. Both carries draw them: a building from the Build menu
 * (`BuildPlacement`) and a selection moved in the Yard Planner
 * (`PlannerSession`, drawn by `PlannerOverlay`).
 *
 * Owner decisions (2026-10-03): only what is close to the item in hand, about
 * two building-widths round its footprint; anything standing on the ground —
 * buildings, walls, traps, decorations — but not the item itself; a thin,
 * faint white line with no fill, thin at every zoom.
 *
 * Neighbours are looked up in the occupancy grid
 * ({@link import("./planner/placement").Occupancy.occupantsIn}), never by a
 * pass over the yard's buildings, so a 575-building yard costs the same as an
 * empty one.
 */

/**
 * The least distance looked out to, in yard units: two small towers (a
 * 70-unit footprint) wide. What a wall or trap gets, since two of its own
 * 20-unit widths would show only the blocks touching it.
 */
export const NEARBY_MIN_MARGIN = 140;

/** How far round a footprint of this size its neighbours are looked for. */
export const nearbyMargin = (width: number, height: number): number =>
  Math.max(2 * Math.max(width, height), NEARBY_MIN_MARGIN);

/** The area whose occupants count as near a footprint at `(x, y)`. */
export const nearbyArea = (x: number, y: number, width: number, height: number): YardArea => {
  const margin = nearbyMargin(width, height);
  return {
    x: x - margin,
    y: y - margin,
    width: width + margin * 2,
    height: height + margin * 2,
  };
};

/**
 * The outline itself: white, faint, one screen pixel whatever the zoom
 * (`pixelLine`), and no fill, so it never reads as the held item's
 * green-or-red ghost.
 */
export const NEARBY_STROKE: StrokeStyle = { color: 0xffffff, alpha: 0.6, pixelLine: true };
