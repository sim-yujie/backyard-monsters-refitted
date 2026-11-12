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
 * Cells are `(x, y)` in the offset form the server and the wire use. The
 * world's hex shape is a server switch (`MR2_HEX_SHAPE`, MR2 look plan step 1):
 *
 * - `flat` (the default, Flash's grid): odd-q, flat-top columns, odd columns
 *   half a cell lower. Axial is `q = x, r = y - (x - (x & 1)) / 2`
 *   (`MapRoomPopup.as:992-993`).
 * - `pointy`: odd-r, pointy-top rows, odd rows half a cell to the right.
 *   Axial is `q = x - (y - (y & 1)) / 2, r = y`.
 *
 * Stored coordinates are the same on both; only which cells touch differs.
 * Every function that measures takes the shape, `flat` when left out, so a
 * caller that never heard of the switch measures exactly as before.
 *
 * Pure: no imports, no clock, nothing from either tree.
 */

/** Map Room 2's world, in cells (`server/src/enums/MapRoom.ts`, `web/src/config.ts`). */
export const MAP_WIDTH = 800;
export const MAP_HEIGHT = 800;

/** Reach of a main yard's flinger by level: `2 + 2 * level` (`BUILDING5.as:16-18`). */
const MAIN_YARD_RANGES = [0, 4, 6, 8, 10] as const;

/** The longest reach a main yard's flinger has. */
export const MAX_MAIN_YARD_RANGE = 10;

/** The longest reach an outpost's flinger has. */
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
 * @returns Reach in cells.
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
 * @returns Reach in cells.
 */
export const outpostRange = (level: number | undefined): number => {
  if (level === undefined) return MAX_OUTPOST_RANGE;
  if (!(level > 0)) return 0;
  return Math.min(Math.floor(level), MAX_OUTPOST_RANGE);
};

/**
 * A flinger's reach with the alliance's extra cells added (beta 7: Conquest's
 * full Teratorn gives +1). Only a flinger that already reaches gets the extra;
 * no flinger, or a destroyed one, still reaches nothing. A missing, negative
 * or fractional extra counts whole cells only, so 0 changes nothing.
 *
 * @param reach - The flinger's own reach (`mainYardRange`/`outpostRange`).
 * @param extra - Extra cells from the alliance (`bonuses.reach`).
 * @returns Reach in cells.
 */
export const withExtraReach = (reach: number, extra: number | undefined): number => {
  const cells = Number.isFinite(extra) ? Math.max(0, Math.floor(extra!)) : 0;
  return reach > 0 ? reach + cells : reach;
};


/** The world's hex shape: Flash's flat-top columns, or pointy-top rows. */
export type HexShape = "flat" | "pointy";

/**
 * Reads the `MR2_HEX_SHAPE` switch's value: `pointy` (any case, spaces
 * ignored) is pointy-top, anything else, the default, flat-top.
 *
 * @param value - The switch's value, or what the server sent the client.
 * @returns The shape.
 */
export const hexShapeOf = (value: unknown): HexShape =>
  typeof value === "string" && value.trim().toLowerCase() === "pointy" ? "pointy" : "flat";

/** Axial `q` of an offset cell. */
export const axialQ = (x: number, y: number, shape: HexShape = "flat"): number =>
  shape === "pointy" ? x - (y - (y & 1)) / 2 : x;

/** Axial `r` of an offset cell. */
export const axialR = (x: number, y: number, shape: HexShape = "flat"): number =>
  shape === "pointy" ? y : y - (x - (x & 1)) / 2;

/** Hex steps between two cells on an unwrapped grid. */
const stepsBetween = (ax: number, ay: number, bx: number, by: number, shape: HexShape): number => {
  if (shape === "pointy") {
    const dq = bx - (by - (by & 1)) / 2 - (ax - (ay - (ay & 1)) / 2);
    const dr = by - ay;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  }
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
 * The world is 800 cells wide and tall, both even, so a copy of it shifted by
 * its width or height keeps every column's and row's parity and the odd-q or
 * odd-r conversion stays true across the seam. The shortest of the nine
 * copies is the distance.
 *
 * @param a - One cell.
 * @param b - The other.
 * @param shape - The world's hex shape.
 * @returns Steps between them.
 */
export const hexDistance = (a: RangeCell, b: RangeCell, shape: HexShape = "flat"): number => {
  let best = Number.POSITIVE_INFINITY;
  for (const sx of WRAPS_X) {
    for (const sy of WRAPS_Y) {
      const steps = stepsBetween(a.x, a.y, b.x + sx, b.y + sy, shape);
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
 * @param reach - The flinger's reach.
 * @param shape - The world's hex shape.
 * @returns True when `to` is within `reach` steps.
 */
export const inReach = (
  from: RangeCell,
  to: RangeCell,
  reach: number,
  shape: HexShape = "flat",
): boolean =>
  reach > 0 && hexDistance(from, to, shape) <= reach;

/**
 * The six axial directions, starting east (lower right on flat-top) and
 * turning counter-clockwise. The web grid's `HexGrid.neighbours` keeps this
 * order, which the range overlay's edge sides rely on.
 */
const AXIAL_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

const wrapTo = (value: number, size: number): number => ((value % size) + size) % size;

/**
 * The six cells touching `(x, y)` on the wrapping world, in `AXIAL_DIRECTIONS`
 * order. Exactly the cells `hexDistance` puts one step away.
 *
 * @param x - The cell's column.
 * @param y - The cell's row.
 * @param shape - The world's hex shape.
 * @returns The six neighbours, wrapped into the world.
 */
export const hexNeighbours = (x: number, y: number, shape: HexShape = "flat"): RangeCell[] => {
  const q = axialQ(x, y, shape);
  const r = axialR(x, y, shape);
  return AXIAL_DIRECTIONS.map(([dq, dr]) => {
    const nq = q + dq;
    const nr = r + dr;
    const nx = shape === "pointy" ? nq + (nr - (nr & 1)) / 2 : nq;
    const ny = shape === "pointy" ? nr : nr + (nq - (nq & 1)) / 2;
    return { x: wrapTo(nx, MAP_WIDTH), y: wrapTo(ny, MAP_HEIGHT) };
  });
};
