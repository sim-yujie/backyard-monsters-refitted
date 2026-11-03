import { CELL_HEIGHT, CELL_WIDTH, POINTY_CELL_HEIGHT } from "@/config";
import { type HexShape, axialQ, axialR } from "@/game/maproom/rules/range";

export type { HexShape };

/** A cell in offset coordinates, the form the server and the wire use. */
export interface OffsetCell {
  col: number;
  row: number;
}

/** A cell in axial coordinates, used for neighbour and distance maths. */
export interface AxialCell {
  q: number;
  r: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * The six axial directions, in the conventional order starting east and
 * turning counter-clockwise.
 */
const AXIAL_DIRECTIONS: readonly AxialCell[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

const SQRT3 = Math.sqrt(3);

/**
 * The world's hex shape (`MR2_HEX_SHAPE`, MR2 look plan step 1), as the server
 * sent it in the settings block. Flat until the map has asked, which is
 * exactly today's game; `setHexShape` changes it before the map draws a cell.
 */
let currentShape: HexShape = "flat";

/** The world's hex shape as the map last heard it from the server. */
export const hexShape = (): HexShape => currentShape;

/**
 * Map Room 2's hex grid.
 *
 * Why odd-q: the game stores cells as (x, y) offset pairs, and both the Flash
 * client and the server convert them to axial with
 * `q = x, r = y - (x - (x & 1)) / 2` before doing any neighbour, range or
 * distance work (MapRoomPopup.as:1034-1046, and the server's validateRange).
 * That formula is odd-q offset with flat-top columns, so odd columns sit half a
 * cell lower than even ones. Everything here derives from that one conversion
 * rather than hardcoding per-parity tables, which keeps the geometry and the
 * server's range checks in agreement by construction.
 *
 * Pointy-top (`MR2_HEX_SHAPE=pointy`): odd-r offset instead, odd rows half a
 * cell to the right, axial `q = x - (y - (y & 1)) / 2, r = y`, the same
 * conversion as the shared rules (`maproom/rules/range.ts`). Stored (x, y)
 * stay as they are; only which cells touch, and where they are drawn, change.
 *
 * Note that `(q - (q & 1)) / 2` is exact for negative q as well, because the
 * numerator is always even and JavaScript's `&` works on the two's-complement
 * value.
 *
 * The cells are not regular hexagons: the flat-top art is 150 x 75 with a 0.75
 * horizontal step, so a cell is wider than a regular hex of the same width is
 * tall; a pointy-top cell is 150 x 100 with a 0.75 vertical step. Pixel
 * conversions scale the vertical axis to compensate, which is an affine map
 * and so preserves which hex a point falls in.
 *
 * The static helpers and `mapRoomGrid` follow the world's shape
 * (`setHexShape`); a grid built with an explicit shape keeps it.
 */
export class HexGrid {
  /** Horizontal distance between the centres of adjacent columns (in one row, on pointy-top). */
  colStep = 0;
  /** Vertical distance between the centres of adjacent rows (in one column, on flat-top). */
  rowStep = 0;

  constructor(
    public cellWidth: number = CELL_WIDTH,
    public cellHeight: number = CELL_HEIGHT,
    public shape: HexShape = "flat",
  ) {
    this.reshape(shape, cellWidth, cellHeight);
  }

  /** Changes the grid's shape and cell size in place (the world's grid on `setHexShape`). */
  reshape(shape: HexShape, cellWidth: number, cellHeight: number): void {
    this.shape = shape;
    this.cellWidth = cellWidth;
    this.cellHeight = cellHeight;
    this.colStep = shape === "pointy" ? cellWidth : cellWidth * 0.75;
    this.rowStep = shape === "pointy" ? cellHeight * 0.75 : cellHeight;
  }

  /** Offset (odd-q, or odd-r on pointy-top) to axial. */
  static toAxial(col: number, row: number, shape: HexShape = currentShape): AxialCell {
    return { q: axialQ(col, row, shape), r: axialR(col, row, shape) };
  }

  /** Axial back to offset (odd-q, or odd-r on pointy-top). */
  static toOffset(q: number, r: number, shape: HexShape = currentShape): OffsetCell {
    if (shape === "pointy") {
      return { col: noNegativeZero(q + (r - (r & 1)) / 2), row: noNegativeZero(r) };
    }
    return { col: noNegativeZero(q), row: noNegativeZero(r + (q - (q & 1)) / 2) };
  }

  /** Hex distance in cells, ignoring the world's toroidal wrap. */
  static distance(a: OffsetCell, b: OffsetCell, shape: HexShape = currentShape): number {
    const from = HexGrid.toAxial(a.col, a.row, shape);
    const to = HexGrid.toAxial(b.col, b.row, shape);
    const dq = to.q - from.q;
    const dr = to.r - from.r;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(-dq - dr));
  }

  /**
   * The six cells touching this one, not wrapped, in axial order: east,
   * north-east, north-west, west, south-west, south-east (on flat-top
   * "east" is the lower right and "north-west" straight up).
   */
  static neighbours(col: number, row: number, shape: HexShape = currentShape): OffsetCell[] {
    const { q, r } = HexGrid.toAxial(col, row, shape);
    return AXIAL_DIRECTIONS.map((direction) =>
      HexGrid.toOffset(q + direction.q, r + direction.r, shape),
    );
  }

  /** Centre of a cell in world pixels. */
  cellToPixel(col: number, row: number): Point {
    if (this.shape === "pointy") {
      return {
        // Odd rows are pushed right half a column.
        x: this.colStep * (col + 0.5 * (row & 1)),
        y: this.rowStep * row,
      };
    }
    return {
      x: this.colStep * col,
      // Odd columns are pushed down half a row.
      y: this.rowStep * (row + 0.5 * (col & 1)),
    };
  }

  /**
   * The cell containing a world pixel.
   *
   * The layout is stretched relative to a regular hex grid, so the point is
   * first mapped into regular-hex space (flat-top: vertical spacing
   * sqrt(3) * size; pointy-top: 1.5 * size), converted with the standard
   * inverse, and rounded in cube space.
   */
  pixelToCell(x: number, y: number): OffsetCell {
    if (this.shape === "pointy") {
      const size = this.colStep / SQRT3;
      const regularY = y * ((1.5 * size) / this.rowStep);
      const q = ((SQRT3 / 3) * x - (1 / 3) * regularY) / size;
      const r = ((2 / 3) * regularY) / size;
      const rounded = roundAxial(q, r);
      return HexGrid.toOffset(rounded.q, rounded.r, "pointy");
    }

    const size = this.colStep / 1.5;
    const regularY = y * ((SQRT3 * size) / this.rowStep);

    const q = ((2 / 3) * x) / size;
    const r = ((-1 / 3) * x + (SQRT3 / 3) * regularY) / size;

    const rounded = roundAxial(q, r);
    return HexGrid.toOffset(rounded.q, rounded.r, "flat");
  }

  /**
   * The six corners of a cell written into `out` as a flat `[x, y, ...]`.
   *
   * Flat-top: west, upper left, upper right, east, lower right, lower left.
   * Pointy-top: lower left, upper left, top, upper right, lower right,
   * bottom. Both run clockwise on screen, and on both the same pair of
   * corners bounds the side facing the same `neighbours` entry, so
   * `attackRange.ts`'s `NEIGHBOUR_EDGES` holds for either shape.
   *
   * The allocating form below is the one to reach for; this exists because the
   * renderer builds several thousand hexes per rebuild and the object churn
   * from `cellCorners` alone was enough to show up as collection pauses. `out`
   * must have room for 12 numbers, and is returned for convenience.
   */
  writeCellCorners(col: number, row: number, out: number[]): number[] {
    const centre = this.cellToPixel(col, row);
    const halfWidth = this.cellWidth / 2;
    const halfHeight = this.cellHeight / 2;

    if (this.shape === "pointy") {
      const quarterHeight = this.cellHeight / 4;
      out[0] = centre.x - halfWidth;
      out[1] = centre.y + quarterHeight;
      out[2] = centre.x - halfWidth;
      out[3] = centre.y - quarterHeight;
      out[4] = centre.x;
      out[5] = centre.y - halfHeight;
      out[6] = centre.x + halfWidth;
      out[7] = centre.y - quarterHeight;
      out[8] = centre.x + halfWidth;
      out[9] = centre.y + quarterHeight;
      out[10] = centre.x;
      out[11] = centre.y + halfHeight;
      return out;
    }

    const quarterWidth = this.cellWidth / 4;
    out[0] = centre.x - halfWidth;
    out[1] = centre.y;
    out[2] = centre.x - quarterWidth;
    out[3] = centre.y - halfHeight;
    out[4] = centre.x + quarterWidth;
    out[5] = centre.y - halfHeight;
    out[6] = centre.x + halfWidth;
    out[7] = centre.y;
    out[8] = centre.x + quarterWidth;
    out[9] = centre.y + halfHeight;
    out[10] = centre.x - quarterWidth;
    out[11] = centre.y + halfHeight;
    return out;
  }

  /** The six corners of a cell in world pixels, for drawing its outline (order as `writeCellCorners`). */
  cellCorners(col: number, row: number): Point[] {
    const flat = this.writeCellCorners(col, row, new Array<number>(12));
    const points: Point[] = [];
    for (let i = 0; i < 12; i += 2) points.push({ x: flat[i]!, y: flat[i + 1]! });
    return points;
  }

  /**
   * Half the cell's width at a height `dy` from its centre (0 outside it):
   * "is this inside the hex" along a row, for the fog edge.
   */
  halfWidthAt(dy: number): number {
    const halfHeight = this.cellHeight / 2;
    const away = Math.abs(dy);
    if (away > halfHeight) return 0;
    if (this.shape === "pointy") {
      // Straight sides down to a quarter height, then a point.
      const quarterHeight = this.cellHeight / 4;
      if (away <= quarterHeight) return this.cellWidth / 2;
      return (this.cellWidth / 2) * ((halfHeight - away) / quarterHeight);
    }
    return this.cellWidth / 2 - (this.cellWidth / 4) * (away / halfHeight);
  }

  /** Full pixel extent of a grid of the given size, used to clamp the camera. */
  worldBounds(cols: number, rows: number): { width: number; height: number } {
    if (this.shape === "pointy") {
      return {
        width: this.colStep * (cols + 0.5) + this.cellWidth / 2,
        height: this.rowStep * rows + this.cellHeight / 2,
      };
    }
    return {
      width: this.colStep * cols + this.cellWidth / 2,
      height: this.rowStep * (rows + 0.5) + this.cellHeight / 2,
    };
  }
}

/**
 * Collapses -0 to 0.
 *
 * Math.round returns -0 for any input in [-0.5, 0), so a cell just left of the
 * origin comes back as `{ col: -0 }`. That compares equal with `===` but not
 * with Object.is or a deep equality check, and it stringifies as "-0" in a
 * cache key, so it is worth removing at the boundary rather than downstream.
 */
const noNegativeZero = (value: number): number => (value === 0 ? 0 : value);

/** Rounds fractional axial coordinates to the nearest whole hex, via cube. */
const roundAxial = (q: number, r: number): AxialCell => {
  const s = -q - r;

  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);

  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);

  // Discard whichever component drifted furthest; the other two determine the hex.
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;

  return { q: rq, r: rr };
};

/**
 * The world's grid: the game's 150 x 75 flat-top cell art, or 150 x 100
 * pointy-top cells once `setHexShape("pointy")` has run. One object, changed
 * in place, so every module holding it sees the shape the map opened with.
 */
export const mapRoomGrid = new HexGrid();

/** The cell size the tile map uses for each shape. */
export const cellSizeFor = (shape: HexShape): { width: number; height: number } =>
  shape === "pointy" ? { width: CELL_WIDTH, height: POINTY_CELL_HEIGHT } : { width: CELL_WIDTH, height: CELL_HEIGHT };

/**
 * Sets the world's hex shape, as the server's settings block names it, before
 * the map draws or picks a cell. Returns whether it changed, so a caller
 * holding shape-built caches (atlas, chunks) knows to drop them.
 */
export const setHexShape = (shape: HexShape): boolean => {
  if (shape === currentShape && mapRoomGrid.shape === shape) return false;
  currentShape = shape;
  const size = cellSizeFor(shape);
  mapRoomGrid.reshape(shape, size.width, size.height);
  return true;
};
