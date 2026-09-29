/**
 * The Map Room 2 attack range rule, shared by the server and the web client
 * (issue #190).
 *
 * The server's range check (`server/src/services/maproom/v2/rangeCheck.ts`),
 * the map's Attack button (`web/src/game/attack/attackEntry.ts`) and the range
 * overlay all measure with this file, so the line drawn on the map and the
 * button under it can never disagree with what the server accepts. It is kept
 * as one source here and one byte-for-byte copy at
 * `server/src/game-rules/maproom/` by `web/tools/sync-combat-rules.mjs`, the
 * same way the combat rules are shared.
 *
 * Range is a hex ring, as the Flash client drew it
 * (`MapRoomPopup.as:975-1016`, `ApplyRangeHighlighting`): a cell is in reach
 * when the number of steps from the flinging cell to it, moving between
 * touching hexes, is no more than the flinger's reach. The world wraps at both
 * edges, as Flash's `GetCell` does (`MapRoomPopup.as:1061-1073`), so a step
 * off one edge lands on the other.
 *
 * Cells are `(x, y)` in the offset form the server and the wire use: odd-q,
 * flat-top columns, odd columns half a cell lower. Axial is
 * `q = x, r = y - (x - (x & 1)) / 2` (`MapRoomPopup.as:992-993`).
 *
 * Pure: no imports, no clock, nothing from either tree.
 */

/** Map Room 2's world, in cells (`server/src/enums/MapRoom.ts`, `web/src/config.ts`). */
export const MAP_WIDTH = 800;
export const MAP_HEIGHT = 800;

/**
 * Cells of extra reach while the alliance's Declare War powerup is running
 * (`POWERUPS.as:341-344`), and only then (`MapRoomPopup.as:919`, `:938`).
 */
export const DECLARE_WAR_RANGE = 2;

/** Reach of a main yard's flinger by level: `2 + 2 * level` (`BUILDING5.as:16-18`). */
const MAIN_YARD_RANGES = [0, 4, 6, 8, 10] as const;

/** The longest reach a main yard's flinger has, before Declare War. */
export const MAX_MAIN_YARD_RANGE = 10;

/** The longest reach an outpost's flinger has, before Declare War. */
export const MAX_OUTPOST_RANGE = 4;

/** A cell on the Map Room 2 grid, in offset coordinates. */
export interface RangeCell {
  x: number;
  y: number;
}

/**
 * Reach of a main yard's flinger, by level.
 *
 * A save with no flinger level on it at all reaches the furthest, which is
 * what the server has always assumed of one.
 *
 * @param level - The flinger's level.
 * @returns Reach in cells, before Declare War.
 */
export const mainYardRange = (level: number | undefined): number => {
  if (level === undefined) return MAX_MAIN_YARD_RANGE;
  if (!(level > 0)) return 0;
  return MAIN_YARD_RANGES[Math.min(Math.floor(level), 4)] ?? 0;
};

/**
 * Reach of an outpost's flinger, by level: one cell a level, up to four
 * (`BUILDING5.as:16-18`, called with `false` for an outpost).
 *
 * @param level - The flinger's level.
 * @returns Reach in cells, before Declare War.
 */
export const outpostRange = (level: number | undefined): number => {
  if (level === undefined) return MAX_OUTPOST_RANGE;
  if (!(level > 0)) return 0;
  return Math.min(Math.floor(level), MAX_OUTPOST_RANGE);
};

/**
 * A flinger's reach with Declare War added when it is running.
 *
 * A flinger that reaches nothing gains nothing from it.
 *
 * @param range - The flinger's own reach.
 * @param declareWar - Whether the Declare War powerup is running.
 * @returns The reach to measure against.
 */
export const withDeclareWar = (range: number, declareWar: boolean): number =>
  range > 0 && declareWar ? range + DECLARE_WAR_RANGE : range;

/** Hex steps between two cells on an unwrapped grid. */
const stepsBetween = (ax: number, ay: number, bx: number, by: number): number => {
  const dq = bx - ax;
  const dr = by - (bx - (bx & 1)) / 2 - (ay - (ax - (ax & 1)) / 2);
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
};

/** The three copies of the world worth measuring to along one axis. */
const WRAPS_X = [0, -MAP_WIDTH, MAP_WIDTH] as const;
const WRAPS_Y = [0, -MAP_HEIGHT, MAP_HEIGHT] as const;

/**
 * Hex steps between two cells on the wrapping world.
 *
 * The world is 800 columns wide, an even number, so a copy of it shifted by
 * its width keeps every column's parity and the odd-q conversion stays true
 * across the seam. The shortest of the nine copies is the distance.
 *
 * @param a - One cell.
 * @param b - The other.
 * @returns Steps between them.
 */
export const hexDistance = (a: RangeCell, b: RangeCell): number => {
  let best = Number.POSITIVE_INFINITY;
  for (const sx of WRAPS_X) {
    for (const sy of WRAPS_Y) {
      const steps = stepsBetween(a.x, a.y, b.x + sx, b.y + sy);
      if (steps < best) best = steps;
    }
  }
  return best;
};

/**
 * Whether a flinger at `from` with this reach can reach `to`.
 *
 * A reach of zero reaches nothing, not even the flinging cell's neighbours.
 *
 * @param from - The flinging cell.
 * @param to - The target.
 * @param reach - The flinger's reach, Declare War included.
 * @returns True when `to` is within `reach` steps.
 */
export const inReach = (from: RangeCell, to: RangeCell, reach: number): boolean =>
  reach > 0 && hexDistance(from, to) <= reach;
