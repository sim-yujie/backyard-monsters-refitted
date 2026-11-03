import { CELL_HEIGHT, CELL_WIDTH } from "@/config";
import type { OffsetCell, Point } from "@/game/HexGrid";

/**
 * The hex shape the painted ground is drawn on (Map Room 2 Modern look, plan step 2).
 *
 * The painted ground only needs a few numbers about the grid, so it is written against this small
 * description instead of `HexGrid` itself: today's world is flat-top (odd-q, 150 x 75 cells with the
 * 3/4 view baked in); plan step 1 (lane A) turns it pointy-top (odd-r, odd rows shifted half a cell
 * right). When `HexGrid` gains its shape switch, `paintedCellShape` picks the matching description
 * here and nothing else in `painted/` changes.
 *
 * Every shape is an affine stretch of a regular hex grid. The shader (`groundShader.ts`) and
 * `locateCell` below map a world point into regular-hex space (corner radius 1), round it there,
 * and read the edge distance there too; this file is the TypeScript twin of that shader code, so
 * the tests can check the shader's maths against `HexGrid`.
 */
export type CellShapeKind = "flat" | "pointy";

export interface CellShape {
  readonly kind: CellShapeKind;
  /** Corner-to-corner (flat) or side-to-side (pointy) width of a cell, world points. */
  readonly cellWidth: number;
  /** Top-to-bottom height of a cell, world points. */
  readonly cellHeight: number;
  /** World points per regular-hex unit, along x and y (regular hex corner radius = 1). */
  readonly unitX: number;
  readonly unitY: number;
}

const SQRT3 = Math.sqrt(3);

/** Today's grid: flat-top odd-q, the same numbers as `mapRoomGrid`. */
export const flatTopShape = (cellWidth = CELL_WIDTH, cellHeight = CELL_HEIGHT): CellShape => ({
  kind: "flat",
  cellWidth,
  cellHeight,
  // Regular flat-top hex of radius 1: 2 wide, sqrt(3) tall.
  unitX: cellWidth / 2,
  unitY: cellHeight / SQRT3,
});

/**
 * The pointy-top grid of plan step 1: odd-r, column step = cell width, row step = 3/4 cell height.
 * The painted map's cell is about 150 x 150 world points top-down (the medium tilt squashes it to
 * about 150 x 127 on screen); step 2 fixes the final number against mock-up B.
 */
export const pointyTopShape = (cellWidth = 150, cellHeight = 150): CellShape => ({
  kind: "pointy",
  cellWidth,
  cellHeight,
  // Regular pointy-top hex of radius 1: sqrt(3) wide, 2 tall.
  unitX: cellWidth / SQRT3,
  unitY: cellHeight / 2,
});

/** Half the distance between opposite sides of a regular hex of radius 1. */
export const APOTHEM = SQRT3 / 2;

/** The three side normals of a regular hex (the other three are their negatives). */
const NORMALS: Record<CellShapeKind, readonly (readonly [number, number])[]> = {
  flat: [
    [SQRT3 / 2, 0.5],
    [0, 1],
    [-SQRT3 / 2, 0.5],
  ],
  pointy: [
    [1, 0],
    [0.5, SQRT3 / 2],
    [-0.5, SQRT3 / 2],
  ],
};

export interface CellHit extends OffsetCell {
  /** 0 on the cell's edge, 1 at its centre (regular-hex distance to the nearest side / apothem). */
  inset: number;
  /** The cell across the nearest side. */
  across: OffsetCell;
}

/** Centre of a cell in world points. */
export const cellCentre = (shape: CellShape, col: number, row: number): Point =>
  shape.kind === "flat"
    ? { x: shape.cellWidth * 0.75 * col, y: shape.cellHeight * (row + 0.5 * (col & 1)) }
    : { x: shape.cellWidth * (col + 0.5 * (row & 1)), y: shape.cellHeight * 0.75 * row };

/** Axial (fractional) of a point in regular-hex space. */
const axialOf = (kind: CellShapeKind, hx: number, hy: number): [number, number] =>
  kind === "flat"
    ? [(2 / 3) * hx, (-1 / 3) * hx + (SQRT3 / 3) * hy]
    : [(SQRT3 / 3) * hx - (1 / 3) * hy, (2 / 3) * hy];

/** Regular-hex centre of an axial cell. */
const centreOf = (kind: CellShapeKind, q: number, r: number): [number, number] =>
  kind === "flat" ? [1.5 * q, SQRT3 * (r + q / 2)] : [SQRT3 * (q + r / 2), 1.5 * r];

const roundAxial = (q: number, r: number): [number, number] => {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
};

const toOffset = (kind: CellShapeKind, q: number, r: number): OffsetCell => {
  const cell =
    kind === "flat" ? { col: q, row: r + (q - (q & 1)) / 2 } : { col: q + (r - (r & 1)) / 2, row: r };
  return { col: cell.col + 0, row: cell.row + 0 };
};

const cellAtRegular = (kind: CellShapeKind, hx: number, hy: number): { q: number; r: number } => {
  const [fq, fr] = axialOf(kind, hx, hy);
  const [q, r] = roundAxial(fq, fr);
  return { q, r };
};

/**
 * The cell under a world point, how far inside it the point is, and the cell across its nearest
 * side (the one the painted ground blends towards). The shader does the same sums.
 */
export const locateCell = (shape: CellShape, x: number, y: number): CellHit => {
  const hx = x / shape.unitX;
  const hy = y / shape.unitY;
  const { q, r } = cellAtRegular(shape.kind, hx, hy);
  const [cx, cy] = centreOf(shape.kind, q, r);
  const dx = hx - cx;
  const dy = hy - cy;
  let best = -1;
  let bestDot = 0;
  let side: readonly [number, number] = [1, 0];
  for (const normal of NORMALS[shape.kind]) {
    const dot = dx * normal[0] + dy * normal[1];
    if (Math.abs(dot) > best) {
      best = Math.abs(dot);
      bestDot = dot;
      side = normal;
    }
  }
  const sign = bestDot < 0 ? -1 : 1;
  // The neighbour's centre is two apothems away along the side's normal.
  const across = cellAtRegular(shape.kind, cx + sign * side[0] * 2 * APOTHEM, cy + sign * side[1] * 2 * APOTHEM);
  return {
    ...toOffset(shape.kind, q, r),
    inset: Math.max(0, 1 - best / APOTHEM),
    across: toOffset(shape.kind, across.q, across.r),
  };
};

/**
 * How much the ground textures are squashed vertically so they keep the cells' look: today's
 * flat-top cells are 150 x 75 (a 3/4 view baked into the grid), so a round flower on the
 * ground is drawn flattened like the hex around it. 1 = no squash.
 */
export const textureAspect = (shape: CellShape): number => shape.unitY / shape.unitX;

/** The shape the painted ground draws on today: flat-top, until lane A's pointy-top HexGrid lands. */
export const paintedCellShape = (): CellShape => flatTopShape();
