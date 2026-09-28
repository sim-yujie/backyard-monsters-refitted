import { TRIBES, tribeInfo } from "./tribes";
import type { Mr1Neighbour, Mr1Tribe } from "./mr1Model";

/**
 * Where every pin goes on the painted Map Room 1 map (`ui/map.v1.jpg`,
 * 1760 x 1760), ported from the Flash layer (`com/monsters/maproom/
 * PlayerLayer.as:291-370`).
 *
 * Players sit on a grid of 85 px cells, at `1 + baseid % 15` across and
 * `1 + baseseed % 15` down, nudged outward ring by ring off any cell already
 * taken or inside a tribe's reserved rectangle, plus a small per-base offset
 * so the grid does not show. The same base always lands on the same spot, so
 * a neighbour never moves between refreshes. Each tribe has its own reserved
 * rectangle (`Obstruction.as:8`) and sits in its middle.
 *
 * Flash also kept pins off the map's own drawings (the farms and the pond,
 * registered from the map clip, `MapView.as:115`); that art is one flat
 * picture here, so only the reserved rectangles are avoided.
 */

/** The painted map's size in pixels. */
export const MAP_SIZE = 1760;

/** Grid cell (`PlayerLayer.as:27`, `divisor`). */
const CELL = 85;
/** Where the grid starts (`PlayerLayer.as:327-328`). */
const ORIGIN = 130;
/** Cells across the placement area: `uint(1500 / 85 - 2)` (`PlayerLayer.as:39`, `:310`). */
const SPAN = 15;
/** How many rings out a crowded spot may be pushed (`PlayerLayer.as:312`). */
const NUDGE_RINGS = 10;
/** A pin's per-base nudge off the grid, in pixels, on each axis. */
const JITTER = 13;
/** The most players Flash drew (`PlayerLayer.as:37`). */
export const MAX_PLAYER_PINS = 180;

export interface PinSpot {
  readonly x: number;
  readonly y: number;
}

/** A base id as a number for the grid, stable for ids too long for a double. */
const idNumber = (baseid: string): number => {
  const n = Number(baseid);
  if (Number.isSafeInteger(n) && n >= 0) return n;
  let hash = 0;
  for (const char of baseid) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
  return hash;
};

/**
 * Whether a grid cell overlaps a tribe's rectangle, in the pixels the pin is
 * drawn at. Flash tested `col * 85` against map coordinates without the
 * layer's 130 px origin (`PlayerLayer.as:336`), which let a player's pin sit
 * on a tribe's; this tests where the pin actually lands.
 */
const reservedBlocks = (col: number, row: number): boolean => {
  const x = ORIGIN + col * CELL;
  const y = ORIGIN + row * CELL;
  return TRIBES.some(
    ({ spot: [left, top, width, height] }) =>
      x < left + width && x + CELL > left && y < top + height && y + CELL > top,
  );
};

/**
 * The nearest free cell to `start`, looking outward ring by ring, inside the
 * placement area; null when every cell within reach is taken
 * (`getNonConflictingCoords`).
 *
 * A first pass also wants the cells either side empty: a name tag is wider
 * than a cell, and two players side by side hid each other's names. Only a
 * crowded map falls back to Flash's plain rule.
 */
const freeCell = (
  start: { col: number; row: number },
  taken: Set<string>,
): { col: number; row: number } | null => {
  const inside = (col: number, row: number): boolean =>
    col > 2 && col < SPAN && row > 2 && row < SPAN;
  const free = (col: number, row: number, spaced: boolean): boolean =>
    !taken.has(`${col},${row}`) &&
    !reservedBlocks(col, row) &&
    (!spaced || (!taken.has(`${col - 1},${row}`) && !taken.has(`${col + 1},${row}`)));
  for (const spaced of [true, false]) {
    if (free(start.col, start.row, spaced)) return start;
    for (let ring = 1; ring <= NUDGE_RINGS; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          const col = start.col + dx;
          const row = start.row + dy;
          if (inside(col, row) && free(col, row, spaced)) return { col, row };
        }
      }
    }
  }
  return null;
};

/** A tribe's pin: the middle of its reserved rectangle. */
export const tribeSpot = (tribe: Pick<Mr1Tribe, "tribe">): PinSpot => {
  const [left, top, width, height] = tribeInfo(tribe.tribe).spot;
  return { x: left + width / 2, y: top + height / 2 };
};

/**
 * Lays out your pin and the neighbours'. You go first, as in Flash
 * (`PlayerLayer.as:55-59`), so you keep your spot however many neighbours
 * arrive. A player who cannot be placed is left off the map (they stay in
 * the list).
 */
export const layoutPlayers = (
  own: { readonly baseid: string; readonly seed: number },
  neighbours: readonly Pick<Mr1Neighbour, "key" | "baseid" | "seed">[],
): { own: PinSpot; neighbours: Map<string, PinSpot> } => {
  const taken = new Set<string>();
  const place = (baseid: string, seed: number): PinSpot | null => {
    const id = idNumber(baseid);
    // A base with no seed (the web never writes one) takes a row from its id
    // instead, or every such player would start on row 1.
    const rowKey = Math.abs(Math.trunc(seed)) || Math.floor(id / SPAN);
    const cell = freeCell({ col: 1 + (id % SPAN), row: 1 + (rowKey % SPAN) }, taken);
    if (!cell) return null;
    taken.add(`${cell.col},${cell.row}`);
    // Flash's offset was up to half a cell on both axes at once, which with
    // today's larger pins let neighbours cover each other; a few pixels
    // still break up the grid.
    const x = ORIGIN + CELL * cell.col + (id % JITTER);
    const y = ORIGIN + CELL * cell.row + (Math.floor(id / JITTER) % JITTER);
    return { x, y };
  };

  const ownSpot = place(own.baseid, own.seed) ?? { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
  const spots = new Map<string, PinSpot>();
  for (const neighbour of neighbours.slice(0, MAX_PLAYER_PINS)) {
    const spot = place(neighbour.baseid, neighbour.seed);
    if (spot) spots.set(neighbour.key, spot);
  }
  return { own: ownSpot, neighbours: spots };
};

/**
 * Keeps a viewport's top-left corner inside the map. A viewport larger than
 * the map is centred on it instead.
 */
export const clampScroll = (
  scroll: PinSpot,
  viewport: { readonly width: number; readonly height: number },
): PinSpot => {
  const axis = (value: number, size: number): number =>
    size >= MAP_SIZE ? (MAP_SIZE - size) / 2 : Math.min(Math.max(0, value), MAP_SIZE - size);
  return { x: axis(scroll.x, viewport.width), y: axis(scroll.y, viewport.height) };
};

/** The scroll that puts `spot` in the middle of the viewport, clamped. */
export const centreOn = (
  spot: PinSpot,
  viewport: { readonly width: number; readonly height: number },
): PinSpot =>
  clampScroll({ x: spot.x - viewport.width / 2, y: spot.y - viewport.height / 2 }, viewport);
