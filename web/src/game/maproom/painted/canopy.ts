import type { Quality } from "@/game/quality";

/**
 * Forests, rock fields and goo marsh on the painted ground (Map Room 2 Modern look, plan step 6):
 * the numbers the shader (`canopyShader.ts`) uses, and the TypeScript twin of its rules for the tests.
 *
 * Each feature has a smooth share round every point: the cells round it (the point's own and its six
 * neighbours) weighed by a bump that fades to nothing two hex units out, like the hills' height field,
 * so the share is 1 deep in a feature's land, about a half on the side between a feature cell and open
 * ground, and 0 a cell away. Fog and cells not loaded yet count for nothing either way.
 *
 * - **Forest**: one solid canopy wherever the forest's share passes a half, its edge pushed about by a
 *   slow noise and scalloped by rounded crowns ({@link CROWN_BUMP}), so it runs across the hex sides as
 *   one mass. It stops short of the sea and the rivers, and opens a small round clearing round a camp,
 *   yard or outpost on a forest cell. Single trees stand only along its outer edge (and a few more
 *   thinning out into the meadow); a few pines poke up out of it.
 * - **Rocks**: the rocky ground is laid over the cell's own ground by its share, faded through a wide
 *   soft band so it melts into the meadow, with boulders standing on it, thinning out towards its edges.
 * - **Marsh** (mr2-marsh, mock-up B): wet mossy banks fade in the same way, and inside them most of the
 *   ground is shallow dark-green water, with glowing goo pools, tall cattail clumps, lily pads, a log
 *   and wet rocks; a camp on a marsh cell keeps a mossy island.
 */

/** The radius (regular-hex units, corner radius 1) of each cell's bump in the features' shares. */
export const FEATURE_RADIUS = 2;

/** The canopy's edge, as the forest's share: it covers where the share (plus its wander) passes this. */
export const CANOPY_SHARE = 0.5;

/**
 * How far the slow noise pushes the canopy's edge (share units, either way) and how much the rounded
 * crowns scallop it (share units, from a crown's top to the gap between two).
 */
export const EDGE_WANDER = 0.09;
export const CROWN_BUMP = 0.14;
/** The crowns' grid (hex units): about one rounded treetop each, the canopy texture's size. */
export const CROWN_GRID = 0.27;

/**
 * A camp, yard or outpost on a forest cell stands in a small clearing: no canopy within
 * {@link CLEARING_INNER} hex units of the cell's middle, fading back in by {@link CLEARING_OUTER}.
 * Kept small (the camp picture and its level circle take about 0.45 and overlap the canopy's rim) so
 * a forest of camps still reads as one canopy, not a ring round every camp (owner, first look).
 */
export const CLEARING_INNER = 0.28;
export const CLEARING_OUTER = 0.46;
/** How strongly the clearing pushes the canopy back (share units): more than any wander can undo. */
export const CLEARING_CUT = 1.2;

/**
 * The canopy keeps off the beach: it pulls back where the water's share round a point passes
 * {@link SHORE_START} (the beach begins at about 0.035-0.15) and is gone by {@link SHORE_END}.
 */
export const SHORE_START = 0.005;
export const SHORE_END = 0.05;
export const SHORE_CUT = 1.0;

/**
 * Rocky ground and marsh mud fade in over this band of their share (wide, so they melt into the
 * meadow). The marsh starts later than the rocks, so it stays inside its own cells and the next cell
 * only gets a soft wet fringe (it spread as one big dark area near the coast at first).
 */
export const ROCK_FADE: readonly [number, number] = [0.3, 0.72];
export const MARSH_FADE: readonly [number, number] = [0.45, 0.85];

/**
 * The marsh's water (mr2-marsh, mock-up B): most of a marsh is shallow dark-green water, with wet
 * mossy banks and islands between. Water covers where a smooth noise ({@link MARSH_WATER_SCALE} per hex
 * unit, about 0.2..0.8) passes a level that falls with how deep into the marsh a point is: the first
 * level at its fading edge (a few puddles), the second well inside (mostly water).
 */
export const MARSH_WATER_SCALE = 1.4;
export const MARSH_WATER_LEVEL: readonly [number, number] = [0.68, 0.4];
/**
 * A camp, yard or outpost on a marsh cell stands on a mossy island: the water level is raised by
 * {@link ISLET_LIFT} within {@link ISLET_INNER} hex units of the cell's middle, fading by {@link ISLET_OUTER}.
 */
export const ISLET_INNER = 0.3;
export const ISLET_OUTER = 0.6;
export const ISLET_LIFT = 0.6;

/**
 * The marsh's glowing goo pools (mock-up B: a couple of wide rounded lime pools in a marsh, each with a
 * soft glow and faint rings on the water round it). One jittered spot on a {@link GOO_GRID} grid (hex
 * units); a spot holds a pool when its roll is under {@link GOO_CHANCE} and it lies well inside the
 * marsh. A pool is a main oval and two smaller ovals overlapping it (one rounded blob, no thin tails).
 */
export const GOO_GRID = 1.4;
export const GOO_CHANCE = 0.55;
/** The main oval's half-width (hex units) and its height against its width (the camera looks down at a slant). */
export const GOO_SIZE: readonly [number, number] = [0.2, 0.34];
export const GOO_FLAT = 0.55;
/** How deep into the marsh (0..1) a pool's middle must be. */
export const GOO_DEEP = 0.6;

/** One oval of a goo pool: its middle (hex units, from the grid square's corner) and half-axes. */
export interface GooLobe {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
}

/**
 * The ovals of the goo pool in one grid square, from five rolls 0..1 (the shader's hashes); the shader's
 * `gooPool` twin. The pool stays inside its own square, so the shader only reads the pixel's square.
 */
export const gooPool = (rolls: readonly [number, number, number, number, number]): GooLobe[] => {
  const [a, b, c, d, e] = rolls;
  const rx = GOO_SIZE[0] + (GOO_SIZE[1] - GOO_SIZE[0]) * a;
  const ry = rx * GOO_FLAT;
  const reach = 1.5 * rx; // the farthest a side oval's edge gets from the middle
  const room = Math.max(0, GOO_GRID / 2 - reach);
  const cx = GOO_GRID / 2 + room * (2 * b - 1);
  const cy = GOO_GRID / 2 + room * (2 * c - 1) * 0.6;
  const turn = d * Math.PI * 2;
  const lobes: GooLobe[] = [{ x: cx, y: cy, rx, ry }];
  for (const side of [0, Math.PI * (0.75 + 0.5 * e)]) {
    const angle = turn + side;
    const r = rx * (0.55 + 0.15 * Math.cos(angle * 3));
    lobes.push({
      x: cx + Math.cos(angle) * rx * 0.75,
      y: cy + Math.sin(angle) * ry * 0.75,
      rx: r,
      ry: r * GOO_FLAT,
    });
  }
  return lobes;
};

/**
 * The marsh's pieces (mr2-marsh): tall cattail clumps, reed tufts, lily pads, a log and wet rocks on
 * their own jittered grid ({@link MARSH_GRID} of a cell's width), larger than the forest's (mock-up B's
 * cattail clumps are about a third of a cell tall). Shares of the grid squares (on High) by kind.
 */
export const MARSH_GRID = 0.19;
export const MARSH_PIECES = { reeds: 0.34, lilies: 0.12, rocks: 0.06, log: 0.012 } as const;

/**
 * Edge trees, pines, boulders, goo pools and reeds: the share of their grid squares kept at each
 * Quality (plan section 5's budget: about 600 / 300 / 120 a chunk of 100 cells).
 */
export const FEATURE_DENSITY: Record<Quality, number> = { high: 1, medium: 0.5, low: 0.2 };

/**
 * The sprite sheet's rows (the shader's one sheet, 4 frames a row, `PaintedGround.loadSprites`): ground
 * details (3 rows), sea rocks (2), then this step's forest pieces (2: round trees, pines) and marsh and
 * rocks (4: boulders, then the marsh's six tall cattail clumps, a reed tuft, a low reed clump, two lily
 * pad clusters, a log and a wet rock). Frame numbers count row by row.
 */
export const SPRITE_SHEET_ROWS = { decals: 3, seaRocks: 2, forest: 2, marshRocks: 4 } as const;
export const SPRITE_ROWS = Object.values(SPRITE_SHEET_ROWS).reduce((sum, rows) => sum + rows, 0);
export const TREE_FRAME = 4 * (SPRITE_SHEET_ROWS.decals + SPRITE_SHEET_ROWS.seaRocks);
export const PINE_FRAME = TREE_FRAME + 4;
export const BOULDER_FRAME = TREE_FRAME + 4 * SPRITE_SHEET_ROWS.forest;
/** The six tall cattail clumps. */
export const CATTAIL_FRAME = BOULDER_FRAME + 4;
export const REED_TUFT_FRAME = CATTAIL_FRAME + 6;
export const LOW_REEDS_FRAME = CATTAIL_FRAME + 7;
/** Two lily pad clusters (a big one and a small one). */
export const LILY_FRAME = CATTAIL_FRAME + 8;
export const LOG_FRAME = CATTAIL_FRAME + 10;
export const WET_ROCK_FRAME = CATTAIL_FRAME + 11;

/** One cell round a point, for {@link featureShares}: its centre (hex units) and what it holds. */
export interface FeatureCell {
  readonly x: number;
  readonly y: number;
  /** The land feature (`lf`), 0 for none. */
  readonly feature: number;
  readonly water?: boolean;
  /** Fog or not loaded yet: counts for nothing. */
  readonly hidden?: boolean;
  /** A camp, yard or outpost picture stands in its middle. */
  readonly occupied?: boolean;
}

export interface FeatureShares {
  readonly forest: number;
  readonly rocks: number;
  readonly marsh: number;
  readonly water: number;
  /** How much of a forest clearing (0..1) this point is in. */
  readonly clearing: number;
  /** How much of a marsh camp's mossy island (0..1) this point is on. */
  readonly islet: number;
}

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** The features' smooth shares at (x, y), hex units, from the cells round it (the shader's `featuresNear`). */
export const featureShares = (cells: readonly FeatureCell[], x: number, y: number): FeatureShares => {
  const r2max = FEATURE_RADIUS * FEATURE_RADIUS;
  let sum = 0;
  let forest = 0;
  let rocks = 0;
  let marsh = 0;
  let water = 0;
  let clearing = 0;
  let islet = 0;
  for (const cell of cells) {
    const dx = x - cell.x;
    const dy = y - cell.y;
    const r2 = (dx * dx + dy * dy) / r2max;
    if (r2 >= 1 || cell.hidden) continue;
    const u = 1 - r2;
    const w = u * u * u;
    sum += w;
    if (cell.water) {
      water += w;
      continue;
    }
    if (cell.feature === 1) forest += w;
    else if (cell.feature === 2) rocks += w;
    else if (cell.feature === 3) marsh += w;
    if (cell.feature === 1 && cell.occupied) {
      clearing = Math.max(clearing, 1 - smoothstep(CLEARING_INNER, CLEARING_OUTER, Math.hypot(dx, dy)));
    }
    if (cell.feature === 3 && cell.occupied) {
      islet = Math.max(islet, 1 - smoothstep(ISLET_INNER, ISLET_OUTER, Math.hypot(dx, dy)));
    }
  }
  if (sum < 1e-4) return { forest: 0, rocks: 0, marsh: 0, water: 0, clearing: 0, islet: 0 };
  return { forest: forest / sum, rocks: rocks / sum, marsh: marsh / sum, water: water / sum, clearing, islet };
};

/**
 * The level the marsh's water noise must pass at a point (the shader's `marshWet`): lower deep in the
 * marsh (more water), raised on a camp's island; deep is 0 at the marsh's fading edge, 1 well inside.
 */
export const marshWaterLevel = (deep: number, islet: number): number =>
  MARSH_WATER_LEVEL[0] + (MARSH_WATER_LEVEL[1] - MARSH_WATER_LEVEL[0]) * deep + ISLET_LIFT * islet;

/**
 * The canopy's edge value before its noise (the shader adds a wander of at most
 * {@link canopyNoiseReach} either way): above 0 is canopy.
 */
export const canopyEdge = (shares: FeatureShares): number =>
  shares.forest -
  CANOPY_SHARE -
  CLEARING_CUT * shares.clearing -
  SHORE_CUT * smoothstep(SHORE_START, SHORE_END, shares.water);

/** The most the edge's noise and crowns can move {@link canopyEdge} either way. */
export const canopyNoiseReach = EDGE_WANDER + CROWN_BUMP / 2;

/** Whether a point is surely canopy, surely open, or on the edge where the noise decides. */
export const canopyAt = (shares: FeatureShares): "canopy" | "open" | "edge" => {
  const edge = canopyEdge(shares);
  if (edge > canopyNoiseReach) return "canopy";
  if (edge < -canopyNoiseReach) return "open";
  return "edge";
};
