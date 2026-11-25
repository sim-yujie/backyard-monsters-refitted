import { HexGrid, type HexShape } from "@/game/HexGrid";
import type { CellRange } from "../zones";
import { buildRiverMask, type RiverMask, type WorldRect } from "./riverMask";
import { riverPaths, type RiverCells } from "./riverPaths";

/**
 * The river picture as plain data in and out, so it can be built off the main thread
 * (`riverWorker.ts`) or on it (the fallback), with the same answer either way.
 *
 * The main thread copies what `riverPaths` reads of the cells round the asked range into typed
 * arrays (a snapshot); the build reads only the snapshot. `riverPaths` reads `rv` one cell past the
 * range and the cells round each corner of those, so two cells past the range is everything it can
 * touch: a snapshot that wide gives exactly the paths the live store would.
 */

/** Cells copied past each side of the range: all `riverPaths` can read (see above). */
export const SNAPSHOT_MARGIN = 2;

const WATER = 1;
const KNOWN = 2;

/** One river picture to build: the cells it reads and where and how fine to draw it. */
export interface RiverRequest {
  id: number;
  /** The cells the paths are built over. */
  range: CellRange;
  /** The copied cells: `range` plus {@link SNAPSHOT_MARGIN} on every side, column by column. */
  box: CellRange;
  rv: Uint8Array;
  /** Bit 1: water; bit 2: known (loaded and out of the fog). */
  flags: Uint8Array;
  lift: Float32Array;
  /** The world grid as it is now (its shape and cell size are set at run time, `setHexShape`). */
  grid: { shape: HexShape; cellWidth: number; cellHeight: number };
  rect: WorldRect;
  texelsPerCell: number;
}

/** A built picture, for the request with the same id. */
export interface RiverAnswer {
  id: number;
  mask: RiverMask;
}

/** Copies what the river paths read of `cells` round `range`. */
export const snapshotRiverCells = (
  id: number,
  range: CellRange,
  cells: RiverCells,
  grid: HexGrid,
  rect: WorldRect,
  texelsPerCell: number,
): RiverRequest => {
  const box: CellRange = {
    minCol: range.minCol - SNAPSHOT_MARGIN,
    maxCol: range.maxCol + SNAPSHOT_MARGIN,
    minRow: range.minRow - SNAPSHOT_MARGIN,
    maxRow: range.maxRow + SNAPSHOT_MARGIN,
  };
  const rows = box.maxRow - box.minRow + 1;
  const size = (box.maxCol - box.minCol + 1) * rows;
  const rv = new Uint8Array(size);
  const flags = new Uint8Array(size);
  const lift = new Float32Array(size);
  let index = 0;
  for (let col = box.minCol; col <= box.maxCol; col++) {
    for (let row = box.minRow; row <= box.maxRow; row++, index++) {
      rv[index] = cells.rvAt(col, row);
      flags[index] = (cells.isWater(col, row) ? WATER : 0) | ((cells.isKnown?.(col, row) ?? true) ? KNOWN : 0);
      lift[index] = cells.liftOf?.(col, row) ?? 0;
    }
  }
  return {
    id,
    range,
    box,
    rv,
    flags,
    lift,
    grid: { shape: grid.shape, cellWidth: grid.cellWidth, cellHeight: grid.cellHeight },
    rect,
    texelsPerCell,
  };
};

/** The snapshot read back as cells; outside its box a cell is unknown dry land with no river. */
export const snapshotCells = (request: RiverRequest): RiverCells => {
  const { box, rv, flags, lift } = request;
  const rows = box.maxRow - box.minRow + 1;
  const at = (col: number, row: number): number =>
    col < box.minCol || col > box.maxCol || row < box.minRow || row > box.maxRow
      ? -1
      : (col - box.minCol) * rows + (row - box.minRow);
  return {
    rvAt: (col, row) => {
      const index = at(col, row);
      return index < 0 ? 0 : rv[index]!;
    },
    isWater: (col, row) => {
      const index = at(col, row);
      return index >= 0 && (flags[index]! & WATER) !== 0;
    },
    isKnown: (col, row) => {
      const index = at(col, row);
      return index >= 0 && (flags[index]! & KNOWN) !== 0;
    },
    liftOf: (col, row) => {
      const index = at(col, row);
      return index < 0 ? 0 : lift[index]!;
    },
  };
};

/** Builds the picture a request asks for (in the worker, or on the main thread as the fallback). */
export const buildRiverPicture = (request: RiverRequest): RiverAnswer => {
  const { shape, cellWidth, cellHeight } = request.grid;
  const grid = new HexGrid(cellWidth, cellHeight, shape);
  const paths = riverPaths(request.range, snapshotCells(request), grid);
  return { id: request.id, mask: buildRiverMask(paths, request.rect, cellWidth, request.texelsPerCell) };
};
