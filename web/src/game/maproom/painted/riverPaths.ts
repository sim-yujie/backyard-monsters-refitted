import { HexGrid, mapRoomGrid, type OffsetCell, type Point } from "@/game/HexGrid";

/**
 * Map Room 2 rivers, the shapes (look plan step 7). Pure: no Pixi, so it is
 * tested on its own and the same paths can later go onto the painted ground.
 *
 * The server sends each land cell's `rv` (server `rivers.ts`): the river on
 * the cell's own three edges, the ones facing axial directions 0, 1 and 2,
 * two bits of width each. A river runs along the edges from hex corner to hex
 * corner, so here:
 *
 * 1. Every river edge in the asked range becomes two corners (a corner is
 *    the middle of the three cell centres around it, which is exactly the
 *    drawn hex corner on both shapes and at any cell size).
 * 2. Each edge is drawn as a curve through its two corners whose direction
 *    at a corner follows the river's edge on the far side of that corner
 *    (a Catmull-Rom curve), so the 60-degree turns of the hex edges become
 *    soft bends, plus a small bulge to one side picked by a hash of the edge.
 *    The river still passes through every hex corner on its way, so it
 *    stays in the band along the edges and never crosses a cell's middle.
 * 3. Edges join into paths, broken at junctions and ends; the width varies a
 *    little with the place, is narrow at a source and flares where the river
 *    meets the water.
 *
 * Everything depends only on the cells round each edge, never on the asked
 * range, so a river looks the same however the map is scrolled.
 */

/** A point on a river's centre line, with the water's half-width there. */
export interface RiverPoint {
  x: number;
  y: number;
  /** Half the water's width, in world pixels. */
  half: number;
  /**
   * How much of a river mouth this is, 0 to 1: 0 upstream, rising over the last edge to 1 where the
   * river meets the water, then falling back to 0 at the tip of the stretch that reaches into the
   * water. The painted ground widens the river into an estuary by it and fades it into the shallows.
   */
  mouth: number;
}

/** One stretch of river between junctions or ends. */
export interface RiverPath {
  points: RiverPoint[];
  /** The river meets water at the first or last point (and was flared there). */
  mouth: boolean;
  /** Points at the start and at the end that reach out into the water (no banks there). */
  wetStart: number;
  wetEnd: number;
  /**
   * Where the river steps down a cliff (indices into `points`): the hook for waterfalls. Empty while
   * the painted map lays every cell flat; the cliffs of look plan step 5 (feat/mr2-hills) will give
   * cells a lift, and a waterfall can then be drawn at each of these points.
   */
  falls: number[];
}

/** What the paths need to know about a cell. */
export interface RiverCells {
  /** The cell's `rv`, 0 for none, unknown or fog. */
  rvAt(col: number, row: number): number;
  /** Whether the cell is water (sea or lake). */
  isWater(col: number, row: number): boolean;
  /** How far the cell is drawn from its spot on the grid (`ground.ts` lift), 0 on flat ground. */
  liftOf?(col: number, row: number): number;
}

/** Half the water's width for river widths 1, 2, 3, as a share of the cell width. */
export const HALF_WIDTH_SHARE = [0, 0.05, 0.074, 0.1] as const;
/** How much the width wanders with the place (0.3 = up to 30% wider or narrower). */
const WIDTH_WANDER = 0.3;
/** The bulge to one side, at most this share of the edge's length, and the S-bend on top of it. */
const BULGE_SHARE = 0.11;
const S_BEND_SHARE = 0.07;
/** Points along each edge. */
const STEPS_PER_EDGE = 10;
/**
 * How far a mouth reaches on into the water, in cell widths (far enough to meet the painted coast
 * wherever its noise puts it; the painted ground fades it out), and how much wider it gets.
 */
const MOUTH_REACH = 0.9;
const MOUTH_FLARE = 2.6;
/** The river widens by this much over its last edge on land, into an estuary. */
const ESTUARY_FLARE = 1.6;
/** A source starts at this share of its width and reaches its full width over this many edges. */
const SOURCE_TAPER = 0.3;
const SOURCE_EDGES = 2;
/** A lift step between two corners bigger than this (world pixels) is a fall (the waterfall hook). */
const FALL_MIN = 0.5;

interface Corner {
  key: string;
  x: number;
  y: number;
  lift: number;
  water: boolean;
  links: { key: string; width: number }[];
}

/** A small string hash (FNV-1a), for the bulge. */
const hashOf = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** A smooth number from -1 to 1 that wanders with the world position. */
const wander = (x: number, y: number, cellWidth: number): number => {
  const u = x / cellWidth;
  const v = y / cellWidth;
  // A slow swell over a few cells and a quicker ripple, so the banks neither run parallel nor wobble.
  return (
    0.5 * Math.sin(u * 0.9 + v * 0.7) +
    0.3 * Math.sin(u * 2.1 + v * 1.3 + 0.4) +
    0.2 * Math.sin(u * -1.7 + v * 2.9 + 1.7)
  );
};

const cornerKey = (x: number, y: number): string => `${Math.round(x * 4)}:${Math.round(y * 4)}`;

/**
 * The river paths over the cells in a range (with a cell's margin read round
 * it, so curves at the range's edge are the same as when scrolled further).
 */
export const riverPaths = (
  range: { minCol: number; maxCol: number; minRow: number; maxRow: number },
  cells: RiverCells,
  grid: HexGrid = mapRoomGrid,
): RiverPath[] => {
  const corners = new Map<string, Corner>();
  const lift = (cell: OffsetCell) => cells.liftOf?.(cell.col, cell.row) ?? 0;

  /** Corner `k` of a cell: between its neighbours `k` and `k + 1`. */
  const cornerOf = (col: number, row: number, k: number): Corner => {
    const around = HexGrid.neighbours(col, row, grid.shape);
    const three: OffsetCell[] = [{ col, row }, around[k % 6]!, around[(k + 1) % 6]!];
    let x = 0;
    let y = 0;
    for (const one of three) {
      const centre = grid.cellToPixel(one.col, one.row);
      x += centre.x / 3;
      y += centre.y / 3;
    }
    const key = cornerKey(x, y);
    let corner = corners.get(key);
    if (!corner) {
      const water = three.some((one) => cells.isWater(one.col, one.row));
      // On raised tiles the river lies at the foot of the highest of its
      // land cells' sides: the lowest land around the corner.
      const lifts = three.filter((one) => !cells.isWater(one.col, one.row)).map(lift);
      corner = { key, x, y, lift: lifts.length > 0 ? Math.max(...lifts) : 0, water, links: [] };
      corners.set(key, corner);
    }
    return corner;
  };

  for (let col = range.minCol - 1; col <= range.maxCol + 1; col++) {
    for (let row = range.minRow - 1; row <= range.maxRow + 1; row++) {
      const rv = cells.rvAt(col, row);
      if (!rv) continue;
      for (let d = 0; d < 3; d++) {
        const width = (rv >> (2 * d)) & 3;
        if (width === 0) continue;
        // The edge facing neighbour d runs from corner d - 1 to corner d.
        const a = cornerOf(col, row, d + 5);
        const b = cornerOf(col, row, d);
        if (!a.links.some((link) => link.key === b.key)) a.links.push({ key: b.key, width });
        if (!b.links.some((link) => link.key === a.key)) b.links.push({ key: a.key, width });
      }
    }
  }

  const at = (key: string): Corner => corners.get(key)!;

  /** The corner beyond `corner`, coming from `from`: the straightest, then the widest, way on. */
  const beyond = (corner: Corner, from: Corner): Corner | null => {
    let best: { corner: Corner; width: number; turn: number } | null = null;
    const inX = corner.x - from.x;
    const inY = corner.y - from.y;
    for (const link of corner.links) {
      if (link.key === from.key) continue;
      const next = at(link.key);
      const turn = -((next.x - corner.x) * inX + (next.y - corner.y) * inY);
      if (
        !best ||
        turn < best.turn - 1e-6 ||
        (Math.abs(turn - best.turn) <= 1e-6 && (link.width > best.width || (link.width === best.width && link.key < best.corner.key)))
      ) {
        best = { corner: next, width: link.width, turn };
      }
    }
    return best?.corner ?? null;
  };

  const halfOf = (width: number) => HALF_WIDTH_SHARE[width]! * grid.cellWidth;
  const widthBetween = (a: Corner, b: Corner) => a.links.find((link) => link.key === b.key)?.width ?? 1;

  /** Half-width at a corner along a path from `a` to `b` (the mean of the path's edges there). */
  const halfAtCorner = (corner: Corner, other: Corner, beyondCorner: Corner | null): number => {
    const own = halfOf(widthBetween(corner, other));
    if (!beyondCorner) return own;
    return (own + halfOf(widthBetween(corner, beyondCorner))) / 2;
  };

  /** The curve from `a` to `b`, without its last point. */
  const edgeCurve = (a: Corner, b: Corner, out: RiverPoint[]): void => {
    const before = beyond(a, b);
    const after = beyond(b, a);
    const chordX = b.x - a.x;
    const chordY = b.y - a.y;
    const length = Math.hypot(chordX, chordY);
    const t0x = before ? (b.x - before.x) / 2 : chordX;
    const t0y = before ? (b.y - before.y) / 2 : chordY;
    const t1x = after ? (after.x - a.x) / 2 : chordX;
    const t1y = after ? (after.y - a.y) / 2 : chordY;
    const keys = [a.key, b.key].sort();
    // The side is fixed by the edge, not by which way the path walks it.
    const sign = a.key === keys[0] ? 1 : -1;
    const hash = hashOf(`${keys[0]}|${keys[1]}`);
    const bulge = sign * ((hash / 0xffffffff) * 2 - 1) * BULGE_SHARE * length;
    // An S-bend on top, its strength from another part of the hash; it keeps the ends' directions.
    // No sign: walking the edge the other way flips both the normal and cos(pi t), so it stays put.
    const sBend = ((((hash >>> 11) & 1023) / 1023) * 2 - 1) * S_BEND_SHARE * length;
    const nx = -chordY / length;
    const ny = chordX / length;
    const halfA = halfAtCorner(a, b, before);
    const halfB = halfAtCorner(b, a, after);
    for (let step = 0; step < STEPS_PER_EDGE; step++) {
      const t = step / STEPS_PER_EDGE;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      const side = Math.sin(Math.PI * t) ** 2 * (bulge + sBend * Math.cos(Math.PI * t));
      const x = h00 * a.x + h10 * t0x + h01 * b.x + h11 * t1x + nx * side;
      const y = h00 * a.y + h10 * t0y + h01 * b.y + h11 * t1y + ny * side + a.lift * (1 - t) + b.lift * t;
      const half = (halfA * (1 - t) + halfB * t) * (1 + WIDTH_WANDER * wander(x, y, grid.cellWidth));
      out.push({ x, y, half, mouth: 0 });
    }
  };

  const lastPoint = (corner: Corner, previous: Corner): RiverPoint => {
    const half = halfAtCorner(corner, previous, beyond(corner, previous));
    const y = corner.y + corner.lift;
    return { x: corner.x, y, half: half * (1 + WIDTH_WANDER * wander(corner.x, y, grid.cellWidth)), mouth: 0 };
  };

  /** Paths break at ends, junctions and the water. */
  const stops = (corner: Corner) => corner.links.length !== 2 || corner.water;

  // Walk paths: from every end or junction, along corners with two links.
  const done = new Set<string>();
  const edgeKey = (a: Corner, b: Corner) => (a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`);
  const paths: RiverPath[] = [];
  const walk = (start: Corner, first: Corner): void => {
    const points: RiverPoint[] = [];
    const falls: number[] = [];
    let from = start;
    let to = first;
    for (;;) {
      done.add(edgeKey(from, to));
      if (Math.abs(from.lift - to.lift) > FALL_MIN) falls.push(points.length + STEPS_PER_EDGE / 2);
      edgeCurve(from, to, points);
      if (stops(to)) break;
      const onward = at(to.links[0]!.key === from.key ? to.links[1]!.key : to.links[0]!.key);
      if (done.has(edgeKey(to, onward))) break;
      from = to;
      to = onward;
    }
    points.push(lastPoint(to, from));
    // Both ends, always (a path can have a mouth at one end and a source at the other).
    const wetStart = finishEnd(points, start, true);
    const wetEnd = finishEnd(points, to, false);
    paths.push({ points, mouth: wetStart + wetEnd > 0, wetStart, wetEnd, falls: falls.map((index) => index + wetStart) });
  };

  /** Flares a mouth into the water or narrows a source; returns the points added in the water. */
  const finishEnd = (points: RiverPoint[], corner: Corner, atStart: boolean): number => {
    if (points.length < 2 || (!corner.water && corner.links.length !== 1)) return 0;
    const end = atStart ? points[0]! : points[points.length - 1]!;
    const inner = atStart ? points[1]! : points[points.length - 2]!;
    if (corner.water) {
      // The last edge on land widens into an estuary and turns into a mouth.
      const land = Math.min(STEPS_PER_EDGE + 1, points.length);
      for (let i = 0; i < land; i++) {
        const point = atStart ? points[i]! : points[points.length - 1 - i]!;
        const share = 1 - i / (land - 1 || 1);
        const ease = share * share * (3 - 2 * share);
        point.half *= 1 + (ESTUARY_FLARE - 1) * ease;
        point.mouth = Math.max(point.mouth, ease);
      }
      const dx = end.x - inner.x;
      const dy = end.y - inner.y;
      const step = Math.hypot(dx, dy) || 1;
      const reach = MOUTH_REACH * grid.cellWidth;
      const extra: RiverPoint[] = [];
      const count = 6;
      for (let i = 1; i <= count; i++) {
        const share = i / count;
        extra.push({
          x: end.x + (dx / step) * reach * share,
          y: end.y + (dy / step) * reach * share,
          half: end.half * (1 + (MOUTH_FLARE / ESTUARY_FLARE - 1) * share),
          mouth: 1 - share,
        });
      }
      if (atStart) points.unshift(...extra.reverse());
      else points.push(...extra);
      return count;
    }
    // A source: narrow over the first edges, easing into the full width.
    const count = Math.min(STEPS_PER_EDGE * SOURCE_EDGES, points.length);
    for (let i = 0; i < count; i++) {
      const point = atStart ? points[i]! : points[points.length - 1 - i]!;
      const share = i / count;
      point.half *= SOURCE_TAPER + (1 - SOURCE_TAPER) * Math.sqrt(share);
    }
    return 0;
  };

  const ordered = [...corners.values()].sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
  for (const corner of ordered) {
    if (!stops(corner)) continue;
    for (const link of corner.links) {
      const next = at(link.key);
      if (!done.has(edgeKey(corner, next))) walk(corner, next);
    }
  }
  // Loops (only ever a window's worth of a river bending round): any edge left.
  for (const corner of ordered) {
    for (const link of corner.links) {
      const next = at(link.key);
      if (!done.has(edgeKey(corner, next))) walk(corner, next);
    }
  }
  return paths;
};

/**
 * The outline of a river path as a closed polygon `[x, y, ...]`, `extra`
 * world pixels wider each side than the water (the banks), times `scale`.
 */
export const ribbonOutline = (points: readonly RiverPoint[], extra = 0, scale = 1): number[] => {
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const before = points[Math.max(0, i - 1)]!;
    const after = points[Math.min(points.length - 1, i + 1)]!;
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const half = points[i]!.half * scale + extra;
    left.push(points[i]!.x + nx * half, points[i]!.y + ny * half);
    right.push(points[i]!.x - nx * half, points[i]!.y - ny * half);
  }
  const outline = left;
  for (let i = right.length - 2; i >= 0; i -= 2) outline.push(right[i]!, right[i + 1]!);
  return outline;
};

/** The corners of a path (its ends), for round caps where paths meet. */
export const pathEnds = (path: RiverPath): Point[] => [path.points[0]!, path.points[path.points.length - 1]!];
