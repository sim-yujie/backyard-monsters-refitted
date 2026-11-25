import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";

/**
 * Map pin clustering on Map Room 2 (beta 9, owner's option C, 25 Nov 2026): which cells merge into
 * what, worked out on the world grid. Pure: cells and a zoom in, tokens and the cells they stand
 * for out. `clusterLayout.ts` then places the tokens on the screen and `ClusterLayer.ts` draws them.
 *
 * Below {@link CLUSTER_ZOOM} (default play zoom 0.6 is untouched):
 *  - alliance-mates' and neutral players' cells merge into low numbered plaques, counted on a fixed
 *    world grid whose squares are a power of two cells wide (so plaques do not swim while panning,
 *    and a zoom step changes them only when the square size changes);
 *  - every one of the viewer's own outposts gets a cyan crest and every hostile player's cell a red
 *    crest, never merged (below {@link LONE_CREST_ZOOM}; from there up to {@link CLUSTER_ZOOM} their
 *    real markers show, as hexes are big enough to read them);
 *  - the viewer's main yard is a gold-trimmed home crest, never merged;
 *  - friends and pinned friends keep their own markers.
 * The cells a token stands for have their markers hidden (`MarkerPins`), so they cost nothing to
 * place, and (lead default) their relation borders go too. Wild monster camps go by layer below
 * {@link CAMPS_SHOWN_FROM} (`lod.ts`).
 */

/** Below this zoom tokens replace markers; at or above it the map is exactly as before. */
export const CLUSTER_ZOOM = 0.5;

/**
 * Wild monster camps' markers (tents, portraits, health bars) are left out below this zoom. Lead
 * default 25 Nov (neon): 0.42, so camp hunters still see them just below play zoom; the owner had
 * asked for the plaque zoom ({@link CLUSTER_ZOOM}), a one-line change here.
 */
export const CAMPS_SHOWN_FROM = 0.42;

/**
 * Whether the relation borders of the cells a plaque stands for are left out too (lead default 25
 * Nov, for the owner: the empty outlines of merged outposts read as clutter, or as camps).
 */
export const HIDE_BORDERS_UNDER_PLAQUES = true;

/** Below this zoom every own and hostile outpost wears a crest; from it up, its real marker. */
export const LONE_CREST_ZOOM = 0.36;

/** From this zoom plaques need three cells and cover smaller squares: only real crowds merge. */
export const NEAR_ZOOM = 0.32;

/** At or below this zoom crests are drawn smaller (far view). */
export const FAR_ZOOM = 0.18;

/**
 * What tapping a lone own or hostile crest does when zoomed out. Lead default 25 Nov (neon): open
 * that outpost's info, as at play zoom ("a count zooms in, a single target opens info"); the owner
 * had asked for zooming in like a plaque, a one-line change here.
 */
export const LONE_CREST_TAP: "zoom" | "info" = "info";

/** Who a cell belongs to, as the clustering sees it. */
export type ClusterGroup = "home" | "you" | "hostile" | "alliance" | "other";

/** Drawn on top of each other in this order (later on top), and pushed apart in reverse. */
export const STACK_ORDER: readonly ClusterGroup[] = ["other", "alliance", "you", "hostile", "home"];

/** One cell that can be clustered: a player's cell, bright under the kit filter. */
export interface ClusterCell {
  /** `row * WORLD_WIDTH + col`. */
  readonly key: number;
  /** Where its markers stand, map pixels. */
  readonly wx: number;
  readonly wy: number;
  readonly group: ClusterGroup;
  /** The owner's alliance id, 0 for none. */
  readonly aid: number;
}

export const cellKey = (col: number, row: number): number => row * WORLD_WIDTH + col;

/** A token on the world grid: one plaque or crest and the cells it stands for. */
export interface WorldToken {
  readonly kind: "plaque" | "crest";
  readonly group: ClusterGroup;
  /** The cells it stands for (`ClusterCell.key`). */
  readonly cells: number[];
  /** The middle of its cells, map pixels. */
  wx: number;
  wy: number;
  /** The box round its cells, map pixels (for zooming in to fit). */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** An alliance id among its cells (the plaque's shield), 0 for none. */
  aid: number;
}

/** How a zoom groups cells. */
export interface ClusterStep {
  /** Plaque squares, in cells across (a power of two). */
  readonly plaqueCells: number;
  /** Fewest cells a plaque stands for; fewer stay as their own markers. */
  readonly plaqueMin: number;
  /** Own and hostile cells wear crests. */
  readonly crests: boolean;
}

/** Plaque squares are about this many screen pixels across. */
const PLAQUE_TARGET_PX = { phone: 170, desk: 190 } as const;

/**
 * The grouping for a zoom. `cellPx` is a column step on the screen (`colStep * zoom`), `phone` the
 * phone layout, and `markersDrawn` whether the map draws markers at this zoom at all (not on the
 * far raster): where it does not, even a lone cell gets a plaque, or it would vanish.
 */
export const stepFor = (
  zoom: number,
  cellPx: number,
  phone: boolean,
  markersDrawn: boolean,
  /** The step in use: handed back when nothing changed, so a frame allocates nothing. */
  previous: ClusterStep | null = null,
): ClusterStep | null => {
  if (zoom >= CLUSTER_ZOOM || !(cellPx > 0)) return null;
  const near = zoom >= NEAR_ZOOM;
  const target = (phone ? PLAQUE_TARGET_PX.phone : PLAQUE_TARGET_PX.desk) * (near ? 0.6 : 1);
  const plaqueCells = 2 ** Math.max(1, Math.ceil(Math.log2(target / cellPx)));
  const plaqueMin = !markersDrawn ? 1 : near ? 3 : 2;
  const crests = zoom < LONE_CREST_ZOOM;
  if (previous && previous.plaqueCells === plaqueCells && previous.plaqueMin === plaqueMin && previous.crests === crests) return previous;
  return { plaqueCells, plaqueMin, crests };
};

export const sameStep = (a: ClusterStep | null, b: ClusterStep | null): boolean =>
  a === b ||
  (a !== null && b !== null && a.plaqueCells === b.plaqueCells && a.plaqueMin === b.plaqueMin && a.crests === b.crests);

/** The tokens for a step, and which cells they hide. */
export interface Grouping {
  readonly tokens: WorldToken[];
  /** Cell keys whose markers a token stands for. */
  readonly hidden: number[];
  /** Cell keys a plaque stands for (their borders may be left out too). */
  readonly underPlaques: number[];
}

const newToken = (kind: WorldToken["kind"], group: ClusterGroup): WorldToken => ({
  kind,
  group,
  cells: [],
  wx: 0,
  wy: 0,
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
  aid: 0,
});

const addCell = (token: WorldToken, cell: ClusterCell): void => {
  token.cells.push(cell.key);
  // Running sums until `finish`.
  token.wx += cell.wx;
  token.wy += cell.wy;
  token.minX = Math.min(token.minX, cell.wx);
  token.minY = Math.min(token.minY, cell.wy);
  token.maxX = Math.max(token.maxX, cell.wx);
  token.maxY = Math.max(token.maxY, cell.wy);
  if (token.aid === 0 && cell.aid !== 0) token.aid = cell.aid;
};

/** Squares across the world at the largest plaque square, for numbering them. */
const SQUARES_ACROSS = WORLD_WIDTH + WORLD_HEIGHT;

/**
 * Groups the cells for a step. Runs only when the step or the cells change (not per frame): a few
 * thousand cells take well under a millisecond.
 */
export const groupCells = (cells: readonly ClusterCell[], step: ClusterStep): Grouping => {
  const tokens: WorldToken[] = [];
  const hidden: number[] = [];
  const underPlaques: number[] = [];
  const squares = new Map<number, WorldToken>();
  const size = step.plaqueCells;
  for (const cell of cells) {
    const col = cell.key % WORLD_WIDTH;
    const row = (cell.key - col) / WORLD_WIDTH;
    if (cell.group === "home" || ((cell.group === "you" || cell.group === "hostile") && step.crests)) {
      const crest = newToken("crest", cell.group);
      addCell(crest, cell);
      tokens.push(crest);
      continue;
    }
    if (cell.group !== "alliance" && cell.group !== "other") continue;
    const id = ((cell.group === "alliance" ? 1 : 0) * SQUARES_ACROSS + Math.floor(row / size)) * SQUARES_ACROSS + Math.floor(col / size);
    let plaque = squares.get(id);
    if (!plaque) squares.set(id, (plaque = newToken("plaque", cell.group)));
    addCell(plaque, cell);
  }
  for (const plaque of squares.values()) if (plaque.cells.length >= step.plaqueMin) tokens.push(plaque);
  for (const token of tokens) {
    token.wx /= token.cells.length;
    token.wy /= token.cells.length;
    for (const key of token.cells) hidden.push(key);
    if (token.kind === "plaque") for (const key of token.cells) underPlaques.push(key);
  }
  return { tokens, hidden, underPlaques };
};

/** A plaque's or crest's count as written: 1-999 as is, then "1k", "12k". */
export const countText = (count: number): string => (count >= 1000 ? `${Math.floor(count / 1000)}k` : String(count));
