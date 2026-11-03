import { Terrain } from "../../../enums/MapRoom.js";
import { LandFeature, type LandFeatureId } from "../../../game-rules/combat/index.js";
import { mr2LandFeaturesEnabled } from "../../../config/MapRoom2Config.js";
import { generateNoise } from "./generateMap.js";

/**
 * Which land feature a Map Room 2 cell has (`docs/mr2-civ-study.md` design A,
 * `game-rules/combat/landFeatures.ts` for what each one does).
 *
 * Worked out, never stored: from a second simplex noise on the world seed
 * (the world id with {@link LAND_SEED_SUFFIX}, so it never moves with the
 * height noise) and a hash of the cell, so the same world gives every cell
 * the same feature on every server, forever, with no database column. Water
 * has none.
 *
 * Shares of land, measured over sample worlds (`landFeature.test.ts`):
 * about 55% open, 20% forest, 10% rocks, 10% marsh and 5% resource nodes.
 *
 * - Resource nodes are scattered one cell at a time by the hash (rare finds).
 * - Forests grow in patches: one noise layer, the top fifth of it.
 * - Rocks and marsh share a second layer, tilted by the height so rocks lean
 *   to high ground and marsh to low ground: its top tenth is rocks, its
 *   bottom tenth marsh.
 */

/** Added to the world id to seed the feature noise. */
export const LAND_SEED_SUFFIX = "#land";

/** Cells across one forest patch's noise wave. */
const FOREST_SCALE = 7;
/** Cells across one rocks-or-marsh noise wave. */
const GROUND_SCALE = 9;
/** Where the ground layer is read, far from the forest layer on the same noise. */
const GROUND_OFFSET = 5000;
/** How much each unit of height above 135 pushes towards rocks (below: marsh). */
const GROUND_TILT = 1 / 90;

/** Share of land that is a resource node, by the cell hash. */
export const NODE_SHARE = 0.05;
/** Forest noise above this is forest (about 21% of what is not a node). */
export const FOREST_ABOVE = 0.43;
/** The tilted ground score above this is rocks. */
export const ROCKS_ABOVE = 0.61;
/** The tilted ground score below this is marsh. */
export const MARSH_BELOW = -0.575;

/** A 32-bit hash of a world and cell (FNV-1a, then a final mix). */
export const cellHash = (worldid: string, x: number, y: number): number => {
  let hash = 0x811c9dc5;
  const text = `${worldid}:${x}:${y}`;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
};

const NODES: readonly LandFeatureId[] = [
  LandFeature.TWIG_NODE,
  LandFeature.PEBBLE_NODE,
  LandFeature.PUTTY_NODE,
  LandFeature.GOO_NODE,
];

/**
 * The feature of the cell at `(x, y)` with height `height` in world `worldid`.
 *
 * @param worldid - The world, which seeds the noise.
 * @param x - Cell column.
 * @param y - Cell row.
 * @param height - The cell's terrain height (`getTerrainHeight`); water has no feature.
 */
export const landFeatureAt = (worldid: string, x: number, y: number, height: number): LandFeatureId => {
  if (!(height > Terrain.WATER3)) return LandFeature.OPEN;

  const hash = cellHash(worldid, x, y);
  if (hash / 0x1_0000_0000 < NODE_SHARE) return NODES[(hash >>> 3) % NODES.length]!;

  const noise = generateNoise(`${worldid}${LAND_SEED_SUFFIX}`);
  if (noise(x / FOREST_SCALE, y / FOREST_SCALE) > FOREST_ABOVE) return LandFeature.FOREST;

  const ground =
    noise(GROUND_OFFSET + x / GROUND_SCALE, GROUND_OFFSET + y / GROUND_SCALE) + (height - 135) * GROUND_TILT;
  if (ground > ROCKS_ABOVE) return LandFeature.ROCKS;
  if (ground < MARSH_BELOW) return LandFeature.MARSH;
  return LandFeature.OPEN;
};

/**
 * The feature the game uses for a cell: {@link landFeatureAt} with the
 * `MR2_LAND_FEATURES` switch on, open ground (nothing) with it off.
 */
export const activeLandFeature = (worldid: string, x: number, y: number, height: number): LandFeatureId =>
  mr2LandFeaturesEnabled() ? landFeatureAt(worldid, x, y, height) : LandFeature.OPEN;
