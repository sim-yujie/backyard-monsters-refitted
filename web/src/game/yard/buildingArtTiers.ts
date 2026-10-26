/**
 * The repainted defensive towers: a new picture for each tier above the first.
 *
 * The owner approved three looks per tower (26 Oct 2026, the sample sheet
 * `art-samples/redesign/all-towers-taller.png` on art/samples-towers-champs-l4):
 * tier 1 as it is now, tier 2 gold and taller, tier 3 black and gold and taller
 * again, each on the same ground footprint. Tiers 2 and 3 start at levels 4
 * and 7; the Monster Bunker, which stops at level 5, splits its five levels
 * the same way, 1-2, 3-4 and 5.
 *
 * Each picture is the painting the redesign kit fitted onto the Flash tower,
 * exported by `web/tools/tower-tiers/export.py`: cropped, at twice the game's
 * size (`@2x`, so Pixi draws it at 1x), with its top-left given from the
 * building's isometric origin like every row in `buildingArtData.ts`. Its
 * base stands where the Flash tower's does, so a taller tier grows upward.
 *
 * - **A still picture.** The gun, coil or door is painted in, so a tier
 *   ships no animation strips: the turret holds its painted facing in a
 *   battle instead of turning, and the Flash strips are not drawn over it.
 * - **Damaged** keeps the tier's picture and lets the yard's damage tint tell
 *   the story; **destroyed** is the Flash rubble, shared by every tier
 *   (the redesign brief: one rubble pile per building).
 * - **Shadows** are stand-ins: the silhouette leaned back, flattened and
 *   blurred, as on the sample sheets, until shadows are painted.
 */

/** `[file, offsetX, offsetY]` from the building's origin, as in `ArtImage`. */
export type TierImage = readonly [file: string, x: number, y: number];

export interface TierArt {
  /** The first level that shows this picture. */
  readonly from: number;
  readonly top: TierImage;
  readonly shadow: TierImage;
  /**
   * World px this picture's top stands above the Flash tower's: how much
   * higher the gun sits, so a tower's shots leave from it.
   */
  readonly lift: number;
}

/** Tiers 2 and 3 of each tower, by type, lowest first. */
export const TOWER_TIER_ART: Readonly<Record<number, readonly TierArt[]>> = {
  // 20 Cannon Tower
  20: [
    { from: 4, top: ["top.t2@2x.webp", -33, -33], shadow: ["shadow.t2.jpg", -31, 17], lift: 10 },
    { from: 7, top: ["top.t3@2x.webp", -33, -46], shadow: ["shadow.t3.jpg", -31, 12], lift: 23 },
  ],
  // 21 Sniper Tower
  21: [
    { from: 4, top: ["top.t2@2x.webp", -40, -75], shadow: ["shadow.t2.jpg", -37, 2], lift: 31 },
    { from: 7, top: ["top.t3@2x.webp", -40, -92], shadow: ["shadow.t3.jpg", -38, -4], lift: 48 },
  ],
  // 22 Monster Bunker: five levels, so 1-2, 3-4 and 5
  22: [
    { from: 3, top: ["top.t2@2x.webp", -45, -30], shadow: ["shadow.t2.jpg", -43, 27], lift: 20 },
    { from: 5, top: ["top.t3@2x.webp", -45, -47], shadow: ["shadow.t3.jpg", -42, 21], lift: 38 },
  ],
  // 23 Laser Tower
  23: [
    { from: 4, top: ["top.t2@2x.webp", -33, -73], shadow: ["shadow.t2.jpg", -31, 2], lift: 23 },
    { from: 7, top: ["top.t3@2x.webp", -33, -89], shadow: ["shadow.t3.jpg", -31, -4], lift: 39 },
  ],
  // 25 Tesla Tower
  25: [
    { from: 4, top: ["top.t2@2x.webp", -33, -82], shadow: ["shadow.t2.jpg", -31, -1], lift: 26 },
    { from: 7, top: ["top.t3@2x.webp", -33, -102], shadow: ["shadow.t3.jpg", -32, -8], lift: 45 },
  ],
  // 115 Aerial Defense Tower
  115: [
    { from: 4, top: ["top.t2@2x.webp", -39, -20], shadow: ["shadow.t2.jpg", -35, 25], lift: 4 },
    { from: 7, top: ["top.t3@2x.webp", -39, -31], shadow: ["shadow.t3.jpg", -35, 20], lift: 16 },
  ],
  // 118 Railgun
  118: [
    { from: 4, top: ["top.t2@2x.webp", -36, -12], shadow: ["shadow.t2.jpg", -33, 27], lift: 9 },
    { from: 7, top: ["top.t3@2x.webp", -36, -23], shadow: ["shadow.t3.jpg", -33, 23], lift: 20 },
  ],
};

/**
 * The tier picture a tower shows at `level`, or null for tier 1 and for every
 * type that is not a repainted tower. Level 0 (under construction) is tier 1.
 */
export const tierArtFor = (type: number, level: number): TierArt | null => {
  let chosen: TierArt | null = null;
  for (const tier of TOWER_TIER_ART[type] ?? []) {
    if (tier.from > level) break;
    chosen = tier;
  }
  return chosen;
};

/** World px a tower's gun stands above the Flash tower's at this level; 0 for tier 1. */
export const tierLift = (type: number, level: number): number => tierArtFor(type, level)?.lift ?? 0;
