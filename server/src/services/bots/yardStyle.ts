import { mulberry32 } from "../../game-rules/combat/rng.js";

/**
 * How a bot builds its yard, drawn once per seed (owner decisions of
 * 2026-10-23, Map Room 1 bots only). Both the build order (`progression.ts`)
 * and the placement (`layout.ts`) read it, so it lives on its own.
 *
 * ## Wall styles
 *
 * "Different players have different strategies": about half the bots wall in
 * the whole yard, the guide's walled core with a 3 x 3 grid of walled
 * compartments round it (`full`); the others wall only the core, then one
 * ring round the core and the towers beside it, with gaps, and leave the
 * harvesters further out in the open (`core`).
 *
 * A `core` bot stands only the walls its rings take: the core's own wall
 * ({@link CORE_WALLS}), then the tower ring ({@link TOWER_RING_WALLS}), then
 * the second ring that doubles the core ({@link CORE_RING_WALLS}). So from
 * Town Hall 6 on it stands fewer walls than its Town Hall allows, as a
 * player who walls only the middle does.
 *
 * ## Beginners
 *
 * About one bot in four ({@link BEGINNER_SHARE}) starts like a new player:
 * while its Town Hall is level 1 or 2 it puts each building down next to the
 * ones already standing, harvesters of a kind side by side and towers by the
 * Town Hall, with no thought for rings or cover. From Town Hall 3 on it has
 * learnt, and builds the rest the way every other bot does. Its early
 * buildings stay where they were put, as growth never moves a building.
 */

export type WallStyle = "full" | "core";

export interface YardStyle {
  walls: WallStyle;
  beginner: boolean;
}

/** The share of bots that wall in the whole yard `[PLACEHOLDER]` (owner: "about 50/50"). */
export const FULL_WALLS_SHARE = 0.5;

/** The share of bots that start out with a beginner's plain yard `[PLACEHOLDER]` (owner: "about 1 in 4"). */
export const BEGINNER_SHARE = 0.25;

/** The highest Town Hall level a beginner builds plainly at. */
export const BEGINNER_TOP_HALL = 2;

/**
 * The core's wall in cells (17 x 12 round its inside, `layout.ts`) and how
 * many of those are hallway, holding a trap rather than a wall.
 */
export const CORE_CELLS = 58;
export const CORE_HALLWAY = 4;
export const CORE_WALLS = CORE_CELLS - CORE_HALLWAY;

/**
 * How far out the `core` style's tower ring stands from the core's wall, in
 * cells, and how many gaps of two cells it leaves, one a side.
 */
export const TOWER_RING_OFFSET = 9;
export const TOWER_RING_GAPS = 4;
/** Its wall: the core's box `TOWER_RING_OFFSET` cells further out on every side, less the gaps. */
export const TOWER_RING_WALLS = CORE_CELLS + 8 * TOWER_RING_OFFSET - 2 * TOWER_RING_GAPS;

/** The ring hard against the core that doubles it: the core's box a cell out on every side, its hallway cells left open. */
export const CORE_RING_WALLS = CORE_CELLS + 8 - CORE_HALLWAY;

/** The salt of the style's stream. */
const STYLE_SALT = 0x4f1bbcdc;

/** A seed's yard style (see the file comment). */
export const yardStyleOf = (seed: number): YardStyle => {
  const rng = mulberry32((Math.floor(seed) ^ STYLE_SALT) >>> 0);
  const walls: WallStyle = rng.float() < FULL_WALLS_SHARE ? "full" : "core";
  return { walls, beginner: rng.float() < BEGINNER_SHARE };
};

/** Every wall a `core` bot ever stands: its three rings. */
export const CORE_STYLE_WALLS = CORE_WALLS + TOWER_RING_WALLS + CORE_RING_WALLS;

/**
 * The most walls a `core` bot stands when it means to stand `wanted`: never
 * more than its rings take. A ring the walls cannot close yet stands part
 * built, as a player's does while they save up for the rest.
 */
export const coreStyleWalls = (wanted: number): number => Math.min(wanted, CORE_STYLE_WALLS);
