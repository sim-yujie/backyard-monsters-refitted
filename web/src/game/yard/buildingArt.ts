import { BUILDING_ART_ROWS, type ArtImage, type ArtLevel } from "./buildingArtData";

/**
 * Resolving a building to its art.
 *
 * The table itself is generated — see `buildingArtData.ts` — because it is
 * several hundred rows lifted out of the Flash client's props file. What lives
 * here is the two rules that turn a row into a picture.
 *
 * ## Which image a level uses
 *
 * A building's art does not change at every level. The Twig Snapper has four
 * pictures for ten levels, at levels 1, 3, 6 and 10; the Cannon Tower has one
 * for all ten. So the lookup is: take the entry for this exact level if there is
 * one, otherwise walk *down* until an entry exists. Level 0 — a building still
 * under construction — uses the level 1 art.
 * (`client/scripts/BFOUNDATION.as:896-914`.)
 *
 * Two buildings have a lower maximum on Map Room 2 than the art table knows
 * about, and the client clamps the level before looking the art up
 * (`client/scripts/BFOUNDATION.as:835-843`).
 *
 * ## Which state
 *
 * Default, damaged or destroyed. If a building has no picture for the state it
 * is in, the Flash client falls back to the default one rather than drawing
 * nothing (`client/scripts/BFOUNDATION.as:921-923`), and so does this.
 *
 * Nothing here touches Pixi: resolution is a table lookup, and keeping it that
 * way is what lets the unit tests check every building type against the art on
 * disk without a renderer. Fetching lives in `YardTextures.ts`.
 */

export const ArtState = {
  DEFAULT: "",
  DAMAGED: "damaged",
  DESTROYED: "destroyed",
} as const;
export type ArtState = (typeof ArtState)[keyof typeof ArtState];

/** Where the game server keeps the building art. Proxied in development. */
const ASSET_ROOT = "/assets/";

interface ArtRowIndex {
  readonly name: string;
  readonly folder: string;
  readonly levels: readonly ArtLevel[];
  readonly hp: readonly number[];
  readonly size: number;
}

const ROWS = new Map<number, ArtRowIndex>(
  BUILDING_ART_ROWS.map((row) => [
    row[0],
    { name: row[1], folder: row[2], levels: row[3], hp: row[4], size: row[5] },
  ]),
);

/** The display name from the game's own string table, or null. */
export const buildingName = (type: number): string | null => ROWS.get(type)?.name ?? null;

/** True when the art table knows this building type. */
export const hasArt = (type: number): boolean => ROWS.has(type);

/** Every building type in the table, ascending. */
export const artTypes = (): number[] => [...ROWS.keys()].sort((a, b) => a - b);

/** The asset folder for a type, exactly as the props table spells it. */
export const artFolder = (type: number): string | null => ROWS.get(type)?.folder ?? null;

/**
 * Maximum health at a level, from the props table's `hp` ladder.
 *
 * `Setup` reads `hp[level - 1]`, and `hp[0]` for a building still under
 * construction (`client/scripts/BFOUNDATION.as:3123-3129`). Levels past the end
 * of the ladder take its last entry, which is what a save carried down from Map
 * Room 3 needs. Null when the type has no ladder at all, which is every
 * decoration.
 */
export const maxHealth = (type: number, level: number): number | null => {
  const ladder = ROWS.get(type)?.hp;
  if (!ladder || ladder.length === 0) return null;
  const index = Math.min(Math.max(level - 1, 0), ladder.length - 1);
  return ladder[index] ?? null;
};

/**
 * The props table's `size` for a type, or null.
 *
 * For most buildings this is a build-menu size class and says nothing about the
 * footprint, which each class sets in its own constructor. For decorations it
 * *is* the footprint: `BDECORATION` reads it straight out of the props table
 * (`client/scripts/BDECORATION.as:20-25`). `YardGrid.footprintOf` uses it only
 * for the types its own table does not name, which is exactly the decorations.
 */
export const propsSize = (type: number): number | null => {
  const size = ROWS.get(type)?.size;
  return size === undefined || size <= 0 ? null : size;
};

/**
 * Levels capped below the art table's ceiling on Map Room 2.
 *
 * The Flinger's fifth level and the Monster Housing's levels 7 to 10 exist only
 * on Map Room 3, and a save carried over from there can still name them. The
 * client renders the highest level this map room has art for rather than
 * failing the lookup (`client/scripts/BFOUNDATION.as:835-843`).
 */
const MAP_ROOM_2_MAX_LEVEL: Record<number, number> = { 5: 4, 15: 6 };

/** One picture: its URL, where to put it, and the sub-rectangle to draw. */
export interface ResolvedImage {
  readonly url: string;
  /** Top-left of the bitmap relative to the building's isometric origin. */
  readonly x: number;
  readonly y: number;
  /** Set when the file is an animation strip and only its first cell is wanted. */
  readonly frame: { readonly width: number; readonly height: number } | null;
}

export interface ResolvedArt {
  readonly name: string;
  readonly folder: string;
  /** The art level actually used, which may be below the building's level. */
  readonly level: number;
  readonly top: ResolvedImage;
  /** Absent for the several buildings that ship no shadow for this state. */
  readonly shadow: ResolvedImage | null;
}

const imageOf = (folder: string, entry: ArtImage): ResolvedImage | null => {
  if (!entry) return null;
  const [file, x, y] = entry;
  return {
    url: `${ASSET_ROOT}${folder}${file}`,
    x,
    y,
    frame: entry.length === 5 ? { width: entry[3], height: entry[4] } : null,
  };
};

/** Indices into an `ArtLevel` tuple for the default, damaged and destroyed art. */
const TOP_INDEX: Record<ArtState, 1 | 2 | 3> = { "": 1, damaged: 2, destroyed: 3 };
const SHADOW_INDEX: Record<ArtState, 4 | 5 | 6> = { "": 4, damaged: 5, destroyed: 6 };

/**
 * The art for one building, or null when the type is not in the table.
 *
 * `level` is the building's own level; 0 (under construction) and anything
 * above the table's ceiling are handled here.
 */
export const resolveArt = (type: number, level: number, state: ArtState): ResolvedArt | null => {
  const row = ROWS.get(type);
  if (!row) return null;

  const cap = MAP_ROOM_2_MAX_LEVEL[type];
  const effective = cap === undefined ? level : Math.min(level, cap);

  // Level 0 is a building whose foundation is down but which is not finished;
  // it shows the level 1 art.
  const wanted = effective <= 0 ? 1 : effective;

  let chosen: ArtLevel | null = null;
  for (const candidate of row.levels) {
    if (candidate[0] > wanted) break;
    chosen = candidate;
  }
  // Nothing at or below the wanted level: take the lowest there is, so a
  // building is never invisible because its level is out of range.
  chosen ??= row.levels[0] ?? null;
  if (!chosen) return null;

  const top = imageOf(row.folder, chosen[TOP_INDEX[state]]) ?? imageOf(row.folder, chosen[1]);
  if (!top) return null;

  // The state fell back to the default picture, so its shadow has to as well,
  // or a damaged building would wear its healthy silhouette.
  const usedState = chosen[TOP_INDEX[state]] ? state : ArtState.DEFAULT;
  const shadow =
    imageOf(row.folder, chosen[SHADOW_INDEX[usedState]]) ??
    imageOf(row.folder, chosen[SHADOW_INDEX[ArtState.DEFAULT]]);

  return { name: row.name, folder: row.folder, level: chosen[0], top, shadow };
};
