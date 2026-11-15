import { MARK_HALF_WIDTH, MARK_HEADROOM } from "./YardHelpMarks";

/**
 * Where the camera stands when a friend's yard opens (beta 8, lead's check
 * 15 Nov 2026): no wrench the visitor can use may sit under the HUD or the
 * "Helping Bob / Help all" column at the top. When every mark is already in
 * the clear band the camera stays where it is; otherwise it centres the
 * marks in the band, pulling the zoom back (never past `minZoom`, never
 * closer than it was) until they fit.
 *
 * The yard scene lets the camera put the yard's top edge just under the
 * column (`Camera.setViewExtent`), so this can always bring the top row down.
 */

export interface WorldBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
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

/** How far a wrench reaches above its anchor on screen at a zoom (it grows past zoom 1). */
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
 * The camera that shows every mark in the band, or null when the camera as
 * it stands already does. The zoom is the camera's own, or less where the
 * marks need it, and never under `minZoom`.
 */
export const frameHelpMarks = (box: WorldBox, band: ClearBand, camera: CameraState): CameraState | null => {
  if (marksInBand(box, band, camera)) return null;
  const head = headroomAt(camera.zoom);
  const side = halfWidthAt(camera.zoom);
  const roomHigh = band.bottom - band.top - 2 * FRAME_MARGIN - head;
  const roomWide = band.width - 2 * FRAME_MARGIN - 2 * side;
  const high = box.bottom - box.top;
  const wide = box.right - box.left;
  let zoom = camera.zoom;
  if (high > 0 && roomHigh > 0) zoom = Math.min(zoom, roomHigh / high);
  if (wide > 0 && roomWide > 0) zoom = Math.min(zoom, roomWide / wide);
  zoom = Math.max(camera.minZoom, zoom);

  // The marks' screen height at that zoom, centred in the band.
  const content = high * zoom + headroomAt(zoom);
  const offset = band.top + Math.max(FRAME_MARGIN, (band.bottom - band.top - content) / 2);
  const y = box.top - (offset + headroomAt(zoom)) / zoom;
  const x = (box.left + box.right) / 2 - band.width / 2 / zoom;
  return { zoom, minZoom: camera.minZoom, x, y };
};
