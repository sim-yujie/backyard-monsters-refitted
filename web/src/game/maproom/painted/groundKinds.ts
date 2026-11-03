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
  GroundTexture.CANOPY,
  GroundTexture.SNOW,
  GroundTexture.MEADOW_PLAIN,
  GroundTexture.SHALLOWS,
  GroundTexture.DEEP,
  GroundTexture.WET_SAND,
  GroundTexture.FOAM,
];

/**
 * A cell's ground, by sampler index in {@link SHADER_TEXTURES} (0..9), plus two flat colours the
 * shader paints itself: fog (out of sight) and not loaded yet. Samplers 10 and 11 (wet sand, foam)
 * are the coast's (plan step 3): no cell wears them. Samplers 4 and 5 (marsh mud, canopy) are the
 * land features' (plan step 6, `canopy.ts`): no cell wears them either; the shader lays them over
 * the feature cells' own ground by the features' smooth share, so they blend into the meadow.
 */
export const Ground = {
  MEADOW: 0,
  LUSH: 1,
  SAND: 2,
  ROCK: 3,
  MARSH: 4,
  CANOPY: 5,
  SNOW: 6,
  MEADOW_PLAIN: 7,
  SHALLOWS: 8,
  DEEP: 9,
  FOG: 14,
  UNLOADED: 15,
} as const;
export type Ground = (typeof Ground)[keyof typeof Ground];

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

/**
 * Map Room 2's land feature codes (`lf`, server `game-rules/combat/landFeatures.ts`): 1 forest,
 * 2 rocks, 3 marsh; the rest (resource nodes) stand on open ground. Sent only with the server's
 * `MR2_LAND_FEATURES` switch on. The feature travels in the texel's own channel; the shader paints
 * the canopy, rocky ground and marsh over the cell's ground (`canopy.ts`).
 */
export const LandFeature = { FOREST: 1, ROCKS: 2, MARSH: 3 } as const;

/**
 * A cell's ground: fog, not loaded, or its height band. A forest's ground (seen in a camp's
 * clearing and where the canopy's edge wanders) is lush meadow, unless the cell is high rock or snow.
 */
export const groundOf = (cell: MapCell | undefined): Ground => {
  if (cell === undefined) return Ground.UNLOADED;
  if (isFogCell(cell)) return Ground.FOG;
  const ground = groundOfHeight(cell.i);
  const feature = (cell as { lf?: number }).lf;
  if (feature === LandFeature.FOREST && (ground === Ground.SAND || ground === Ground.MEADOW)) return Ground.LUSH;
  return ground;
};

/**
 * The data texel's flag for a cell that shows a camp, yard or outpost picture in its middle: the
 * ground details (flowers, tufts, pebbles) keep clear of it.
 */
export const OCCUPIED_FLAG = 16;

/** Whether a cell shows a picture in its middle (a wild camp, a yard or an outpost). */
export const isOccupied = (cell: MapCell | undefined): boolean =>
  cell !== undefined && !isFogCell(cell) && (cell as { b?: unknown }).b !== undefined;

/**
 * One cell's texel in the data texture: R height (0..255), G land feature, B river edge bits (plan
 * step 7, 0 for now), A the ground (low 4 bits) plus {@link OCCUPIED_FLAG}.
 */
export const encodeCell = (cell: MapCell | undefined, out: Uint8Array, offset: number): void => {
  const ground = groundOf(cell);
  const known = cell !== undefined && !isFogCell(cell);
  out[offset] = known ? Math.max(0, Math.min(255, Math.round(cell.i))) : 0;
  out[offset + 1] = known ? ((cell as { lf?: number }).lf ?? 0) : 0;
  out[offset + 2] = 0;
  out[offset + 3] = ground | (isOccupied(cell) ? OCCUPIED_FLAG : 0);
};
