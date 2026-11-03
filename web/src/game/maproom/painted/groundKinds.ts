import { isFogCell, type MapCell } from "@/api/types";

/**
 * Which painted ground a Map Room 2 cell wears (plan step 2), and how a cell is packed into the
 * painted map's data texture (`GroundData.ts`).
 *
 * The ground textures are one atlas, `public/maproom/painted/ground@4x.webp`, in this order
 * (`web/tools/mr2-paint/build.py` `TEXTURE_ORDER`).
 */
export const GroundTexture = {
  MEADOW: 0,
  LUSH: 1,
  SAND: 2,
  ROCK: 3,
  MARSH: 4,
  FOREST_FLOOR: 5,
  SNOW: 6,
  MEADOW_PLAIN: 7,
  SHALLOWS: 8,
  DEEP: 9,
  WET_SAND: 10,
  FOAM: 11,
  CANOPY: 12,
} as const;
export type GroundTexture = (typeof GroundTexture)[keyof typeof GroundTexture];

/** Textures the ground shader binds, in sampler order (`groundShader.ts`'s `uGround0..`). */
export const SHADER_TEXTURES: readonly GroundTexture[] = [
  GroundTexture.MEADOW,
  GroundTexture.LUSH,
  GroundTexture.SAND,
  GroundTexture.ROCK,
  GroundTexture.MARSH,
  GroundTexture.FOREST_FLOOR,
  GroundTexture.SNOW,
  GroundTexture.MEADOW_PLAIN,
  GroundTexture.SHALLOWS,
  GroundTexture.DEEP,
];

/**
 * A cell's ground, by sampler index in {@link SHADER_TEXTURES} (0..9), plus two flat colours the
 * shader paints itself: fog (out of sight) and not loaded yet.
 */
export const Ground = {
  MEADOW: 0,
  LUSH: 1,
  SAND: 2,
  ROCK: 3,
  MARSH: 4,
  FOREST_FLOOR: 5,
  SNOW: 6,
  MEADOW_PLAIN: 7,
  SHALLOWS: 8,
  DEEP: 9,
  FOG: 14,
  UNLOADED: 15,
} as const;
export type Ground = (typeof Ground)[keyof typeof Ground];

/**
 * Map Room 2's land feature codes (`lf`, branch feat/mr2-land, `landFeature.ts`): 1 forest,
 * 2 rocks, 3 marsh; the rest (resource nodes) stand on open ground. Absent until that branch
 * merges, so today every land cell takes its ground from its height alone.
 */
const LAND_FEATURE_GROUND: Record<number, Ground> = {
  1: Ground.FOREST_FLOOR,
  2: Ground.ROCK,
  3: Ground.MARSH,
};

/**
 * Ground by height, the server's terrain bands (`cellVisuals.ts` `TERRAIN_BANDS`): water up to
 * 99 (deep below 90, shallows 90..99), sand 100..109, meadow 110..139, lush meadow 140..169,
 * rock 170..184, and snow on the rare peaks from 185 (plan step 5).
 */
export const groundOfHeight = (height: number): Ground => {
  if (height < 90) return Ground.DEEP;
  if (height <= 99) return Ground.SHALLOWS;
  if (height <= 109) return Ground.SAND;
  if (height <= 139) return Ground.MEADOW;
  if (height <= 169) return Ground.LUSH;
  if (height <= 184) return Ground.ROCK;
  return Ground.SNOW;
};

/** A cell's ground: fog, not loaded, its land feature, or its height band. */
export const groundOf = (cell: MapCell | undefined): Ground => {
  if (cell === undefined) return Ground.UNLOADED;
  if (isFogCell(cell)) return Ground.FOG;
  const height = cell.i;
  const water = height <= 99;
  const feature = (cell as { lf?: number }).lf;
  if (!water && feature !== undefined && LAND_FEATURE_GROUND[feature] !== undefined) {
    return LAND_FEATURE_GROUND[feature]!;
  }
  return groundOfHeight(height);
};

/**
 * One cell's texel in the data texture: R height (0..255), G land feature, B river edge bits (plan
 * step 7, 0 for now), A the ground (low 4 bits).
 */
export const encodeCell = (cell: MapCell | undefined, out: Uint8Array, offset: number): void => {
  const ground = groundOf(cell);
  const known = cell !== undefined && !isFogCell(cell);
  out[offset] = known ? Math.max(0, Math.min(255, Math.round(cell.i))) : 0;
  out[offset + 1] = known ? ((cell as { lf?: number }).lf ?? 0) : 0;
  out[offset + 2] = 0;
  out[offset + 3] = ground;
};
