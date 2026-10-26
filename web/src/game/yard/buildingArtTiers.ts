/**
 * The repainted defensive towers: a new picture for each of their three tiers.
 *
 * The owner approved three looks per tower (26 Oct 2026, the sample sheet
 * `art-samples/redesign/all-towers-taller.png` on art/samples-towers-champs-l4):
 * tier 1 the repainted tower (the Cannon's T2 sample, the others' R2-A),
 * tier 2 gold and taller, tier 3 black and gold and taller again, each on the
 * same ground footprint. Tiers 2 and 3 start at levels 4 and 7; the Monster
 * Bunker, which stops at level 5, splits its five levels the same way, 1-2,
 * 3-4 and 5.
 *
 * Each picture is the painting the redesign kit fitted onto the Flash tower,
 * exported by `web/tools/tower-tiers/export.py`: cropped, at twice the game's
 * size (`@2x`, so Pixi draws it at 1x), with its top-left given from the
 * building's isometric origin like every row in `buildingArtData.ts`. Its
 * base stands where the Flash tower's does, so a taller tier grows upward.
 *
 * - **Off unless asked for.** The live game keeps the Flash towers until the
 *   owner decides: the new art shows only in a browser that turned it on
 *   (`newTowerArt`). The server's matching setting, `TOWER_TIER_ART`, sends
 *   viewers the tier of someone else's tower (`buildingArtLevels.ts`).
 * - **A still picture.** The gun, coil or door is painted in, so a tier
 *   ships no animation strips: the turret holds its painted facing in a
 *   battle instead of turning, and the Flash strips are not drawn over it.
 * - **Damaged** keeps the tier's picture and lets the yard's damage tint tell
 *   the story; **destroyed** is the Flash rubble, shared by every tier
 *   (the redesign brief: one rubble pile per building).
 * - **Shadows** are stand-ins: the silhouette leaned back, flattened and
 *   blurred, as on the sample sheets, until shadows are painted.
 */

/** Where this browser keeps the choice of the new tower art ("1" is on). */
export const NEW_TOWER_ART_KEY = "bymr.newTowerArt";

const addressSearch = (): string => {
  try {
    return window.location.search;
  } catch {
    return ""; // No page address (a test, a worker).
  }
};

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * Whether this page shows the new tower art: off unless this browser turned
 * it on. `?towers=new` in the address turns it on and remembers that;
 * `?towers=classic` turns it off again. Not in Account Settings yet.
 */
export const readNewTowerArt = (search: string = addressSearch(), store: Storage | null = storage()): boolean => {
  const asked = new URLSearchParams(search).get("towers");
  try {
    if (asked === "new") store?.setItem(NEW_TOWER_ART_KEY, "1");
    else if (asked === "classic") store?.removeItem(NEW_TOWER_ART_KEY);
    return asked === "new" || (asked !== "classic" && store?.getItem(NEW_TOWER_ART_KEY) === "1");
  } catch {
    // Site data blocked: the address still decides for this page.
    return asked === "new";
  }
};

let newTowerArtOn = readNewTowerArt();

/** Whether the new tower art is on, read once when the game loads. */
export const newTowerArt = (): boolean => newTowerArtOn;

/** Turns the new tower art on or off for this page; for tests. */
export const setNewTowerArt = (on: boolean): void => {
  newTowerArtOn = on;
};

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

/** The three tiers of each tower, by type, lowest first. */
export const TOWER_TIER_ART: Readonly<Record<number, readonly TierArt[]>> = {
  // 20 Cannon Tower
  20: [
    { from: 1, top: ["top.t1@2x.webp", -33, -19], shadow: ["shadow.t1.jpg", -31, 22], lift: 0 },
    { from: 4, top: ["top.t2@2x.webp", -33, -33], shadow: ["shadow.t2.jpg", -31, 17], lift: 10 },
    { from: 7, top: ["top.t3@2x.webp", -33, -46], shadow: ["shadow.t3.jpg", -31, 12], lift: 23 },
  ],
  // 21 Sniper Tower
  21: [
    { from: 1, top: ["top.t1@2x.webp", -40, -45], shadow: ["shadow.t1.jpg", -37, 12], lift: 1 },
    { from: 4, top: ["top.t2@2x.webp", -40, -75], shadow: ["shadow.t2.jpg", -37, 2], lift: 31 },
    { from: 7, top: ["top.t3@2x.webp", -40, -92], shadow: ["shadow.t3.jpg", -38, -4], lift: 48 },
  ],
  // 22 Monster Bunker: five levels, so 1-2, 3-4 and 5
  22: [
    { from: 1, top: ["top.t1@2x.webp", -45, -8], shadow: ["shadow.t1.jpg", -43, 35], lift: 0 },
    { from: 3, top: ["top.t2@2x.webp", -45, -30], shadow: ["shadow.t2.jpg", -43, 27], lift: 20 },
    { from: 5, top: ["top.t3@2x.webp", -45, -47], shadow: ["shadow.t3.jpg", -42, 21], lift: 38 },
  ],
  // 23 Laser Tower
  23: [
    { from: 1, top: ["top.t1@2x.webp", -33, -48], shadow: ["shadow.t1.jpg", -31, 10], lift: 0 },
    { from: 4, top: ["top.t2@2x.webp", -33, -73], shadow: ["shadow.t2.jpg", -31, 2], lift: 23 },
    { from: 7, top: ["top.t3@2x.webp", -33, -89], shadow: ["shadow.t3.jpg", -31, -4], lift: 39 },
  ],
  // 25 Tesla Tower
  25: [
    { from: 1, top: ["top.t1@2x.webp", -33, -56], shadow: ["shadow.t1.jpg", -31, 8], lift: 0 },
    { from: 4, top: ["top.t2@2x.webp", -33, -82], shadow: ["shadow.t2.jpg", -31, -1], lift: 26 },
    { from: 7, top: ["top.t3@2x.webp", -33, -102], shadow: ["shadow.t3.jpg", -32, -8], lift: 45 },
  ],
  // 115 Aerial Defense Tower
  115: [
    { from: 1, top: ["top.t1@2x.webp", -39, -15], shadow: ["shadow.t1.jpg", -36, 26], lift: 0 },
    { from: 4, top: ["top.t2@2x.webp", -39, -20], shadow: ["shadow.t2.jpg", -35, 25], lift: 4 },
    { from: 7, top: ["top.t3@2x.webp", -39, -31], shadow: ["shadow.t3.jpg", -35, 20], lift: 16 },
  ],
  // 118 Railgun
  118: [
    { from: 1, top: ["top.t1@2x.webp", -36, -1], shadow: ["shadow.t1.jpg", -33, 30], lift: 0 },
    { from: 4, top: ["top.t2@2x.webp", -36, -12], shadow: ["shadow.t2.jpg", -33, 27], lift: 9 },
    { from: 7, top: ["top.t3@2x.webp", -36, -23], shadow: ["shadow.t3.jpg", -33, 23], lift: 20 },
  ],
};

/**
 * The tier picture a tower shows at `level`, or null while the new art is
 * off, below level 1 and for every type that is not a repainted tower.
 */
export const tierArtFor = (type: number, level: number): TierArt | null => {
  if (!newTowerArtOn) return null;
  let chosen: TierArt | null = null;
  for (const tier of TOWER_TIER_ART[type] ?? []) {
    if (tier.from > level) break;
    chosen = tier;
  }
  return chosen;
};

/** World px a tower's gun stands above the Flash tower's at this level; 0 with the Flash art. */
export const tierLift = (type: number, level: number): number => tierArtFor(type, level)?.lift ?? 0;
