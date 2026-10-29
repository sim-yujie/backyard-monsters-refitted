import { isFogCell, type MapCell } from "@/api/types";
import { mapRoomGrid, type OffsetCell } from "@/game/HexGrid";
import { WATER_MAX_HEIGHT } from "@/config";

/**
 * Flash's raised ground (`MapRoomCell.Update`, `MapRoomCell_CLIP`).
 *
 * Flash drew every cell as a little hex column, a textured top face over a
 * strip of cliff, and stood it at its height: land rises 0.6 px per metre
 * above 100, water sinks 1 px per metre below it, and a sheet of water at
 * the 100 line lies over the sunken cells. The cells are painted in screen
 * order (`MapRoomPopup`'s `depth = y * 1000 + x`), so a cell nearer the
 * bottom of the screen covers the cliff of the one behind it, and a hill
 * shows its cliff only where it stands above its neighbour.
 */

/** Land rises this many pixels per metre above 100. */
const LAND_LIFT_PER_METRE = 0.6;

/** The height Flash stood every cell from: land rises above it, water sinks below it. */
const GROUND_LEVEL = 100;

/**
 * How far a cell of this height is drawn from its place on the grid, in world
 * pixels: negative is up the screen (a hill), positive is down (deep water).
 * Flash's `int()`, so whole pixels, truncated.
 */
export const groundLift = (height: number): number => {
  const lift =
    height > WATER_MAX_HEIGHT
      ? -Math.trunc((height - GROUND_LEVEL) * LAND_LIFT_PER_METRE)
      : Math.trunc(GROUND_LEVEL - height);
  // Never -0, which reads as a different number to Object.is.
  return lift === 0 ? 0 : lift;
};

/** A cell's lift, or 0 for one the viewer cannot see or has not loaded. */
export const cellLift = (cell: MapCell | undefined): number =>
  cell === undefined || isFogCell(cell) ? 0 : groundLift(cell.i);

/** Moves a flat `[x, y, ...]` outline (`HexGrid.writeCellCorners`) by a lift, in place. */
export const liftCorners = (corners: number[], lift: number): number[] => {
  if (lift !== 0) for (let index = 1; index < corners.length; index += 2) corners[index] = corners[index]! + lift;
  return corners;
};

/**
 * The order cells are painted in: by their place on the grid, not where their
 * height puts them, top row first and left to right within a row (Flash's
 * `depth`). A sprite's `zIndex` in the shared ground layer.
 */
export const paintOrder = (col: number, row: number): number => {
  const centre = mapRoomGrid.cellToPixel(col, row);
  return centre.y * 100_000 + centre.x;
};

/**
 * Rows a click can be away from the cell it lands on: a hill's top face rises
 * up to about one row over the cells behind it, and deep water sinks about
 * one row below its place.
 */
const PICK_ROWS = 2;

/**
 * The cell whose drawn top face is under a world point, with each cell drawn
 * `liftOf` pixels from its place (Flash's hit area moves with the cell).
 *
 * Where two raised faces overlap the front one wins, as it is the one painted
 * on top. A point on no face at all (a cliff, or a gap between a hill and
 * deep water) falls back to the cell whose place it is.
 */
export const pickCell = (x: number, y: number, liftOf: (col: number, row: number) => number): OffsetCell => {
  const flat = mapRoomGrid.pixelToCell(x, y);
  let best: OffsetCell | null = null;
  let bestOrder = Number.NEGATIVE_INFINITY;
  for (let col = flat.col - 1; col <= flat.col + 1; col++) {
    for (let row = flat.row - PICK_ROWS; row <= flat.row + PICK_ROWS; row++) {
      const lift = liftOf(col, row);
      const hit = lift === 0 ? flat : mapRoomGrid.pixelToCell(x, y - lift);
      if (hit.col !== col || hit.row !== row) continue;
      const order = paintOrder(col, row);
      if (order > bestOrder) {
        bestOrder = order;
        best = hit;
      }
    }
  }
  return best ?? flat;
};
