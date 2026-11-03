import { isSwitchOn } from "./BotConfig.js";
import { MapRoom2 } from "../enums/MapRoom.js";
import { type HexShape, hexShapeOf } from "../game-rules/maproom/range.js";

/**
 * Represents the size of Map Room 2 world map.
 * @constant {number[]}
 */
export const WORLD_SIZE = [MapRoom2.HEIGHT, MapRoom2.WIDTH];

/**
 * The scale factor for noise generation. This value determines the frequency of the noise.
 * A higher value results in larger, more spread-out features, while a lower value results in smaller, more detailed features.
 * @constant {number}
 */
export const NOISE_SCALE = 12;

/**
 * The scale factor for terrain height. This value determines the range of terrain heights.
 * A higher value results in taller terrain features, while a lower value results in flatter terrain.
 * @constant {number}
 */
export const TERRAIN_SCALE = 95;

/**
 * Number of cells near the edge where the transition will start to smooth.
 * @constant {number}
 */
export const EDGE_TRANSITION_WIDTH = 3;

/**
 * The most of any one resource a Map Room 2 player can store
 * @constant {number}
 */
export const MAX_RESOURCE_CAPACITY = 7_046_100_000;

/** Which Map Room 2 cells the neighbour defence bonus covers. */
export type Mr2NeighbourBonusMode = "off" | "all" | "players";

/**
 * Map Room 2's neighbour defence bonus switch (`docs/mr2-neighbours.md`): a
 * cell under attack defends better for each friendly cell around it.
 * `MR2_NEIGHBOUR_BONUS` is `on` (or `true`) for every cell, `players` for
 * players' main yards and outposts only (no wild monster camps), and off for
 * anything else, the default, which serves every attack exactly as before.
 * Read on each attack load, so tests can flip it.
 */
export const mr2NeighbourBonusMode = (
  env: Record<string, string | undefined> = process.env
): Mr2NeighbourBonusMode => {
  if (isSwitchOn(env.MR2_NEIGHBOUR_BONUS)) return "all";
  return env.MR2_NEIGHBOUR_BONUS?.trim().toLowerCase() === "players" ? "players" : "off";
};

/** Whether the neighbour bonus is on for any cell at all. */
export const mr2NeighbourBonusEnabled = (env: Record<string, string | undefined> = process.env): boolean =>
  mr2NeighbourBonusMode(env) !== "off";

/**
 * Map Room 2's tilted camera (`docs/mr2-modern-look-plan.md` step 4): `MR2_TILT`
 * `on` (or `true`) lets Modern players see the map tilted, on by default and
 * switched flat per account (`user.map_flat`); anything else, the default,
 * keeps every map flat as before. Sent to the web client in the settings
 * block, so it is read on each request and tests can flip it.
 */
export const mr2TiltEnabled = (env: Record<string, string | undefined> = process.env): boolean =>
  isSwitchOn(env.MR2_TILT);

/**
 * Map Room 2's land features switch (`docs/mr2-civ-study.md` design A,
 * `game-rules/combat/landFeatures.ts`): every land cell gets one feature
 * (forest, rocks, marsh or a resource node) that changes building health,
 * tower damage, tower range and outpost income. `MR2_LAND_FEATURES` is `on`
 * (or `true`); anything else, the default, is off: no `lf` on the map, no
 * `land` in any defence and no change to income, so the game is exactly as
 * before. The map art follows the switch, as it only draws a cell's `lf`.
 * Read on each use, so tests can flip it.
 */
export const mr2LandFeaturesEnabled = (env: Record<string, string | undefined> = process.env): boolean =>
  isSwitchOn(env.MR2_LAND_FEATURES);

/**
 * Map Room 2's hex shape (`docs/mr2-modern-look-plan.md` step 1):
 * `MR2_HEX_SHAPE=pointy` turns the world's hexes pointy-top (odd-r rows) for
 * every player, Classic included; anything else, the default, keeps Flash's
 * flat-top columns (odd-q), exactly as before. Stored cell coordinates do not
 * change, only which cells touch: range, sight, takeover adjacency and the
 * neighbour bonus all measure with it. It is the full-undo switch: the
 * painted look switching off leaves it as it is. Sent to the web client in
 * the settings block, and read on each use, so tests can flip it.
 */
export const mr2HexShape = (env: Record<string, string | undefined> = process.env): HexShape =>
  hexShapeOf(env.MR2_HEX_SHAPE);

/**
 * Map Room 2's rivers (`docs/mr2-modern-look-plan.md` step 7): `MR2_RIVERS`
 * `on` (or `true`) sends each land cell's river edges (`rv`) with the map so
 * the Modern map can draw rivers along cell edges. Look only: rivers change
 * no number anywhere. Anything else, the default, sends nothing new, so the
 * map is exactly as before. Read on each use, so tests can flip it.
 */
export const mr2RiversEnabled = (env: Record<string, string | undefined> = process.env): boolean =>
  isSwitchOn(env.MR2_RIVERS);
