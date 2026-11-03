import { Terrain } from "../../../enums/MapRoom.js";
import { mr2HexShape, mr2RiversEnabled } from "../../../config/MapRoom2Config.js";
import { MAP_HEIGHT, MAP_WIDTH, axialQ, axialR, type HexShape } from "../../../game-rules/maproom/range.js";
import { generateNoise, getTerrainHeight } from "./generateMap.js";
import { cellHash } from "./landFeature.js";

/**
 * Map Room 2's rivers (`docs/mr2-modern-look-plan.md` step 7). Look only:
 * nothing in the game reads them but the map's drawing.
 *
 * Rivers run along cell EDGES, never through a cell. The network is worked
 * out once per world and hex shape from the world's height noise (the same
 * `getTerrainHeight` the map and the attack load use) and a hash of the
 * world id, so every server draws the same rivers forever, with no database
 * column. It is kept in memory (one byte per cell, 640 kB a world).
 *
 * How it is built:
 * 1. Corners. Every corner of the hex grid touches three cells; its height
 *    is their sum. A corner touching a water cell is "at the water".
 * 2. Drainage. A breadth-first walk from every corner at the water, moving
 *    only to corners as high or higher, finds every corner that can reach
 *    the water without going uphill, and how many steps that takes. Corners
 *    in a closed hollow are never reached: no river starts there.
 * 3. Downhill. From a corner a river always takes the lowest neighbouring
 *    corner that drains, never higher; on level ground the one nearer the
 *    water. So a river only ever goes down or level and always ends at water.
 * 4. Sources. High corners (the top part of the land) picked by the world's
 *    hash, highest first, at least `SOURCE_SPACING` corner steps from any
 *    river already made; a river shorter than `MIN_RIVER_EDGES` is dropped.
 *    A river reaching another river stops there (a tributary).
 * 5. Width. Each river edge counts the river edges upstream of it, itself
 *    included: up to 8 is a stream (1), up to 24 a river (2), more a wide
 *    river (3).
 *
 * What the map receives (`rv` on each land cell): the cell's own three edges,
 * the ones facing axial directions 0, 1 and 2 (`AXIAL_DIRECTIONS` in
 * `game-rules/maproom/range.ts`: east, north-east, north-west), two bits
 * each, `width << (2 * direction)`. The other three edges of a cell are its
 * neighbours' own. A river edge always lies between two land cells, so water
 * cells never carry one.
 */

/** Added to the world id to seed the river hash, so it never moves with other hashes. */
export const RIVER_SEED_SUFFIX = "#river";

/** A source corner's three cells average at least this height (land is 100 to about 190). */
export const SOURCE_MIN_HEIGHT = 150;
/** Share of high corners the hash offers as a source (most are then too near a river). */
export const SOURCE_SHARE = 0.02;
/** A new source is at least this many corner steps from every river already made. */
export const SOURCE_SPACING = 7;
/** A river with fewer edges than this, before it reaches water or another river, is dropped. */
export const MIN_RIVER_EDGES = 6;
/** Edges upstream (itself included) up to which a river edge is a stream, then a river. */
export const STREAM_MAX_FLOW = 8;
export const RIVER_MAX_FLOW = 24;

const W = MAP_WIDTH;
const H = MAP_HEIGHT;
const CELLS = W * H;
const CORNERS = CELLS * 2;

const DQ = [1, 1, 0, -1, -1, 0] as const;
const DR = [0, -1, -1, 0, 1, 1] as const;

const wrap = (value: number, size: number): number => ((value % size) + size) % size;

/**
 * Offset steps to the six neighbours, by the parity that shifts them: the row
 * on pointy-top (odd-r), the column on flat-top (odd-q). Worked out from the
 * axial conversion in `range.ts`, so it cannot disagree with `hexNeighbours`.
 */
const offsetSteps = (shape: HexShape): number[][][] =>
  [0, 1].map((parity) => {
    const x = parity;
    const y = parity;
    const q = axialQ(x, y, shape);
    const r = axialR(x, y, shape);
    return DQ.map((dq, d) => {
      const nq = q + dq;
      const nr = r + DR[d]!;
      const nx = shape === "pointy" ? nq + (nr - (nr & 1)) / 2 : nq;
      const ny = shape === "pointy" ? nr : nr + (nq - (nq & 1)) / 2;
      return [nx - x, ny - y];
    });
  });

const STEPS: Record<HexShape, number[][][]> = { flat: offsetSteps("flat"), pointy: offsetSteps("pointy") };

/** Index of the cell one step from `(x, y)` in axial direction `d`, wrapped into the world. */
const stepCell = (x: number, y: number, d: number, shape: HexShape): number => {
  const [dx, dy] = STEPS[shape][shape === "pointy" ? y & 1 : x & 1]![d]!;
  return wrap(y + dy!, H) * W + wrap(x + dx!, W);
};

/** Index of the cell one step from cell `index` in direction `d`. */
export const neighbourIndex = (index: number, d: number, shape: HexShape): number =>
  stepCell(index % W, Math.floor(index / W), d, shape);

/**
 * The corner graph, shape aware.
 *
 * Corner `k` of a cell lies between its neighbours in directions `k` and
 * `k + 1`. Each corner touches three cells and has three names; it is kept
 * under the one where `k` is 0 or 1: id `cell * 2 + k`. Corner 0 touches the
 * cell and its neighbours 0 and 1; corner 1 the cell and its neighbours 1
 * and 2. An edge is `cell * 3 + d` for the cell's own directions 0..2.
 */
export const cornerCells = (corner: number, shape: HexShape): [number, number, number] => {
  const cell = corner >> 1;
  const k = corner & 1;
  return [cell, neighbourIndex(cell, k, shape), neighbourIndex(cell, k + 1, shape)];
};

/**
 * Writes the three corners joined to `corner` by an edge into `corners`, and
 * the edge to each into `edges`.
 */
export const cornerLinks = (corner: number, shape: HexShape, corners: number[], edges: number[]): void => {
  const cell = corner >> 1;
  if ((corner & 1) === 0) {
    // Corner 0: back round the cell to corner 5 (= neighbour 5's corner 1),
    // on to corner 1, and out along the edge between neighbours 0 and 1.
    const n0 = neighbourIndex(cell, 0, shape);
    corners[0] = neighbourIndex(cell, 5, shape) * 2 + 1;
    edges[0] = cell * 3;
    corners[1] = cell * 2 + 1;
    edges[1] = cell * 3 + 1;
    corners[2] = n0 * 2 + 1;
    edges[2] = n0 * 3 + 2;
    return;
  }
  // Corner 1: back to corner 0, on to corner 2 (= neighbour 3's corner 0), and
  // out along the edge between neighbours 1 and 2 (neighbour 2's own edge 0).
  const n2 = neighbourIndex(cell, 2, shape);
  corners[0] = cell * 2;
  edges[0] = cell * 3 + 1;
  corners[1] = neighbourIndex(cell, 3, shape) * 2;
  edges[1] = cell * 3 + 2;
  corners[2] = n2 * 2;
  edges[2] = n2 * 3;
};

/** A world's river network, with what the tests check it by. */
export interface RiverNetwork {
  readonly shape: HexShape;
  /** Each cell's `rv`: its own three edges, two bits of width each. */
  readonly rv: Uint8Array;
  /** The corner each river corner flows to, or -1 off the rivers (and at the water). */
  readonly next: Int32Array;
  /** Each corner's height: the sum of its three cells' heights. */
  readonly elevation: Int16Array;
  /** 1 where a corner touches a water cell. */
  readonly water: Uint8Array;
  /** Where each river starts. */
  readonly sources: number[];
}

/** A 32-bit mix of a number (from murmur3's finaliser). */
const mix = (value: number): number => {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
};

/** The numbers that set how many rivers a world gets (tests and tuning may change them). */
export interface RiverTuning {
  minHeight: number;
  share: number;
  spacing: number;
  minEdges: number;
}

const DEFAULT_TUNING: RiverTuning = {
  minHeight: SOURCE_MIN_HEIGHT,
  share: SOURCE_SHARE,
  spacing: SOURCE_SPACING,
  minEdges: MIN_RIVER_EDGES,
};

const widthOf = (flow: number): number => {
  if (flow <= STREAM_MAX_FLOW) return 1;
  return flow <= RIVER_MAX_FLOW ? 2 : 3;
};

/**
 * Builds a world's river network from scratch (about a third of a second).
 * {@link riverNetwork} keeps the result.
 *
 * @param worldid - The world, whose id seeds the height noise and the hash.
 * @param shape - The world's hex shape.
 */
export const buildRiverNetwork = (worldid: string, shape: HexShape, tuning: Partial<RiverTuning> = {}): RiverNetwork => {
  const { minHeight, share, spacing, minEdges } = { ...DEFAULT_TUNING, ...tuning };
  const noise = generateNoise(worldid);
  const height = new Int16Array(CELLS);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) height[y * W + x] = getTerrainHeight(noise, x, y);
  }

  const elevation = new Int16Array(CORNERS);
  const water = new Uint8Array(CORNERS);
  for (let corner = 0; corner < CORNERS; corner++) {
    const [a, b, c] = cornerCells(corner, shape);
    elevation[corner] = height[a]! + height[b]! + height[c]!;
    if (height[a]! <= Terrain.WATER3 || height[b]! <= Terrain.WATER3 || height[c]! <= Terrain.WATER3) {
      water[corner] = 1;
    }
  }

  // 2. Drainage: steps to the water along a never-rising path, -1 for hollows.
  const steps = new Int32Array(CORNERS).fill(-1);
  const queue = new Int32Array(CORNERS);
  let head = 0;
  let tail = 0;
  for (let corner = 0; corner < CORNERS; corner++) {
    if (water[corner]) {
      steps[corner] = 0;
      queue[tail++] = corner;
    }
  }
  const links = [0, 0, 0];
  const edges = [0, 0, 0];
  while (head < tail) {
    const from = queue[head++]!;
    cornerLinks(from, shape, links, edges);
    for (const to of links) {
      if (steps[to] !== -1 || water[to] || elevation[to]! < elevation[from]!) continue;
      steps[to] = steps[from]! + 1;
      queue[tail++] = to;
    }
  }

  // 3. Downhill: the lowest draining neighbour, never higher; level only nearer the water.
  const downhill = (corner: number): { to: number; edge: number } => {
    cornerLinks(corner, shape, links, edges);
    let best = -1;
    let bestEdge = -1;
    for (let i = 0; i < 3; i++) {
      const to = links[i]!;
      if (steps[to] === -1 || elevation[to]! > elevation[corner]!) continue;
      if (elevation[to] === elevation[corner] && steps[to]! >= steps[corner]!) continue;
      if (
        best === -1 ||
        elevation[to]! < elevation[best]! ||
        (elevation[to] === elevation[best] && (steps[to]! < steps[best]! || (steps[to] === steps[best] && to < best)))
      ) {
        best = to;
        bestEdge = edges[i]!;
      }
    }
    return { to: best, edge: bestEdge };
  };

  // 4. Sources, highest first.
  const seed = cellHash(`${worldid}${RIVER_SEED_SUFFIX}`, 0, 0);
  const shareLimit = Math.floor(share * 0x1_0000_0000);
  const minElevation = minHeight * 3;
  const candidates: { corner: number; rank: number }[] = [];
  for (let corner = 0; corner < CORNERS; corner++) {
    if (water[corner] || steps[corner]! <= 0 || elevation[corner]! < minElevation) continue;
    const rank = mix(seed ^ Math.imul(corner + 1, 0x9e3779b1));
    if (rank < shareLimit) candidates.push({ corner, rank });
  }
  candidates.sort((a, b) => elevation[b.corner]! - elevation[a.corner]! || a.rank - b.rank);

  const next = new Int32Array(CORNERS).fill(-1);
  const nextEdge = new Int32Array(CORNERS).fill(-1);
  const onRiver = new Uint8Array(CORNERS);
  /** Steps to the nearest river corner, up to the spacing (255 = farther). */
  const near = new Uint8Array(CORNERS).fill(255);
  const sources: number[] = [];
  const path: number[] = [];
  const pathEdges: number[] = [];
  const spread: number[] = [];

  for (const { corner: source } of candidates) {
    if (near[source]! <= spacing) continue;
    path.length = 0;
    pathEdges.length = 0;
    let at = source;
    path.push(at);
    while (!water[at] && !onRiver[at]) {
      const step = downhill(at);
      at = step.to;
      path.push(at);
      pathEdges.push(step.edge);
    }
    if (pathEdges.length < minEdges) continue;

    sources.push(source);
    spread.length = 0;
    for (let i = 0; i < pathEdges.length; i++) {
      const corner = path[i]!;
      onRiver[corner] = 1;
      next[corner] = path[i + 1]!;
      nextEdge[corner] = pathEdges[i]!;
      near[corner] = 0;
      spread.push(corner);
    }
    // Keep later sources away from this river.
    for (let i = 0; i < spread.length; i++) {
      const from = spread[i]!;
      const distance = near[from]!;
      if (distance >= spacing) continue;
      cornerLinks(from, shape, links, edges);
      for (const to of links) {
        if (near[to]! <= distance + 1) continue;
        near[to] = distance + 1;
        spread.push(to);
      }
    }
  }

  // 5. Width: upstream first (a river corner flows to a lower one, or a level one nearer the water).
  const riverCorners: number[] = [];
  for (let corner = 0; corner < CORNERS; corner++) if (next[corner] !== -1) riverCorners.push(corner);
  riverCorners.sort((a, b) => elevation[b]! - elevation[a]! || steps[b]! - steps[a]!);
  const flow = new Int32Array(CORNERS);
  const rv = new Uint8Array(CELLS);
  for (const corner of riverCorners) {
    const through = flow[corner]! + 1;
    flow[next[corner]!] += through;
    const edge = nextEdge[corner]!;
    const cell = Math.floor(edge / 3);
    const shift = 2 * (edge % 3);
    const width = Math.max(widthOf(through), (rv[cell]! >> shift) & 3);
    rv[cell] = (rv[cell]! & ~(3 << shift)) | (width << shift);
  }

  return { shape, rv, next, elevation, water, sources };
};

const networks = new Map<string, RiverNetwork>();
/** Worlds kept at once; a server runs one or two, tests a few more. */
const MAX_KEPT = 4;

/** A world's river network, built on first use and kept. */
export const riverNetwork = (worldid: string, shape: HexShape): RiverNetwork => {
  const key = `${worldid}|${shape}`;
  let network = networks.get(key);
  if (!network) {
    network = buildRiverNetwork(worldid, shape);
    if (networks.size >= MAX_KEPT) networks.delete(networks.keys().next().value!);
    networks.set(key, network);
  }
  return network;
};

/**
 * The `rv` of the cell at `(x, y)` with height `height`, with the switch on
 * (0 with it off, on water, or with no river on the cell's own edges).
 */
export const activeRiverEdges = (worldid: string, x: number, y: number, height: number): number => {
  if (!mr2RiversEnabled() || !(height > Terrain.WATER3)) return 0;
  if (x < 0 || y < 0 || x >= W || y >= H) return 0;
  return riverNetwork(worldid, mr2HexShape()).rv[y * W + x]!;
};
