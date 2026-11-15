import { MARK_HALF_WIDTH, MARK_HEADROOM } from "./YardHelpMarks";

/**
 * Where the camera stands when a friend's yard opens (beta 8, lead's check
 * 15 Nov 2026): no wrench the visitor can use may sit under the HUD or the
 * "Helping Bob / Help all" column at the top. When every mark is already in
 * the clear band the camera stays where it is; otherwise it pans to bring
 * them in, never changing the zoom (`frameHelpMarks`).
 *
 * The yard scene lets the camera put the yard's top edge just under the
 * column (`Camera.setViewExtent`), so this can always bring the top row down.
 */

export interface WorldBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  /** The highest building's foot: a wrench is slid down under the column as far as this. */
  readonly footTop?: number;
  /** Each wrench's x: on a narrow screen the camera shows as many as fit across. */
  readonly xs?: readonly number[];
}

/** The part of the screen not covered: below `top`, above `bottom`, `width` across. */
export interface ClearBand {
  readonly width: number;
  readonly top: number;
  readonly bottom: number;
}

export interface CameraState {
  readonly zoom: number;
  readonly minZoom: number;
  /** World point at the screen's top-left. */
  readonly x: number;
  readonly y: number;
}

/** Air kept between a mark and the covered parts, screen px. */
export const FRAME_MARGIN = 12;

/** How far a wrench reaches above its anchor on screen at a zoom (`helpMarkScale`: full size zoomed out, growing past zoom 1). */
const headroomAt = (zoom: number): number => MARK_HEADROOM * Math.max(1, zoom);
const halfWidthAt = (zoom: number): number => MARK_HALF_WIDTH * Math.max(1, zoom);

/** Whether every mark, wrench and ring, is inside the band with the camera as it stands. */
export const marksInBand = (box: WorldBox, band: ClearBand, camera: CameraState): boolean => {
  const z = camera.zoom;
  const top = (box.top - camera.y) * z - headroomAt(z);
  const bottom = (box.bottom - camera.y) * z;
  const left = (box.left - camera.x) * z - halfWidthAt(z);
  const right = (box.right - camera.x) * z + halfWidthAt(z);
  return (
    top >= band.top + FRAME_MARGIN &&
    bottom <= band.bottom - FRAME_MARGIN &&
    left >= FRAME_MARGIN &&
    right <= band.width - FRAME_MARGIN
  );
};

/**
 * The camera that shows the marks in the band, or null when the camera as it
 * stands already shows them all. It only pans: the zoom stays the one the
 * yard opened at (lead's check, 15 Nov 2026: zooming out to fit every mark
 * on a phone on its side left the wrenches tiny). The marks are centred
 * across. Up and down:
 *
 * - wrenches and all fit the band: centred in it;
 * - only the buildings' feet fit (a phone on its side): the lowest
 *   building's foot just over the band's bottom, and the top row's wrenches
 *   slide down to just under the column (`YardHelpMarks.setViewTop`);
 * - not even that: the top row just under the column, the rest a pan away
 *   (the bar's count and Help all reach them all).
 */
export const frameHelpMarks = (box: WorldBox, band: ClearBand, camera: CameraState): CameraState | null => {
  if (marksInBand(box, band, camera)) return null;
  const zoom = camera.zoom;
  const head = headroomAt(zoom);
  const high = (box.bottom - box.top) * zoom;
  const room = band.bottom - band.top - 2 * FRAME_MARGIN;
  let y: number;
  if (high + head <= room) {
    // Centred: the wrench's headroom over the box, then the box.
    const offset = band.top + FRAME_MARGIN + (room - high - head) / 2;
    y = box.top - (offset + head) / zoom;
  } else if ((box.bottom - (box.footTop ?? box.top)) * zoom <= room) {
    y = box.bottom - (band.bottom - FRAME_MARGIN) / zoom;
  } else {
    y = box.top - (band.top + FRAME_MARGIN + head) / zoom;
  }
  const x = acrossCentre(box, band, zoom) - band.width / 2 / zoom;
  return { zoom, minZoom: camera.minZoom, x, y };
};

/**
 * The world x the screen centres on: the box's middle when it fits across;
 * otherwise the middle of the most wrenches that fit across together (a
 * phone held upright: two of three whole beat three cut in half).
 */
const acrossCentre = (box: WorldBox, band: ClearBand, zoom: number): number => {
  const middle = (box.left + box.right) / 2;
  const room = (band.width - 2 * FRAME_MARGIN - 2 * halfWidthAt(zoom)) / zoom;
  const xs = [...(box.xs ?? [])].sort((a, b) => a - b);
  if (box.right - box.left <= room || xs.length === 0) return middle;
  let best = { count: 0, centre: middle, spread: Infinity };
  for (let first = 0; first < xs.length; first += 1) {
    let last = first;
    while (last + 1 < xs.length && xs[last + 1]! - xs[first]! <= room) last += 1;
    const count = last - first + 1;
    const spread = xs[last]! - xs[first]!;
    // The most wrenches; of those, the closest together.
    if (count > best.count || (count === best.count && spread < best.spread)) {
      best = { count, centre: (xs[first]! + xs[last]!) / 2, spread };
    }
  }
  return best.centre;
};
