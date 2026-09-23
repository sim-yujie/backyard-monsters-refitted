import type { Corners } from "./planner/marquee";
import type { Point, Rect } from "./YardGrid";

/**
 * The arithmetic behind the zoom slider and the minimap (design §3, F15).
 *
 * Both controls are small pictures of a big world, and both get their geometry
 * wrong in ways that are invisible until a yard is the wrong shape. So the
 * projection, the clipping and the slider's curve live here, as functions with
 * no canvas and no DOM in sight, and `YardMinimap` and `ZoomControl` are left
 * holding nothing but pixels and elements.
 *
 * Nothing here knows which view is showing. The renderer answers "how big is
 * the world" and "where is this building drawn" for whichever of the isometric
 * and blueprint drawings is active, and a fit is computed from that answer, so
 * the two views need no separate code path.
 */

/* ── Fitting a world into a box ───────────────────────────────────────────── */

export interface WorldSize {
  readonly width: number;
  readonly height: number;
}

/**
 * How a world maps onto the minimap's box: one scale for both axes, plus the
 * offset that centres the result.
 *
 * One scale rather than two because a yard squashed to fill a box is a lie
 * about its shape, and the whole point of the minimap is to show the shape.
 */
export interface MinimapFit {
  /** Minimap pixels per world pixel. */
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  /** The drawn extent, which is the box minus the letterboxing. */
  readonly width: number;
  readonly height: number;
}

/** Fits a world inside a box, preserving its aspect ratio and centring it. */
export const fitWorld = (world: WorldSize, boxWidth: number, boxHeight: number): MinimapFit => {
  const width = Math.max(world.width, 1);
  const height = Math.max(world.height, 1);
  const scale = Math.min(boxWidth / width, boxHeight / height);
  const drawnWidth = width * scale;
  const drawnHeight = height * scale;
  return {
    scale,
    offsetX: (boxWidth - drawnWidth) / 2,
    offsetY: (boxHeight - drawnHeight) / 2,
    width: drawnWidth,
    height: drawnHeight,
  };
};

/** A world point in minimap pixels. */
export const projectPoint = (fit: MinimapFit, x: number, y: number): Point => ({
  x: x * fit.scale + fit.offsetX,
  y: y * fit.scale + fit.offsetY,
});

/** A minimap pixel back in world pixels — what a click on the minimap means. */
export const unprojectPoint = (fit: MinimapFit, x: number, y: number): Point => ({
  x: (x - fit.offsetX) / fit.scale,
  y: (y - fit.offsetY) / fit.scale,
});

/** A world rectangle in minimap pixels. */
export const projectRect = (fit: MinimapFit, rect: Rect): Rect => ({
  x: rect.x * fit.scale + fit.offsetX,
  y: rect.y * fit.scale + fit.offsetY,
  width: rect.width * fit.scale,
  height: rect.height * fit.scale,
});

/**
 * The axis-aligned box around a footprint's corners.
 *
 * An isometric footprint is a diamond and a blueprint tile is a rectangle; at
 * two pixels across, the difference does not survive the projection, so both
 * are drawn as their box.
 */
export const cornersBounds = (corners: Corners): Rect | null => {
  const first = corners[0];
  if (!first) return null;

  let minX = first[0];
  let maxX = first[0];
  let minY = first[1];
  let maxY = first[1];
  for (const [x, y] of corners) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/**
 * `rect` clipped to `box`, or null when the two do not overlap.
 *
 * The camera can see past the edge of the world — `Camera.clampPosition`
 * centres an axis whose world is smaller than the viewport — so the viewport
 * rectangle is regularly larger than the minimap. Clipping it keeps the stroke
 * inside the frame instead of drawing three sides off-canvas.
 */
export const clipRect = (rect: Rect, box: Rect): Rect | null => {
  const left = Math.max(rect.x, box.x);
  const top = Math.max(rect.y, box.y);
  const right = Math.min(rect.x + rect.width, box.x + box.width);
  const bottom = Math.min(rect.y + rect.height, box.y + box.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/* ── The zoom slider's curve ──────────────────────────────────────────────── */

/**
 * Where a zoom sits on the slider, as 0 to 1.
 *
 * Logarithmic, because zoom is multiplicative: the keyboard and the wheel both
 * multiply, so a linear slider would crawl through the useful half of the range
 * and then leap across the rest. On a log scale every millimetre of travel is
 * the same proportional change, which is what "the slider follows the wheel"
 * has to mean for the thumb to track a wheel zoom at an even speed.
 */
export const zoomToFraction = (zoom: number, minZoom: number, maxZoom: number): number => {
  if (!(minZoom > 0) || !(maxZoom > minZoom)) return 0;
  return clamp(Math.log(zoom / minZoom) / Math.log(maxZoom / minZoom), 0, 1);
};

/** The inverse: the zoom a slider position asks for. */
export const fractionToZoom = (fraction: number, minZoom: number, maxZoom: number): number => {
  if (!(minZoom > 0) || !(maxZoom > minZoom)) return minZoom;
  return minZoom * Math.pow(maxZoom / minZoom, clamp(fraction, 0, 1));
};

/** The readout next to the slider. 1 is the art at native size, so 1 is 100%. */
export const zoomPercent = (zoom: number): number =>
  zoom >= 0.1 ? Math.round(zoom * 100) : Math.round(zoom * 1000) / 10;

/** Two zooms a player would call the same. Guards a pointless slider rewrite. */
export const sameZoom = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);
