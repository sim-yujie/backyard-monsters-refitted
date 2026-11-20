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

/**
 * The Inferno's outline (owner, 20 Nov 2026; astra's direction A): the same
 * thin neutral guide, cooler and stronger, on a charcoal keyline. The 1 px
 * white line alone vanished into the Inferno Block's glowing lava rim and the
 * lava ground. The keyline is 3 screen pixels whatever the zoom, so it is
 * drawn in yard units at `3 / zoom` and redrawn when the zoom changes.
 * The main yard keeps {@link NEARBY_STROKE}.
 */
export const INFERNO_NEARBY_LINE: StrokeStyle = { color: 0xe4e9e6, alpha: 0.8, pixelLine: true };
/** The keyline's colour and opacity; its width comes from {@link infernoKeylineStroke}. */
export const INFERNO_NEARBY_KEYLINE = { color: 0x171b20, alpha: 0.7, screenWidth: 3 } as const;

/** The keyline as a stroke at this zoom: 3 screen pixels wide, square ends so corners close. */
export const infernoKeylineStroke = (zoom: number): StrokeStyle => ({
  color: INFERNO_NEARBY_KEYLINE.color,
  alpha: INFERNO_NEARBY_KEYLINE.alpha,
  width: INFERNO_NEARBY_KEYLINE.screenWidth / (zoom > 0 && Number.isFinite(zoom) ? zoom : 1),
  cap: "square",
  join: "miter",
});

/** One straight edge of an outline. */
export interface NearbyEdge {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/**
 * The edges of every outline, each drawn once: two Blocks side by side share
 * an edge, and a see-through keyline drawn twice there would read darker than
 * the rest (astra, 20 Nov 2026). Edges are matched end for end, either way round.
 */
export const nearbyEdges = (outlines: readonly (readonly { x: number; y: number }[])[]): NearbyEdge[] => {
  const seen = new Set<string>();
  const edges: NearbyEdge[] = [];
  const key = (x: number, y: number) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
  for (const corners of outlines) {
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i]!;
      const b = corners[(i + 1) % corners.length]!;
      const ka = key(a.x, a.y);
      const kb = key(b.x, b.y);
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (ka === kb || seen.has(id)) continue;
      seen.add(id);
      edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  }
  return edges;
};
