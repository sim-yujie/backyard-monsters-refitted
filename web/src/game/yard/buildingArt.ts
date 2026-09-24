import { BUILDING_ART_ROWS, type ArtAnim, type ArtImage, type ArtLevel } from "./buildingArtData";

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
 * ## Animation layers
 *
 * A building is `shadow` + `top` + up to three animation strips, `anim`,
 * `anim2` and `anim3`, stacked in that order above the top
 * (`client/scripts/BFOUNDATION.as:1127-1200`). Each strip is a horizontal run
 * of equal cells; which cell is showing is the building class's business, not
 * the art table's, and lives in `yardAnim.ts`.
 *
 * The props table has no `animdestroyed` for any type, so a destroyed building
 * has no animation layers at all. A damaged one uses `animdamaged` if the type
 * has it and otherwise shows none: the Flash client keeps the state it chose
 * for the top and simply skips any image the state has no entry for
 * (`BFOUNDATION.as:920-931`).
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

/**
 * Prefixes the props table hangs on a string key: `bdg_` for a decoration,
 * `bi_` for an Inferno building, `b_` for everything else.
 */
const KEY_PREFIX = /^(?:bdg|bldg|bi|hwn|b)_/;

/**
 * A string key made readable: prefix off, underscores to spaces, title case.
 *
 * Every type in the table is named, because the generator looks the key up in
 * both sections of the game's English strings and names the handful they
 * predate from `docs/specs/` (`tools/gen-building-art.mjs`). This is the net
 * under that: a type added to the props table before the strings catch up
 * reads as words rather than as "bi_blackspurtzcannon" in the planner's Find
 * panel and its drawer (issue #51). It cannot invent the spaces inside a
 * run-on key, so it is a fallback and not the mechanism.
 */
export const prettifyArtKey = (key: string): string =>
  key
    .replaceAll("#", "")
    .replace(KEY_PREFIX, "")
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/** The display name from the game's own string table, or null. */
export const buildingName = (type: number): string | null => {
  const name = ROWS.get(type)?.name;
  if (name === undefined) return null;
  return name.includes("_") ? prettifyArtKey(name) : name;
};

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

/** One animation layer: the whole strip, its offset and how to cut it up. */
export interface ResolvedAnim {
  readonly url: string;
  /** Top-left of cell 0 relative to the building's isometric origin. */
  readonly x: number;
  readonly y: number;
  /** One cell. Cell `i` is the rectangle `(i * width, 0, width, height)`. */
  readonly width: number;
  readonly height: number;
  readonly frames: number;
}

/**
 * Where to put a strip's first cell inside a square icon box, for the HTML
 * lists that show a building as an `<img>`.
 *
 * Four types ship no still picture at all — the Monster Bunker among them —
 * and their `top` is cell 0 of an animation strip, flagged by `frame`. An
 * `<img>` cannot crop, so a list that sets `src` to the strip and trusts
 * `object-fit: contain` renders all fifteen cells squeezed into 28 pixels: a
 * 28 x 2 smear that reads as no icon at all.
 *
 * The cure is a box with `overflow: hidden` holding an oversized image. The
 * strip is exactly one cell tall, so giving the image a height and letting its
 * width follow scales the cells by that same factor without anyone having to
 * know how wide the file is — which nothing does until it has loaded. The cell
 * is then placed so it sits in the middle of the box and the cells after it
 * fall outside.
 */
export interface StripCrop {
  /** Height for the whole strip; its width follows from its own ratio. */
  readonly height: number;
  /** Where the strip's top-left corner goes, relative to the box. */
  readonly left: number;
  readonly top: number;
  /** How wide cell 0 ends up. What is visible, for a caller that needs it. */
  readonly cellWidth: number;
}

/**
 * Fits cell 0 of a strip into a `size` x `size` box, `contain`-style: scaled
 * by whichever side of the cell runs out first, never magnified, centred.
 */
export const stripCrop = (
  frame: { readonly width: number; readonly height: number },
  size: number,
): StripCrop | null => {
  if (frame.width <= 0 || frame.height <= 0 || size <= 0) return null;
  const scale = Math.min(size / frame.width, size / frame.height, 1);
  const height = frame.height * scale;
  const cellWidth = frame.width * scale;
  return { height, left: (size - cellWidth) / 2, top: (size - height) / 2, cellWidth };
};

export interface ResolvedArt {
  readonly name: string;
  readonly folder: string;
  /** The art level actually used, which may be below the building's level. */
  readonly level: number;
  readonly top: ResolvedImage;
  /** Absent for the several buildings that ship no shadow for this state. */
  readonly shadow: ResolvedImage | null;
  /**
   * The animation layers for this state, bottom to top. Empty for a destroyed
   * building and for the 78 types that never animate.
   */
  readonly anims: readonly ResolvedAnim[];
  /**
   * True when `top` is only cell 0 of `anims[0]`, because this level ships no
   * still picture of its own — types 22, 53, 105 and 129.
   *
   * The top is still resolved so the building is visible the moment its image
   * arrives, but the renderer hides it once the strip is on screen; leaving
   * both would show cell 0 through the transparent parts of every other cell.
   */
  readonly topIsAnim: boolean;
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

const animOf = (folder: string, entry: ArtAnim): ResolvedAnim => ({
  url: `${ASSET_ROOT}${folder}${entry[0]}`,
  x: entry[1],
  y: entry[2],
  width: entry[3],
  height: entry[4],
  frames: entry[5],
});

/** Indices into an `ArtLevel` tuple for the default, damaged and destroyed art. */
const TOP_INDEX: Record<ArtState, 1 | 2 | 3> = { "": 1, damaged: 2, destroyed: 3 };
const SHADOW_INDEX: Record<ArtState, 4 | 5 | 6> = { "": 4, damaged: 5, destroyed: 6 };
/** Destroyed has no slot: the props table ships no `animdestroyed` anywhere. */
const ANIM_INDEX: Record<ArtState, 7 | 8 | null> = { "": 7, damaged: 8, destroyed: null };

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

  const animIndex = ANIM_INDEX[usedState];
  const anims = (animIndex === null ? [] : (chosen[animIndex] ?? [])).map((entry) =>
    animOf(row.folder, entry),
  );

  return {
    name: row.name,
    folder: row.folder,
    level: chosen[0],
    top,
    shadow,
    anims,
    // `imageOf` only reports a frame for a five-number entry, which the
    // generator writes only when the top was taken from the animation strip.
    topIsAnim: top.frame !== null && anims[0]?.url === top.url,
  };
};
