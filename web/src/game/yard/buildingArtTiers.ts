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
 * - **Off unless asked for** (owner, 26 Oct 2026: not until the turrets
 *   turn): the towers show only in a browser that turned on their hidden
 *   switch (`newTowerArt`, `?towers=new`), and the player's "Classic building
 *   art" choice still wins over it. The server's matching setting,
 *   `TOWER_TIER_ART` (off by default), sends viewers the tier of someone
 *   else's tower (`buildingArtLevels.ts`).
 * - **Turrets that turn** (owner, 26 Oct 2026: "Turrets: wire in"): the
 *   Sniper, Laser, Aerial Defense and Railgun draw each tier as a body with
 *   its turret taken off plus the turret painted at every facing
 *   (codex-art Part 15), one cell per facing in the Flash strip's order, so
 *   `towerFx.ts` turns it by the same cell rule (`facingCell`, `laserCell`)
 *   and at the same moments as the Flash turret. The tier's whole picture
 *   stays its still (`ResolvedArt.still`), for the icons.
 * - **The Cannon turns too** (owner, 27 Oct 2026: "cannon ok"), although
 *   the Flash one never did: its barrel at 32 headings, 11.25 degrees a cell
 *   like the Sniper (codex-art Part 16).
 * - **The Cannon, Sniper and Laser are 3D** (owner, 28 Oct 2026: "I much
 *   prefer the 3D variant"; the Cannon's tier 1 has steel bands): rendered
 *   models from branch art/towers-3d (`web/tools/tower-tiers/export3d.py`),
 *   32 headings each, with the parts of the body in front of the turret cut
 *   out of every cell, so none needs a `front` layer. Each carries `aim`:
 *   the cell shown is the one whose barrel points along the shot, and the
 *   shot leaves its muzzle (`turretAim.ts`).
 * - **A still picture** for the others: the Tesla's coil and the Bunker's
 *   door are painted in, so those tiers ship no animation strips and the
 *   Flash strips are not drawn over them.
 * - **Damaged** keeps the tier's picture and lets the yard's damage tint tell
 *   the story; **destroyed** is the Flash rubble, shared by every tier
 *   (the redesign brief: one rubble pile per building).
 * - **Shadows** are stand-ins: the silhouette leaned back, flattened and
 *   blurred, as on the sample sheets, until shadows are painted.
 *
 * The Town Hall's new art is the default (owner, 26 Oct 2026): one picture
 * per level (`TOWN_HALL_ART`), each painted from that level's Flash picture
 * (approved 26 Oct 2026, codex-art Part 13), on Flash's own shadow for that
 * level, which fits the same footprint. Flash's Town Hall has no animation
 * strips, so nothing moving is lost. The player's "Classic building art"
 * choice in Account Settings (`classicBuildingArt`) brings back the Flash
 * look for every repainted building, the towers too once they are on.
 */

import type { ArtAnim } from "./buildingArtData";
import type { TurretAim } from "./turretAim";
import { TURRET_AIM } from "./turretAimData";

/** Where this browser keeps the choice of the old (Flash) building art ("1" is on). */
export const CLASSIC_BUILDING_ART_KEY = "bymr.classicBuildingArt";

/** Where this browser keeps the hidden switch for the new tower art, for testing ("1" is on). */
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
 * `?towers=classic` turns it off again. Not for players yet: the new
 * towers' turrets do not turn.
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

/**
 * The player's choice from Account Settings: remembered in this browser, like
 * the other display settings, and used from the next time the game loads
 * (the yard's pictures are already drawn). True if it was saved.
 */
export const saveClassicBuildingArt = (on: boolean, store: Storage | null = storage()): boolean => {
  try {
    if (on) store?.setItem(CLASSIC_BUILDING_ART_KEY, "1");
    else store?.removeItem(CLASSIC_BUILDING_ART_KEY);
    return store !== null;
  } catch {
    return false;
  }
};

/**
 * Whether the player chose the old (Flash) building art in Account Settings,
 * as the dialog shows it and the game reads it at load; false when site data
 * is blocked.
 */
export const savedClassicBuildingArt = (store: Storage | null = storage()): boolean => {
  try {
    return store?.getItem(CLASSIC_BUILDING_ART_KEY) === "1";
  } catch {
    return false;
  }
};

let classicArtOn = savedClassicBuildingArt();

/** Whether the old building art is on, read once when the game loads. */
export const classicBuildingArt = (): boolean => classicArtOn;

/** Turns the old building art on or off for this page, without saving it; for tests. */
export const setClassicBuildingArt = (on: boolean): void => {
  classicArtOn = on;
};

/** `[file, offsetX, offsetY]` from the building's origin, as in `ArtImage`. */
export type TierImage = readonly [file: string, x: number, y: number];

/**
 * A tier's turret that turns, drawn in place of its whole picture: the body,
 * then the strip over it, then its front layer if it has one
 * (`web/tools/tower-tiers/export.py turrets`).
 */
export interface TierTurret {
  /** The tier's picture with the turret taken off, an empty turntable left. */
  readonly body: TierImage;
  /**
   * The turret at every facing the game picks, as an `ArtAnim`: `[file, x, y,
   * width, height, frames]`, cell `i` facing the way the Flash strip's cell
   * `i` did (the Aerial's and Railgun's only up to cell 29, the last
   * `facingCell` reaches). Each cell is cut around the pivot.
   */
  readonly strip: ArtAnim;
  /** The point on the turntable the turret turns about, from the building's origin. */
  readonly pivot: readonly [x: number, y: number];
  /**
   * The parts of the body that stand in front of the turret (the painted
   * Cannon's front prongs and turntable rim), drawn over the strip: a
   * one-cell `ArtAnim`, so it stacks, tints and hides with the strip.
   */
  readonly front?: ArtAnim;
  /**
   * Cells in a row of the strip, for a strip of several rows (the 3D Laser:
   * a row of headings per tilt of its head); one row without it.
   */
  readonly columns?: number;
  /**
   * Where each cell's barrel points on screen and where its muzzle is, for
   * the 3D towers (`turretAim.ts`): the tower shows the cell that points
   * along its shot, and the shot leaves from its muzzle. Without it the
   * cell is picked by the Flash rule (`facingCell`, `laserCell`).
   */
  readonly aim?: TurretAim;
}

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
  /** The turret that turns, for a tower with one; `top` is then only its still picture. */
  readonly turret?: TierTurret;
}

/** The three tiers of each tower, by type, lowest first. */
export const TOWER_TIER_ART: Readonly<Record<number, readonly TierArt[]>> = {
  // 20 Cannon Tower: 3D, tier 1 the steel bands (owner, 28 Oct 2026)
  20: [
    { from: 1, top: ["top.t1@2x.webp", -34, -17], shadow: ["shadow.t1.jpg", -31, 22], lift: 0,
      turret: { body: ["body.t1@2x.webp", -34, -17], strip: ["turret.t1@2x.webp", -37, -36, 74, 53, 32], pivot: [0, 14.5],
        aim: TURRET_AIM["20.t1"] } },
    { from: 4, top: ["top.t2@2x.webp", -34, -33], shadow: ["shadow.t2.jpg", -31, 17], lift: 10,
      turret: { body: ["body.t2@2x.webp", -34, -33], strip: ["turret.t2@2x.webp", -37, -52, 74, 53, 32], pivot: [0, -1],
        aim: TURRET_AIM["20.t2"] } },
    { from: 7, top: ["top.t3@2x.webp", -33, -44], shadow: ["shadow.t3.jpg", -31, 12], lift: 23,
      turret: { body: ["body.t3@2x.webp", -33, -44], strip: ["turret.t3@2x.webp", -35, -63, 70, 50, 32], pivot: [0, -15.75],
        aim: TURRET_AIM["20.t3"] } },
  ],
  // 21 Sniper Tower: 3D
  21: [
    { from: 1, top: ["top.t1@2x.webp", -40, -47], shadow: ["shadow.t1.jpg", -37, 12], lift: 1,
      turret: { body: ["body.t1@2x.webp", -40, -37], strip: ["turret.t1@2x.webp", -28, -52, 56, 40, 32], pivot: [0, -20],
        aim: TURRET_AIM["21.t1"] } },
    { from: 4, top: ["top.t2@2x.webp", -40, -77], shadow: ["shadow.t2.jpg", -37, 2], lift: 31,
      turret: { body: ["body.t2@2x.webp", -40, -70], strip: ["turret.t2@2x.webp", -28, -82, 56, 40, 32], pivot: [0, -50],
        aim: TURRET_AIM["21.t2"] } },
    { from: 7, top: ["top.t3@2x.webp", -40, -94], shadow: ["shadow.t3.jpg", -38, -4], lift: 48,
      turret: { body: ["body.t3@2x.webp", -40, -86], strip: ["turret.t3@2x.webp", -28, -99, 56, 40, 32], pivot: [0, -67],
        aim: TURRET_AIM["21.t3"] } },
  ],
  // 22 Monster Bunker: five levels, so 1-2, 3-4 and 5
  22: [
    { from: 1, top: ["top.t1@2x.webp", -45, -8], shadow: ["shadow.t1.jpg", -43, 35], lift: 0 },
    { from: 3, top: ["top.t2@2x.webp", -45, -30], shadow: ["shadow.t2.jpg", -43, 27], lift: 20 },
    { from: 5, top: ["top.t3@2x.webp", -45, -47], shadow: ["shadow.t3.jpg", -42, 21], lift: 38 },
  ],
  // 23 Laser Tower: 3D, a row of 32 headings for each of 5 tilts of the head
  23: [
    { from: 1, top: ["top.t1@2x.webp", -33, -53], shadow: ["shadow.t1.jpg", -31, 10], lift: 0,
      turret: { body: ["body.t1@2x.webp", -33, -29], strip: ["turret.t1@2x.webp", -16, -53, 34, 35, 160], columns: 32, pivot: [0.75, -20],
        aim: TURRET_AIM["23.t1"] } },
    { from: 4, top: ["top.t2@2x.webp", -33, -76], shadow: ["shadow.t2.jpg", -31, 2], lift: 23,
      turret: { body: ["body.t2@2x.webp", -33, -54], strip: ["turret.t2@2x.webp", -16, -76, 34, 34, 160], columns: 32, pivot: [1, -44],
        aim: TURRET_AIM["23.t2"] } },
    { from: 7, top: ["top.t3@2x.webp", -33, -92], shadow: ["shadow.t3.jpg", -31, -4], lift: 39,
      turret: { body: ["body.t3@2x.webp", -33, -71], strip: ["turret.t3@2x.webp", -16, -92, 34, 34, 160], columns: 32, pivot: [1, -60],
        aim: TURRET_AIM["23.t3"] } },
  ],
  // 25 Tesla Tower
  25: [
    { from: 1, top: ["top.t1@2x.webp", -33, -56], shadow: ["shadow.t1.jpg", -31, 8], lift: 0 },
    { from: 4, top: ["top.t2@2x.webp", -33, -82], shadow: ["shadow.t2.jpg", -31, -1], lift: 26 },
    { from: 7, top: ["top.t3@2x.webp", -33, -102], shadow: ["shadow.t3.jpg", -32, -8], lift: 45 },
  ],
  // 115 Aerial Defense Tower
  115: [
    { from: 1, top: ["top.t1@2x.webp", -39, -15], shadow: ["shadow.t1.jpg", -36, 26], lift: 0,
      turret: { body: ["body.t1@2x.webp", -39, 4], strip: ["turret.t1@2x.webp", -27, -17, 54, 43, 30], pivot: [0, 24] } },
    { from: 4, top: ["top.t2@2x.webp", -39, -20], shadow: ["shadow.t2.jpg", -35, 25], lift: 4,
      turret: { body: ["body.t2@2x.webp", -39, -1], strip: ["turret.t2@2x.webp", -28, -21, 57, 43, 30], pivot: [0, 19] } },
    { from: 7, top: ["top.t3@2x.webp", -39, -31], shadow: ["shadow.t3.jpg", -35, 20], lift: 16,
      turret: { body: ["body.t3@2x.webp", -39, -13], strip: ["turret.t3@2x.webp", -25, -33, 51, 42, 30], pivot: [0, 7] } },
  ],
  // 118 Railgun
  118: [
    { from: 1, top: ["top.t1@2x.webp", -36, -1], shadow: ["shadow.t1.jpg", -33, 30], lift: 0,
      turret: { body: ["body.t1@2x.webp", -36, 10], strip: ["turret.t1@2x.webp", -36, -7, 77, 57, 30], pivot: [2, 32] } },
    { from: 4, top: ["top.t2@2x.webp", -36, -12], shadow: ["shadow.t2.jpg", -33, 27], lift: 9,
      turret: { body: ["body.t2@2x.webp", -36, -2], strip: ["turret.t2@2x.webp", -38, -21, 75, 57, 30], pivot: [0, 18] } },
    { from: 7, top: ["top.t3@2x.webp", -36, -23], shadow: ["shadow.t3.jpg", -33, 23], lift: 20,
      turret: { body: ["body.t3@2x.webp", -36, -9], strip: ["turret.t3@2x.webp", -40, -29, 77, 59, 30], pivot: [-1, 10] } },
  ],
};

/**
 * The Town Hall's ten levels, one picture each, on the same ground spot as
 * Flash's and on Flash's own shadow for that level; no gun, so no lift.
 */
export const TOWN_HALL_ART: readonly TierArt[] = [
  { from: 1, top: ["top.new1@2x.webp", -46, -47], shadow: ["shadow.1.jpg", -55, 37], lift: 0 },
  { from: 2, top: ["top.new2@2x.webp", -48, -62], shadow: ["shadow.2.jpg", -55, 36], lift: 0 },
  { from: 3, top: ["top.new3@2x.webp", -65, -63], shadow: ["shadow.3.jpg", -70, 28], lift: 0 },
  { from: 4, top: ["top.new4@2x.webp", -67, -64], shadow: ["shadow.4.jpg", -88, 20], lift: 0 },
  { from: 5, top: ["top.new5@2x.webp", -67, -64], shadow: ["shadow.5.jpg", -67, 33], lift: 0 },
  { from: 6, top: ["top.new6@2x.webp", -73, -73], shadow: ["shadow.6.jpg", -84, 26], lift: 0 },
  { from: 7, top: ["top.new7@2x.webp", -81, -84], shadow: ["shadow.7.jpg", -121, -3], lift: 0 },
  { from: 8, top: ["top.new8@2x.webp", -80, -84], shadow: ["shadow.8.jpg", -94, 8], lift: 0 },
  { from: 9, top: ["top.new9@2x.webp", -77, -94], shadow: ["shadow.9.jpg", -76, 24], lift: 0 },
  { from: 10, top: ["top.new10@2x.webp", -77, -104], shadow: ["shadow.10.jpg", -85, 24], lift: 0 },
];

/** Every type with new art the old-art switch turns back: the towers, then the Town Hall (14). */
const NEW_ART: Readonly<Record<number, readonly TierArt[]>> = { ...TOWER_TIER_ART, 14: TOWN_HALL_ART };

/**
 * The new picture a building shows at `level`, or null with the old art on,
 * for a tower while the new tower art is off, below level 1 and for every
 * type without new art.
 */
export const tierArtFor = (type: number, level: number): TierArt | null => {
  if (classicArtOn) return null;
  if (!newTowerArtOn && type in TOWER_TIER_ART) return null;
  let chosen: TierArt | null = null;
  for (const tier of NEW_ART[type] ?? []) {
    if (tier.from > level) break;
    chosen = tier;
  }
  return chosen;
};

/** World px a tower's gun stands above the Flash tower's at this level; 0 with the old art. */
export const tierLift = (type: number, level: number): number => tierArtFor(type, level)?.lift ?? 0;
