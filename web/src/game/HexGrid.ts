import { CELL_HEIGHT, CELL_WIDTH } from "@/config";

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
 * Note that `(q - (q & 1)) / 2` is exact for negative q as well, because the
 * numerator is always even and JavaScript's `&` works on the two's-complement
 * value.
 *
 * The cells are not regular hexagons: the art is 150 x 75 with a 0.75
 * horizontal step, so a cell is wider than a regular hex of the same width is
 * tall. Pixel conversions scale the vertical axis to compensate, which is an
 * affine map and so preserves which hex a point falls in.
 */
export class HexGrid {
  /** Horizontal distance between the centres of adjacent columns. */
  readonly colStep: number;
  /** Vertical distance between the centres of adjacent rows in one column. */
  readonly rowStep: number;

  constructor(
    readonly cellWidth: number = CELL_WIDTH,
    readonly cellHeight: number = CELL_HEIGHT,
  ) {
    this.colStep = cellWidth * 0.75;
    this.rowStep = cellHeight;
  }

  /** Offset (odd-q) to axial. */
  static toAxial(col: number, row: number): AxialCell {
    return { q: col, r: row - (col - (col & 1)) / 2 };
  }

  /** Axial back to offset (odd-q). */
  static toOffset(q: number, r: number): OffsetCell {
    return { col: noNegativeZero(q), row: noNegativeZero(r + (q - (q & 1)) / 2) };
  }

  /** Hex distance in cells, ignoring the world's toroidal wrap. */
  static distance(a: OffsetCell, b: OffsetCell): number {
    const from = HexGrid.toAxial(a.col, a.row);
    const to = HexGrid.toAxial(b.col, b.row);
    const dq = to.q - from.q;
    const dr = to.r - from.r;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(-dq - dr));
  }

  /**
   * The six cells touching this one, in the order east, north-east, north-west,
   * west, south-west, south-east.
   */
  static neighbours(col: number, row: number): OffsetCell[] {
    const { q, r } = HexGrid.toAxial(col, row);
    return AXIAL_DIRECTIONS.map((direction) =>
      HexGrid.toOffset(q + direction.q, r + direction.r),
    );
  }

  /** Centre of a cell in world pixels. */
  cellToPixel(col: number, row: number): Point {
    return {
      x: this.colStep * col,
      // Odd columns are pushed down half a row.
      y: this.rowStep * (row + 0.5 * (col & 1)),
    };
  }

  /**
   * The cell containing a world pixel.
   *
   * The layout is stretched relative to a regular flat-top hex grid, so the
   * point is first mapped into regular-hex space (where the vertical spacing
   * would be sqrt(3) * size), converted with the standard flat-top inverse, and
   * rounded in cube space.
   */
  pixelToCell(x: number, y: number): OffsetCell {
    const size = this.colStep / 1.5;
    const regularY = y * ((SQRT3 * size) / this.rowStep);

    const q = ((2 / 3) * x) / size;
    const r = ((-1 / 3) * x + (SQRT3 / 3) * regularY) / size;

    const rounded = roundAxial(q, r);
    return HexGrid.toOffset(rounded.q, rounded.r);
  }

  /**
   * The six corners of a cell written into `out` as a flat `[x, y, ...]`.
   *
   * The allocating form below is the one to reach for; this exists because the
   * renderer builds several thousand hexes per rebuild and the object churn
   * from `cellCorners` alone was enough to show up as collection pauses. `out`
   * must have room for 12 numbers, and is returned for convenience.
   */
  writeCellCorners(col: number, row: number, out: number[]): number[] {
    const centre = this.cellToPixel(col, row);
    const halfWidth = this.cellWidth / 2;
    const quarterWidth = this.cellWidth / 4;
    const halfHeight = this.cellHeight / 2;

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

  /** The six corners of a cell in world pixels, for drawing its outline. */
  cellCorners(col: number, row: number): Point[] {
    const centre = this.cellToPixel(col, row);
    const halfWidth = this.cellWidth / 2;
    const quarterWidth = this.cellWidth / 4;
    const halfHeight = this.cellHeight / 2;

    // Flat-top: two points on the horizontal axis, four on the shoulders.
    return [
      { x: centre.x - halfWidth, y: centre.y },
      { x: centre.x - quarterWidth, y: centre.y - halfHeight },
      { x: centre.x + quarterWidth, y: centre.y - halfHeight },
      { x: centre.x + halfWidth, y: centre.y },
      { x: centre.x + quarterWidth, y: centre.y + halfHeight },
      { x: centre.x - quarterWidth, y: centre.y + halfHeight },
    ];
  }

  /** Full pixel extent of a grid of the given size, used to clamp the camera. */
  worldBounds(cols: number, rows: number): { width: number; height: number } {
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

/** A grid using the game's 150 x 75 cell art. */
export const mapRoomGrid = new HexGrid();
