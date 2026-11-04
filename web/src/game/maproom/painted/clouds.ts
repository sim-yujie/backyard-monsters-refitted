import { steppedSeconds } from "../animationClock";
import type { Quality } from "@/game/quality";
import type { CellRange } from "../zones";
import { locateCell, type CellShape } from "./cellShape";
import type { GroundData } from "./GroundData";
import { Ground } from "./groundKinds";

/**
 * The painted fog's rules (plan step 9), the TypeScript twin of `cloudShader.ts`'s sums so the tests
 * can check them.
 *
 * The fog's share round a point weighs its cell and the six round it by distance, with a kernel that
 * is zero from `CLOUD_KERNEL_RADIUS` hex units (corner radius 1) out. A point is at most 1 from its
 * own cell's centre and the second ring of cells is at least 3 away, so every cell the kernel can
 * reach is among those seven: the share is the same whichever cell the sum starts from, and does not
 * jump at a cell's side. Across a straight edge of sight it runs about 0.5 + 0.52 x the distance
 * past the edge (hex units, + into the fog).
 */
export const CLOUD_KERNEL_RADIUS = 1.9;

/**
 * The cloud's edge wanders between these shares: from about half a hex unit (a third of a cell) into
 * the seen land (a bank billowing over its outer cells) to less than a tenth into the fog, so a fog cell is
 * never left bare and a seen cell's middle is never covered.
 */
export const CLOUD_EDGE_LOW = 0.22;
export const CLOUD_EDGE_HIGH = 0.54;

/**
 * How often the clouds drift a step, in ticks of the map's animation clock, by Quality: on the
 * water's ticks (10 a second on High, 5 on Medium), so the two never make a still tilted view redraw
 * on different frames (`animationClock.ts`); still on Low. The drift is only a few pixels a second.
 */
export const CLOUD_STEP_TICKS: Record<Quality, number | null> = { high: 3, medium: 6, low: null };

/** The clouds' clock for this moment: whole steps of the Quality's rate since `startMs`, in seconds. */
export const cloudTime = (nowMs: number, startMs: number, level: Quality): number => {
  const every = CLOUD_STEP_TICKS[level];
  return every === null ? 0 : steppedSeconds(nowMs, startMs, every);
};

const SQRT3 = Math.sqrt(3);

/** The six neighbours in axial steps (the same for both hex shapes), as in the shader. */
const NEIGHBOURS: readonly [number, number][] = [
  [0, 0],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** Axial (q, r) of an offset cell, for the grid's shape (odd-q flat-top, odd-r pointy-top). */
const axialOfCell = (shape: CellShape, col: number, row: number): [number, number] =>
  shape.kind === "flat" ? [col, row - (col - (col & 1)) / 2] : [col - (row - (row & 1)) / 2, row];

const offsetOfAxial = (shape: CellShape, q: number, r: number): [number, number] =>
  shape.kind === "flat" ? [q, r + (q - (q & 1)) / 2] : [q + (r - (r & 1)) / 2, r];

/** A cell's centre in hex units (regular hex, corner radius 1). */
const hexCentre = (shape: CellShape, q: number, r: number): [number, number] =>
  shape.kind === "flat" ? [1.5 * q, SQRT3 * (r + q * 0.5)] : [SQRT3 * (q + r * 0.5), 1.5 * r];

/**
 * The fog's share round world point (x, y): 1 deep in the fog, 0 deep in sight. `isFog` says which
 * cells are fog (the shader treats cells outside the world as fog too). `from` is for the tests: the
 * cell the sum starts from (the shader always starts from the point's own cell).
 */
export const fogShare = (
  shape: CellShape,
  x: number,
  y: number,
  isFog: (col: number, row: number) => boolean,
  from?: { col: number; row: number },
): number => fogDepth(shape, x, y, (col, row) => (isFog(col, row) ? 1 : 0), from);

/** Whether a point with this fog share is under cloud for certain (past the edge's furthest reach). */
export const surelyCloud = (share: number): boolean => share >= CLOUD_EDGE_HIGH;

/** Whether a point with this fog share is clear of cloud for certain. */
export const surelyClear = (share: number): boolean => share < CLOUD_EDGE_LOW;

/** At most about this many cells are looked at when asking whether fog is in sight. */
const FOG_PROBES = 4096;

/**
 * Whether any fog cell lies in this range of the ground's data (so the clouds' clock needs to run).
 * A large range is probed on a sparser grid, which can miss a lone fog cell; that only stills it.
 */
export const fogInRange = (
  data: Pick<GroundData, "bytes" | "width" | "height">,
  range: CellRange,
): boolean => {
  const x0 = Math.max(0, Math.floor(range.minCol));
  const x1 = Math.min(data.width - 1, Math.ceil(range.maxCol));
  const y0 = Math.max(0, Math.floor(range.minRow));
  const y1 = Math.min(data.height - 1, Math.ceil(range.maxRow));
  // A view reaching past the world's edge sees the cloud that runs on beyond it.
  if (range.minCol < 0 || range.minRow < 0 || range.maxCol >= data.width || range.maxRow >= data.height) return true;
  if (x1 < x0 || y1 < y0) return false;
  const cells = (x1 - x0 + 1) * (y1 - y0 + 1);
  const stride = Math.max(1, Math.ceil(Math.sqrt(cells / FOG_PROBES)));
  for (let y = y0; y <= y1; y += stride) {
    for (let x = x0; x <= x1; x += stride) {
      if ((data.bytes[(y * data.width + x) * 4 + 3]! & 15) === Ground.FOG) return true;
    }
  }
  return false;
};

/** The furthest distance into the fog (cells) the clouds' distance picture holds; deeper reads as this. */
export const FOG_DISTANCE_CAP = 15;

/**
 * Each cell's distance into the fog, in cells, for the painted fog's banks (`cloudShader.ts`): 0 for a
 * cell the player sees (anything but fog), 1 for a fog cell beside one, and so on up to
 * `FOG_DISTANCE_CAP`. Read from the ground's data (`GroundData`, ground in the low 4 bits of alpha)
 * into `out`, one byte a cell; a breadth-first walk out from the seen cells, so the cost follows the
 * seen land, not the world.
 */
export const fogDistances = (
  shape: Pick<CellShape, "kind">,
  data: Pick<GroundData, "bytes" | "width" | "height">,
  out: Uint8Array,
): void => {
  const { bytes, width, height } = data;
  out.fill(FOG_DISTANCE_CAP);
  let queue = new Int32Array(1024);
  let tail = 0;
  for (let index = 0; index < width * height; index++) {
    if ((bytes[index * 4 + 3]! & 15) === Ground.FOG) continue;
    out[index] = 0;
    if (tail === queue.length) {
      const grown = new Int32Array(queue.length * 2);
      grown.set(queue);
      queue = grown;
    }
    queue[tail++] = index;
  }
  let head = 0;
  while (head < tail) {
    const index = queue[head++]!;
    const next = out[index]! + 1;
    if (next >= FOG_DISTANCE_CAP) continue;
    const col = index % width;
    const row = (index - col) / width;
    const [q, r] = axialOfCell(shape as CellShape, col, row);
    for (let k = 1; k < NEIGHBOURS.length; k++) {
      const [dq, dr] = NEIGHBOURS[k]!;
      const [c, w] = offsetOfAxial(shape as CellShape, q + dq, r + dr);
      if (c < 0 || w < 0 || c >= width || w >= height) continue;
      const at = w * width + c;
      if (out[at]! <= next) continue;
      out[at] = next;
      if (tail === queue.length) {
        const grown = new Int32Array(queue.length * 2);
        grown.set(queue);
        queue = grown;
      }
      queue[tail++] = at;
    }
  }
};

/**
 * The smoothed distance into the fog round world point (x, y), in cells: the cells' distances
 * (`fogDistances`, read through `distanceAt`) weighed like `fogShare`. About 0.5 on the edge of
 * sight, rising about one per cell into the fog. The shader's `fogDepth`.
 */
export const fogDepth = (
  shape: CellShape,
  x: number,
  y: number,
  distanceAt: (col: number, row: number) => number,
  from?: { col: number; row: number },
): number => {
  const start = from ?? locateCell(shape, x, y);
  const [q0, r0] = axialOfCell(shape, start.col, start.row);
  const hx = x / shape.unitX;
  const hy = y / shape.unitY;
  const r2 = CLOUD_KERNEL_RADIUS * CLOUD_KERNEL_RADIUS;
  let sum = 0;
  let total = 0;
  for (const [dq, dr] of NEIGHBOURS) {
    const [cx, cy] = hexCentre(shape, q0 + dq, r0 + dr);
    const t = Math.max(0, 1 - ((hx - cx) ** 2 + (hy - cy) ** 2) / r2);
    const w = t * t;
    const [col, row] = offsetOfAxial(shape, q0 + dq, r0 + dr);
    sum += w * distanceAt(col, row);
    total += w;
  }
  return total > 0 ? sum / total : 0;
};

/**
 * The cloud picture's repeat on screen (`cloudShader.ts` `deckLevel`): about `DECK_PIXELS` screen
 * pixels across when zoomed out, so the far sea's heaps stay a steady size, but never fewer than
 * `DECK_MIN_CELLS` cells, so close up its biggest heaps (a third of it) are a cell or more across,
 * as Civ V's are, not pebbles on the land.
 */
export const DECK_PIXELS = 640;
export const DECK_MIN_CELLS = 4;

/**
 * log2 of the picture's repeat in cells at this zoom (a cell `cellPixels` pixels wide). The shader
 * draws the repeat at 2^floor and twice that, cross-fading by the fraction, so it never jumps.
 */
export const deckLevel = (cellPixels: number): number =>
  Math.log2(Math.max(DECK_PIXELS / Math.max(cellPixels, 1e-3), DECK_MIN_CELLS));
