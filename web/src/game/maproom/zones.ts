import { AREA_ZONE_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { zoneId, zoneOrigin } from "@/api/maproom";

/**
 * Zone geometry for Map Room 2.
 *
 * The world is divided into 10 x 10 zones aligned to multiples of 10, keyed by
 * `zoneX * 10000 + zoneY` exactly as the Flash client keyed them
 * (docs/specs/maproom2.md §2). The server then answers with 11 x 11 cells
 * covering `x..x+10` inclusive, so neighbouring zones overlap by one row and
 * one column. The overlap is harmless — the extra row is simply written twice —
 * but it means a cell is *covered* by up to four zones while it *belongs* to
 * exactly one, the one at `floor(x / 10) * 10`. Everything here uses the
 * belongs-to zone so a cell is requested once rather than four times.
 */

/** An inclusive rectangle of cells. */
export interface CellRange {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
}

/** One zone: its cache key and the origin sent to `getarea`. */
export interface ZoneRef {
  id: number;
  originX: number;
  originY: number;
}

/** Zones across and down the world: 80 x 80 for an 800 x 800 grid. */
export const ZONE_COLUMNS = Math.ceil(WORLD_WIDTH / AREA_ZONE_SIZE);
export const ZONE_ROWS = Math.ceil(WORLD_HEIGHT / AREA_ZONE_SIZE);

/** The zone a cell belongs to. */
export const zoneFor = (x: number, y: number): ZoneRef => {
  const originX = zoneOrigin(x);
  const originY = zoneOrigin(y);
  return { id: zoneId(originX, originY), originX, originY };
};

/** Recovers a zone from its id, the inverse of `zoneId`. */
export const zoneFromId = (id: number): ZoneRef => ({
  id,
  originX: Math.floor(id / 10000) * AREA_ZONE_SIZE,
  originY: (id % 10000) * AREA_ZONE_SIZE,
});

/**
 * Every zone touching a cell range, clamped to the world.
 *
 * Returned in row-major order; callers that care about fetch order sort by
 * `zonePriority` instead.
 */
export const zonesForRange = (range: CellRange): ZoneRef[] => {
  const minCol = clamp(range.minCol, 0, WORLD_WIDTH - 1);
  const maxCol = clamp(range.maxCol, 0, WORLD_WIDTH - 1);
  const minRow = clamp(range.minRow, 0, WORLD_HEIGHT - 1);
  const maxRow = clamp(range.maxRow, 0, WORLD_HEIGHT - 1);

  const zones: ZoneRef[] = [];
  if (maxCol < minCol || maxRow < minRow) return zones;

  for (let x = zoneOrigin(minCol); x <= maxCol; x += AREA_ZONE_SIZE) {
    for (let y = zoneOrigin(minRow); y <= maxRow; y += AREA_ZONE_SIZE) {
      zones.push({ id: zoneId(x, y), originX: x, originY: y });
    }
  }
  return zones;
};

/** The cell at the middle of a zone, used to measure distance to the viewport. */
export const zoneCentre = (zone: ZoneRef): { x: number; y: number } => ({
  x: zone.originX + AREA_ZONE_SIZE / 2,
  y: zone.originY + AREA_ZONE_SIZE / 2,
});

/**
 * Ordering key for the request queue: squared cell distance from a point.
 *
 * Squared because only the order matters and a square root per comparison is
 * wasted work. Not hex distance either — the queue only needs "nearer the
 * middle of the screen first", and the viewport is a rectangle, so plain
 * Euclidean distance in cell space is the honest measure.
 */
export const zonePriority = (zone: ZoneRef, centre: { x: number; y: number }): number => {
  const middle = zoneCentre(zone);
  const dx = middle.x - centre.x;
  const dy = middle.y - centre.y;
  return dx * dx + dy * dy;
};

/** The centre cell of a range. */
export const rangeCentre = (range: CellRange): { x: number; y: number } => ({
  x: (range.minCol + range.maxCol) / 2,
  y: (range.minRow + range.maxRow) / 2,
});

/** True when a cell is inside the world. */
export const inWorld = (x: number, y: number): boolean =>
  x >= 0 && x < WORLD_WIDTH && y >= 0 && y < WORLD_HEIGHT;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);
