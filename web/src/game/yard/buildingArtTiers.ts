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
 * - **The look setting decides** (owner, 29 Oct 2026: no address switch;
 *   the Classic/Modern choice in Account Settings is the one setting for the
 *   yard's look): with Modern, the default, every tower in `MODERN_TOWERS`
 *   shows its new tiers (owner: "make all of them": the 3D Cannon, Sniper,
 *   Laser, Aerial Defense, Railgun, Magma Tower, Spurtz Cannons and Inferno
 *   towers, and the painted Bunker and Tesla until their 3D art is in);
 *   with Classic, the Flash towers. The server sends viewers the tier of
 *   someone else's Modern towers (`buildingArtLevels.ts`).
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
 * - **The Aerial Defense, Railgun, Spurtz Cannons and the Inferno's towers
 *   are 3D too** (branch art/buildings-3d, the same exporter): the Spurtz
 *   Cannons one look for every level, the Magma Tower's six levels split
 *   1-2, 3-4 and 5-6 as the Bunker's are, and the Inferno's Blast Tower and
 *   Sharpshooter, which share the Cannon's and Sniper's types, from
 *   `INFERNO_TOWER_TIER_ART` in an Inferno yard. The towers never painted
 *   stand on their Flash shadow.
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
 * strips, so nothing moving is lost. The player's Classic look
 * choice in Account Settings (`game/classicLook.ts`) brings back the Flash
 * look for every repainted building, the towers too.
 */

import { classicLook } from "@/game/classicLook";
import type { ArtAnim } from "./buildingArtData";
import type { YardKind } from "./buildingCostData";
import type { TurretAim } from "./turretAim";
import { TURRET_AIM } from "./turretAimData";

/**
 * The towers whose new art players see with the Modern look: the 3D Cannon
 * (20), Sniper (21), Laser (23), Aerial Defense (115), Railgun (118), Magma
 * Tower (132) and Spurtz Cannons (136, 137), the painted Monster Bunker (22)
 * and Tesla (25), and in an Inferno yard the 3D Blast Tower (20 and 130) and
 * Sharpshooter (21, `INFERNO_TOWER_TIER_ART`). A tower in `TOWER_TIER_ART`
 * but not here keeps its Flash look. The server's `TOWER_TIER_ART_LEVELS`
 * names the same.
 */
export const MODERN_TOWERS: readonly number[] = [20, 21, 22, 23, 25, 115, 118, 130, 132, 136, 137];

/** Where a browser kept the old hidden tower switch (`?towers=new`, "1" on); cleared when the game loads. */
export const OLD_NEW_TOWER_ART_KEY = "bymr.newTowerArt";

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** Forgets the old hidden tower switch, which nothing reads any more. */
export const forgetOldTowerSwitch = (store: Storage | null = storage()): void => {
  try {
    store?.removeItem(OLD_NEW_TOWER_ART_KEY);
  } catch {
    // Site data blocked: there is nothing kept to forget.
  }
};

forgetOldTowerSwitch();

/** Whether the new tower art shows: with the Modern look, as read when the game loads (`classicLook`). */
export const newTowerArt = (): boolean => !classicLook();

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
  // 20 Cannon Tower: 3D, tier 1 the steel bands (owner, 28 Oct 2026); the barrel stays 22 degrees up
  20: [
    { from: 1, top: ["top.t1@2x.webp", -34, -21], shadow: ["shadow.t1.jpg", -31, 22], lift: 0,
      turret: { body: ["body.t1@2x.webp", -34, -10], strip: ["turret.t1@2x.webp", -37, -41, 73, 57, 32], pivot: [0, 14.5],
        aim: TURRET_AIM["20.t1"] } },
    { from: 4, top: ["top.t2@2x.webp", -34, -36], shadow: ["shadow.t2.jpg", -31, 17], lift: 10,
      turret: { body: ["body.t2@2x.webp", -34, -25], strip: ["turret.t2@2x.webp", -37, -56, 73, 57, 32], pivot: [0, -1],
        aim: TURRET_AIM["20.t2"] } },
    { from: 7, top: ["top.t3@2x.webp", -33, -47], shadow: ["shadow.t3.jpg", -31, 12], lift: 23,
      turret: { body: ["body.t3@2x.webp", -33, -36], strip: ["turret.t3@2x.webp", -35, -66, 70, 54, 32], pivot: [0, -15.75],
        aim: TURRET_AIM["20.t3"] } },
  ],
  // 21 Sniper Tower: 3D
  21: [
    { from: 1, top: ["top.t1@2x.webp", -40, -46], shadow: ["shadow.t1.jpg", -37, 12], lift: 1,
      turret: { body: ["body.t1@2x.webp", -40, -37], strip: ["turret.t1@2x.webp", -28, -52, 56, 42, 32], pivot: [0, -20],
        aim: TURRET_AIM["21.t1"] } },
    { from: 4, top: ["top.t2@2x.webp", -40, -76], shadow: ["shadow.t2.jpg", -37, 2], lift: 31,
      turret: { body: ["body.t2@2x.webp", -40, -70], strip: ["turret.t2@2x.webp", -28, -82, 56, 42, 32], pivot: [0, -50],
        aim: TURRET_AIM["21.t2"] } },
    { from: 7, top: ["top.t3@2x.webp", -40, -93], shadow: ["shadow.t3.jpg", -38, -4], lift: 48,
      turret: { body: ["body.t3@2x.webp", -40, -86], strip: ["turret.t3@2x.webp", -28, -99, 56, 42, 32], pivot: [0, -67],
        aim: TURRET_AIM["21.t3"] } },
  ],
  // 22 Monster Bunker: five levels, so 1-2, 3-4 and 5
  22: [
    { from: 1, top: ["top.t1@2x.webp", -45, -8], shadow: ["shadow.t1.jpg", -43, 35], lift: 0 },
    { from: 3, top: ["top.t2@2x.webp", -45, -30], shadow: ["shadow.t2.jpg", -43, 27], lift: 20 },
    { from: 5, top: ["top.t3@2x.webp", -45, -47], shadow: ["shadow.t3.jpg", -42, 21], lift: 38 },
  ],
  // 23 Laser Tower: 3D, a row of 32 headings for each of 5 tilts of the head (its head tilts; only the Cannon keeps one)
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
  // 115 Aerial Defense Tower: 3D, 32 headings
  115: [
    { from: 1, top: ["top.t1@2x.webp", -39, -4], shadow: ["shadow.t1.jpg", -36, 26], lift: 0,
      turret: { body: ["body.t1@2x.webp", -39, -1], strip: ["turret.t1@2x.webp", -33, -27, 66, 52, 32], pivot: [0, 16.39],
        aim: TURRET_AIM["115.t1"] } },
    { from: 4, top: ["top.t2@2x.webp", -39, -9], shadow: ["shadow.t2.jpg", -35, 25], lift: 6,
      turret: { body: ["body.t2@2x.webp", -39, -6], strip: ["turret.t2@2x.webp", -33, -32, 66, 51, 32], pivot: [0, 10.87],
        aim: TURRET_AIM["115.t2"] } },
    { from: 7, top: ["top.t3@2x.webp", -39, -23], shadow: ["shadow.t3.jpg", -35, 20], lift: 19,
      turret: { body: ["body.t3@2x.webp", -39, -19], strip: ["turret.t3@2x.webp", -33, -46, 66, 52, 32], pivot: [0, -2.45],
        aim: TURRET_AIM["115.t3"] } },
  ],
  // 118 Railgun: 3D, 32 headings
  118: [
    { from: 1, top: ["top.t1@2x.webp", -41, -2], shadow: ["shadow.t1.jpg", -33, 30], lift: 0,
      turret: { body: ["body.t1@2x.webp", -41, 11], strip: ["turret.t1@2x.webp", -48, -12, 96, 54, 32], pivot: [0, 23.86],
        aim: TURRET_AIM["118.t1"] } },
    { from: 4, top: ["top.t2@2x.webp", -41, -7], shadow: ["shadow.t2.jpg", -33, 27], lift: 5,
      turret: { body: ["body.t2@2x.webp", -41, 6], strip: ["turret.t2@2x.webp", -48, -17, 96, 54, 32], pivot: [0, 18.99],
        aim: TURRET_AIM["118.t2"] } },
    { from: 7, top: ["top.t3@2x.webp", -34, -22], shadow: ["shadow.t3.jpg", -33, 23], lift: 20,
      turret: { body: ["body.t3@2x.webp", -34, -7], strip: ["turret.t3@2x.webp", -48, -33, 96, 55, 32], pivot: [0, 3.4],
        aim: TURRET_AIM["118.t3"] } },
  ],
  // 132 Magma Tower: 3D, the Volcanic look (owner, 29 Oct 2026); six levels, so 1-2, 3-4 and 5-6
  132: [
    { from: 1, top: ["top.t1@2x.webp", -48, -44], shadow: ["shadow.1.v2.jpg", -31, 10], lift: 0,
      turret: { body: ["body.t1@2x.webp", -48, -26], strip: ["turret.t1@2x.webp", -31, -59, 66, 45, 32], pivot: [2, -20.34],
        aim: TURRET_AIM["132.t1"] } },
    { from: 3, top: ["top.t2@2x.webp", -48, -52], shadow: ["shadow.1.v2.jpg", -31, 10], lift: 8,
      turret: { body: ["body.t2@2x.webp", -48, -34], strip: ["turret.t2@2x.webp", -31, -67, 66, 45, 32], pivot: [2, -28.46],
        aim: TURRET_AIM["132.t2"] } },
    { from: 5, top: ["top.t3@2x.webp", -48, -60], shadow: ["shadow.1.v2.jpg", -31, 10], lift: 16,
      turret: { body: ["body.t3@2x.webp", -48, -44], strip: ["turret.t3@2x.webp", -31, -75, 66, 45, 32], pivot: [2, -36.58],
        aim: TURRET_AIM["132.t3"] } },
  ],
  // 136 Spurtz Cannon: 3D, one look for its five levels
  136: [
    { from: 1, top: ["top.t1@2x.webp", -38, -48], shadow: ["normal_damaged_shadow.jpg", -31, 10], lift: 0,
      turret: { body: ["body.t1@2x.webp", -38, -34], strip: ["turret.t1@2x.webp", -30, -60, 57, 46, 32], pivot: [-1.5, -28.7],
        aim: TURRET_AIM["136.t1"] } },
  ],
  // 137 Black Spurtz Cannon: 3D, one look for its five levels
  137: [
    { from: 1, top: ["top.t1@2x.webp", -40, -47], shadow: ["normal_damaged_shadow.jpg", -31, 10], lift: 0,
      turret: { body: ["body.t1@2x.webp", -40, -34], strip: ["turret.t1@2x.webp", -30, -59, 57, 46, 32], pivot: [-1.5, -27.65],
        aim: TURRET_AIM["137.t1"] } },
  ],
};

/** The Inferno's Blast Tower: 3D, worn, Brimstone, Forged Steel (owner, 29 Oct 2026). */
const BLAST_TOWER_TIERS: readonly TierArt[] = [
  { from: 1, top: ["top.t1@2x.webp", -47, -45], shadow: ["shadow.1.v2.jpg", -48, 11], lift: 0,
    turret: { body: ["body.t1@2x.webp", -47, -30], strip: ["turret.t1@2x.webp", -33, -54, 66, 46, 32], pivot: [0, -20.83],
      aim: TURRET_AIM["i20.t1"] } },
  { from: 4, top: ["top.t2@2x.webp", -48, -53], shadow: ["shadow.1.v2.jpg", -48, 11], lift: 8,
    turret: { body: ["body.t2@2x.webp", -48, -40], strip: ["turret.t2@2x.webp", -33, -62, 66, 46, 32], pivot: [0, -28.95],
      aim: TURRET_AIM["i20.t2"] } },
  { from: 7, top: ["top.t3@2x.webp", -47, -61], shadow: ["shadow.1.v2.jpg", -48, 11], lift: 16,
    turret: { body: ["body.t3@2x.webp", -47, -56], strip: ["turret.t3@2x.webp", -33, -70, 66, 46, 32], pivot: [0, -37.07],
      aim: TURRET_AIM["i20.t3"] } },
];

/**
 * The Inferno's towers that share a type with a tower up top, the Blast Tower
 * (20, like the Cannon) and the Sharpshooter (21, like the Sniper): in an
 * Inferno yard these tiers show, from the Inferno's folders. 130 is the
 * Inferno's other Blast Tower, drawn from the same folder.
 */
export const INFERNO_TOWER_TIER_ART: Readonly<Record<number, readonly TierArt[]>> = {
  20: BLAST_TOWER_TIERS,
  130: BLAST_TOWER_TIERS,
  // 21 Sharpshooter: 3D, worn, Brimstone, Forged Steel
  21: [
    { from: 1, top: ["top.t1@2x.webp", -37, -78], shadow: ["shadow.1.v2.jpg", -50, 12], lift: 0,
      turret: { body: ["body.t1@2x.webp", -37, -56], strip: ["turret.t1@2x.webp", -36, -83, 68, 45, 32], pivot: [-2, -51.44],
        aim: TURRET_AIM["i21.t1"] } },
    { from: 4, top: ["top.t2@2x.webp", -51, -86], shadow: ["shadow.1.v2.jpg", -50, 12], lift: 8,
      turret: { body: ["body.t2@2x.webp", -51, -64], strip: ["turret.t2@2x.webp", -36, -91, 68, 45, 32], pivot: [-2, -59.56],
        aim: TURRET_AIM["i21.t2"] } },
    { from: 7, top: ["top.t3@2x.webp", -50, -94], shadow: ["shadow.1.v2.jpg", -50, 12], lift: 16,
      turret: { body: ["body.t3@2x.webp", -50, -72], strip: ["turret.t3@2x.webp", -36, -99, 68, 45, 32], pivot: [-2, -67.68],
        aim: TURRET_AIM["i21.t3"] } },
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

/** Whether an Inferno yard's `type` has tiers of its own (`INFERNO_TOWER_TIER_ART`). */
export const hasInfernoTiers = (type: number, kind: YardKind): boolean =>
  kind === "inferno" && type in INFERNO_TOWER_TIER_ART;

/**
 * The new picture a building shows at `level` in a `kind` yard, or null with
 * the Classic look, for a tower not in `MODERN_TOWERS`, below level 1 and for
 * every type without new art.
 */
export const tierArtFor = (type: number, level: number, kind: YardKind = "main"): TierArt | null => {
  if (!newTowerArt()) return null;
  const inferno = hasInfernoTiers(type, kind);
  if ((inferno || type in TOWER_TIER_ART) && !MODERN_TOWERS.includes(type)) return null;
  let chosen: TierArt | null = null;
  for (const tier of (inferno ? INFERNO_TOWER_TIER_ART[type] : NEW_ART[type]) ?? []) {
    if (tier.from > level) break;
    chosen = tier;
  }
  return chosen;
};

/** World px a tower's gun stands above the Flash tower's at this level; 0 with the old art. */
export const tierLift = (type: number, level: number, kind: YardKind = "main"): number =>
  tierArtFor(type, level, kind)?.lift ?? 0;
