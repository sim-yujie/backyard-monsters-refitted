import { BufferImageSource } from "pixi.js";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { isPlayerCell, type MapCell } from "@/api/types";
import { HexGrid } from "@/game/HexGrid";
import { relationOf, type PlayerRelation } from "../cellVisuals";
import type { ZoneRecord } from "../ZoneStore";
import type { CellRange } from "../zones";
import { cellCentre, locateCell, type CellShape, type CellShapeKind } from "./cellShape";

/**
 * Glowing borders round players' land on the painted map (Map Room 2 Modern look, plan step 8).
 *
 * Each player's cells (main yard and outposts) get one outline round the whole group: a side of a
 * player's cell is a border when the cell across it is not that player's. Tribe camps, water, fog
 * and cells not loaded yet have no owner. The colour says how the owner relates to the viewer:
 * yours cyan, your alliance green, anyone who attacked you red, everyone else blue.
 *
 * This file keeps the facts the border shader (`borderShader.ts`) reads, one texel per cell:
 *   R  relation code (`BorderRelation`), 0 = no border at all
 *   G  which of the cell's six sides are borders, bit k = the side towards `HexGrid.neighbours`[k]
 *   A  always 255: the texture is uploaded unpremultiplied, but a zero alpha would still let a
 *      driver or a later Pixi default wipe the colour bytes.
 * and `borderDistance`, the TypeScript twin of the shader's distance sum, for the tests.
 */
export const BorderRelation = {
  NONE: 0,
  YOU: 1,
  ALLIANCE: 2,
  OTHER: 3,
  ATTACKER: 4,
} as const;
export type BorderRelation = (typeof BorderRelation)[keyof typeof BorderRelation];

const RELATION_CODE: Record<PlayerRelation, BorderRelation> = {
  you: BorderRelation.YOU,
  alliance: BorderRelation.ALLIANCE,
  other: BorderRelation.OTHER,
  attacker: BorderRelation.ATTACKER,
};

/**
 * The border colours, by relation code (owner, 3 Nov 2026: yours cyan, alliance green, others blue,
 * attackers red), as 0xRRGGBB. Bright and a little cool, like mock-up B's glow.
 */
export const BORDER_COLOURS: Record<Exclude<BorderRelation, 0>, number> = {
  [BorderRelation.YOU]: 0x3cf2ff,
  [BorderRelation.ALLIANCE]: 0x54f06e,
  [BorderRelation.OTHER]: 0x4a9bff,
  [BorderRelation.ATTACKER]: 0xff4a3d,
};

/** A cell's owner for the borders: the player's user id, or 0 for no player. */
export const ownerOf = (cell: MapCell | undefined): number =>
  cell !== undefined && isPlayerCell(cell) && cell.uid > 0 ? cell.uid : 0;

/** The border relation of a cell (0 when no player owns it). */
export const borderRelationOf = (cell: MapCell | undefined, myAlliance: number | null): BorderRelation =>
  cell !== undefined && ownerOf(cell) > 0 && isPlayerCell(cell)
    ? RELATION_CODE[relationOf(cell, myAlliance)]
    : BorderRelation.NONE;

/**
 * Which sides of a cell are borders: bit k is set when the cell across side k (the k-th of
 * `HexGrid.neighbours`) has another owner. A cell nobody owns has none.
 */
export const borderSides = (
  col: number,
  row: number,
  kind: CellShapeKind,
  ownerAt: (col: number, row: number) => number,
): number => {
  const owner = ownerAt(col, row);
  if (owner === 0) return 0;
  let mask = 0;
  HexGrid.neighbours(col, row, kind).forEach((next, side) => {
    if (ownerAt(next.col, next.row) !== owner) mask |= 1 << side;
  });
  return mask;
};

/**
 * The world's border facts and their data texture. Written per zone as responses arrive (each
 * zone also refreshes the sides of the cells just round it, which may now border it), uploaded at
 * most once a frame by `flush`, like `GroundData`.
 */
export class BorderData {
  readonly bytes: Uint8Array;
  readonly source: BufferImageSource;
  private readonly owners: Int32Array;
  private dirty = false;

  constructor(
    readonly kind: CellShapeKind,
    readonly width = WORLD_WIDTH,
    readonly height = WORLD_HEIGHT,
  ) {
    this.bytes = new Uint8Array(width * height * 4);
    this.owners = new Int32Array(width * height);
    this.clear();
    this.source = new BufferImageSource({
      resource: this.bytes,
      width,
      height,
      format: "rgba8unorm",
      // Raw facts, not colours: never premultiplied on upload.
      alphaMode: "no-premultiply-alpha",
      scaleMode: "nearest",
      autoGenerateMipmaps: false,
    });
  }

  private inside(col: number, row: number): boolean {
    return col >= 0 && col < this.width && row >= 0 && row < this.height;
  }

  /** The owner's user id at a cell, 0 for none or outside the world. */
  readonly ownerAt = (col: number, row: number): number =>
    this.inside(col, row) ? this.owners[row * this.width + col]! : 0;

  /** The relation code at a cell. */
  relationAt(col: number, row: number): BorderRelation {
    return this.inside(col, row) ? (this.bytes[(row * this.width + col) * 4] as BorderRelation) : 0;
  }

  /** The border sides at a cell (bit k = side towards `HexGrid.neighbours`[k]). */
  sidesAt(col: number, row: number): number {
    return this.inside(col, row) ? this.bytes[(row * this.width + col) * 4 + 1]! : 0;
  }

  /** Writes one area response, then refreshes the sides of its cells and the ring round them. */
  applyZone(zone: ZoneRecord, myAlliance: number | null): void {
    const touched: number[] = [];
    for (const [xKey, column] of Object.entries(zone.data)) {
      const x = Number(xKey);
      if (!(x >= 0 && x < this.width)) continue;
      for (const [yKey, cell] of Object.entries(column)) {
        const y = Number(yKey);
        if (!(y >= 0 && y < this.height)) continue;
        const index = y * this.width + x;
        const owner = ownerOf(cell);
        const relation = owner > 0 ? borderRelationOf(cell, myAlliance) : BorderRelation.NONE;
        const was = this.owners[index]!;
        this.owners[index] = owner;
        this.bytes[index * 4] = relation;
        // A cell keeps or loses an owner: it and its ring may gain or lose sides.
        if (owner !== 0 || was !== 0) touched.push(x, y);
      }
    }
    for (let i = 0; i < touched.length; i += 2) this.refreshAround(touched[i]!, touched[i + 1]!);
    this.dirty = true;
  }

  private refreshAround(col: number, row: number): void {
    this.refreshSides(col, row);
    for (const next of HexGrid.neighbours(col, row, this.kind)) this.refreshSides(next.col, next.row);
  }

  private refreshSides(col: number, row: number): void {
    if (!this.inside(col, row)) return;
    this.bytes[(row * this.width + col) * 4 + 1] = borderSides(col, row, this.kind, this.ownerAt);
  }

  /**
   * Whether any border cell lies in this range (so the pulse needs to run). A large range is probed
   * on a sparser grid, which can miss a lone far cell; that only stills its pulse.
   */
  hasBorder(range: CellRange): boolean {
    const x0 = Math.max(0, Math.floor(range.minCol));
    const x1 = Math.min(this.width - 1, Math.ceil(range.maxCol));
    const y0 = Math.max(0, Math.floor(range.minRow));
    const y1 = Math.min(this.height - 1, Math.ceil(range.maxRow));
    if (x1 < x0 || y1 < y0) return false;
    const stride = Math.max(1, Math.ceil(Math.sqrt(((x1 - x0 + 1) * (y1 - y0 + 1)) / 4096)));
    for (let y = y0; y <= y1; y += stride) {
      for (let x = x0; x <= x1; x += stride) {
        if (this.bytes[(y * this.width + x) * 4 + 1]! !== 0) return true;
      }
    }
    return false;
  }

  /** No owners anywhere (the player's sight changed). */
  reset(): void {
    this.clear();
    this.owners.fill(0);
    this.dirty = true;
  }

  private clear(): void {
    this.bytes.fill(0);
    for (let offset = 3; offset < this.bytes.length; offset += 4) this.bytes[offset] = 255;
  }

  /** Uploads pending writes; returns whether it did (a tilted view must then redraw). */
  flush(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    this.source.update();
    return true;
  }

  destroy(): void {
    this.source.destroy();
  }
}

const SQRT3 = Math.sqrt(3);

/** Axial steps of `HexGrid.neighbours`, in the same order (the shader has the same list). */
const AXIAL_STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** A neighbour's centre in regular-hex space (corner radius 1), from its axial step. */
const stepCentre = (kind: CellShapeKind, q: number, r: number): [number, number] =>
  kind === "flat" ? [1.5 * q, SQRT3 * (r + q / 2)] : [SQRT3 * (q + r / 2), 1.5 * r];

/**
 * The two ends of side k of a cell, in world points from the cell's centre. In regular-hex space
 * the side's middle is half way to the neighbour's centre and the side is 1 long, square to that.
 */
export const sideEnds = (shape: CellShape, side: number): [number, number, number, number] => {
  const [q, r] = AXIAL_STEPS[side]!;
  const [mx, my] = stepCentre(shape.kind, q, r).map((v) => v / 2) as [number, number];
  const length = Math.hypot(mx, my);
  const tx = (-my / length) * 0.5;
  const ty = (mx / length) * 0.5;
  return [(mx - tx) * shape.unitX, (my - ty) * shape.unitY, (mx + tx) * shape.unitX, (my + ty) * shape.unitY];
};

const segmentDistance = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const ex = bx - ax;
  const ey = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey)));
  return Math.hypot(px - ax - t * ex, py - ay - t * ey);
};

/**
 * How far a world point is from its cell's nearest border side, in world points, or Infinity when
 * the cell has no border sides (no owner, or inside a player's land). Distance to the side as a
 * segment, so where an outline turns inwards the glow rounds the corner instead of leaving a
 * notch. The shader does the same sums.
 */
export const borderDistance = (
  shape: CellShape,
  x: number,
  y: number,
  sidesAt: (col: number, row: number) => number,
): number => {
  const hit = locateCell(shape, x, y);
  const mask = sidesAt(hit.col, hit.row);
  if (mask === 0) return Infinity;
  const centre = cellCentre(shape, hit.col, hit.row);
  const px = x - centre.x;
  const py = y - centre.y;
  let best = Infinity;
  for (let side = 0; side < 6; side++) {
    if ((mask & (1 << side)) === 0) continue;
    const [ax, ay, bx, by] = sideEnds(shape, side);
    best = Math.min(best, segmentDistance(px, py, ax, ay, bx, by));
  }
  return best;
};
