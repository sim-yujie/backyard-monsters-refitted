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
 *   Laser, Aerial Defense, Railgun, Magma Tower, Spurtz Cannons, Inferno
 *   towers, Monster Bunker and Tesla);
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
 * - **The Tesla and the Monster Bunker are 3D** (owner, 29 Oct 2026,
 *   branch art/tesla-bunker-3d, `web/tools/tower-tiers/export3d_static.py`)
 *   and move as the Flash ones did, each with a strip of its own (`anim`):
 *   the Tesla's film rolls up its face through the 55 cells of Flash's
 *   charge, zap loop and wind-down (`towerFx.ts` teslaTick); the Bunker's
 *   shutters roll up into the deck, 15 cells as Flash's door, as its door
 *   opens in a battle, before its monsters come out, and down again after
 *   (`towerFx.ts` `onDoor`). At rest each shows cell 0. The Flash strips are not drawn
 *   over them.
 * - **Damaged** keeps the tier's picture and lets the yard's damage tint tell
 *   the story; **destroyed** is the Flash rubble, shared by every tier
 *   (the redesign brief: one rubble pile per building).
 * - **Shadows** are stand-ins: the silhouette leaned back, flattened and
 *   blurred, as on the sample sheets, until shadows are painted.
 *
 * The yard buildings are 3D too (owner, 31 Oct 2026, `BUILDING_3D_ART`): the
 * Twig Snapper, Pebble Shiner, Putty Squisher, Goo Factory, Storage Silo,
 * Hatchery, Monster Housing and Hatchery Control Center, from branches
 * art/buildings-3d-b6, -silo, -hatchery, -hcc and -housing
 * (`web/tools/tower-tiers/export3d_buildings.py`), with the Modern look;
 * the Classic look keeps the Flash ones. Then (owner, 1 Nov 2026: "let me
 * try out in game") the Flinger, Monster Juicer, Yard Planner, Map Room,
 * General Store, Blocks, Stone Block, Wild Monster Baiter, Catapult and
 * Champion Cage, and the Inferno's Blocks (`INFERNO_BUILDING_3D_ART`), each
 * from its own art/buildings-3d-<name> branch; and every 3D building's
 * damaged and destroyed looks (art/buildings-3d-damage and the same
 * branches), which take the place of the tinted whole look and the Flash
 * rubble. Then (owner, 1 Nov 2026: "keep as is for now and integrate it into
 * the game") the Monster Academy, art/buildings-3d-academy at tag
 * academy-3d-baseline-2026-11-01; then (owner, 1 Nov 2026: "put lab in
 * game") the Monster Lab, art/buildings-3d-lab at tag
 * lab-3d-baseline-2026-11-01; then (owner, 2 Nov 2026: "Champion chamber
 * pass") the Champion Chamber, art/buildings-3d-chamber at 40e38b1b8
 * (round 9, the cooling pipes); then (owner, 10 Nov 2026, Review Desk card
 * locker-fable-r2) the Monster Locker, art/locker-fable-2, the model made
 * from scratch from the Flash art, its four levels with their own damaged
 * looks and one wreck.
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
import { DECORATION_MODERN_ART } from "./decorationModernArt";
import { REVAMP_DECORATION_MODERN_ART } from "./revampDecorations";
import type { ArtAnim } from "./buildingArtData";
import type { YardKind } from "./buildingCostData";
import type { TurretAim } from "./turretAim";
import { TURRET_AIM } from "./turretAimData";
import { CLASSIC_OWN_ART, OBSERVATORY_MODERN_ART } from "./revampBuildings";

/**
 * The towers whose new art players see with the Modern look: the 3D Cannon
 * (20), Sniper (21), Laser (23), Aerial Defense (115), Railgun (118), Magma
 * Tower (132), Spurtz Cannons (136, 137), Monster Bunker (22), Tesla (25)
 * and Quake Tower (129, in both yards), and in an Inferno yard the 3D Blast Tower (20 and 130) and
 * Sharpshooter (21, `INFERNO_TOWER_TIER_ART`). A tower in `TOWER_TIER_ART`
 * but not here keeps its Flash look. The server's `TOWER_TIER_ART_LEVELS`
 * names the same.
 */
export const MODERN_TOWERS: readonly number[] = [20, 21, 22, 23, 25, 115, 118, 129, 130, 132, 136, 137];

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

/**
 * A tier's moving part, played as the Flash building's `anim` layer was
 * (`web/tools/tower-tiers/export3d_static.py`, `export3d_buildings.py`):
 * cell 0 is the tier at rest.
 */
export interface TierAnim {
  /** The strip, an `ArtAnim`: `[file, x, y, width, height, frames]`. */
  readonly strip: ArtAnim;
  /** Cells in a row, for a strip of several rows; one row without it. */
  readonly columns?: number;
  /**
   * Each cell is the whole building (the 3D Bunker: its open shutters leave
   * holes where `top` has them), so the strip stands in for `top`, which is
   * then only the still for the icons. Without it the cells are only the
   * part that moves (the 3D Tesla's film), drawn over `top`.
   */
  readonly whole?: boolean;
  /**
   * The building with its moving parts cut out (the 3D Twig Snapper without
   * its saw and gears, `export3d_buildings.py`), drawn under the cells in
   * place of `top`, which is then only the still for the icons. A part that
   * turns leaves nothing behind it this way, where `top` would show it at
   * rest under every cell.
   */
  readonly body?: TierImage;
  /**
   * Further strips beside `strip`, each run on its own as Flash's further
   * `anim` layers were (the 3D Monster Lab's two side doors' cogs, beside
   * its dome's brew), over the same `body`; one row each.
   */
  readonly more?: readonly ArtAnim[];
  /**
   * A building that moves when idle too (the Inferno's Incubator Control
   * Centre: its lava breathes, and its crystal pulses as well while it
   * hatches): the strip's first `rest` cells are its idle loop, the others its
   * working loop. Both take the same time round, the idle cells each shown for
   * longer, and a building that starts or stops working carries on from the
   * same point of the loop (`loopAnimLayers`).
   */
  readonly rest?: number;
}

/** A 3D building's damaged or destroyed look: one still and its shadow (none where it casts none). */
export interface TierState {
  readonly top: TierImage;
  readonly shadow: TierImage | null;
}

export interface TierArt {
  /** The first level that shows this picture. */
  readonly from: number;
  readonly top: TierImage;
  /** Null for a 3D look that casts no shadow (the Inferno's first wall, a low rim of rock). */
  readonly shadow: TierImage | null;
  /**
   * World px this picture's top stands above the Flash tower's: how much
   * higher the gun sits, so a tower's shots leave from it.
   */
  readonly lift: number;
  /** The turret that turns, for a tower with one; `top` is then only its still picture. */
  readonly turret?: TierTurret;
  /** The part that moves, for a tower without a turret whose 3D tiers animate (the Tesla, the Bunker), and a 3D building's. */
  readonly anim?: TierAnim;
  /**
   * A 3D building's damaged look, in place of the tinted whole one; it stands
   * still, as Flash's damaged buildings without a damaged strip do.
   */
  readonly damaged?: TierState;
  /**
   * A 3D building's destroyed look, in place of the Flash rubble; like
   * Flash's, one is often shared by all of a building's looks.
   */
  readonly destroyed?: TierState;
}

/** The three tiers of each tower, by type, lowest first. */
export const TOWER_TIER_ART: Readonly<Record<number, readonly TierArt[]>> = {
  // 20 Cannon Tower: 3D, tier 1 the steel bands (owner, 28 Oct 2026); the barrel stays 22 degrees up
  20: [
    { from: 1, top: ["top.t1@2x.webp", -33, -18], shadow: ["shadow.t1.jpg", -31, 22], lift: 0,
      turret: { body: ["body.t1@2x.webp", -33, -9], strip: ["turret.t1@2x.webp", -32, -36, 64, 51, 32], pivot: [0, 14.5],
        aim: TURRET_AIM["20.t1"] } },
    { from: 4, top: ["top.t2@2x.webp", -33, -33], shadow: ["shadow.t2.jpg", -31, 17], lift: 10,
      turret: { body: ["body.t2@2x.webp", -33, -24], strip: ["turret.t2@2x.webp", -32, -51, 64, 51, 32], pivot: [0, -1],
        aim: TURRET_AIM["20.t2"] } },
    { from: 7, top: ["top.t3@2x.webp", -33, -44], shadow: ["shadow.t3.jpg", -31, 12], lift: 23,
      turret: { body: ["body.t3@2x.webp", -33, -36], strip: ["turret.t3@2x.webp", -31, -61, 62, 48, 32], pivot: [0, -15.75],
        aim: TURRET_AIM["20.t3"] } },
  ],
  // 21 Sniper Tower: 3D, a square body as Flash's (owner, 2 Nov 2026; it was a hexagon)
  // a tall box on short legs as Flash's; each tier adds a 30 px section on top, so tier 3 stands 13 px above the painted one
  21: [
    { from: 1, top: ["top.t1@2x.webp", -40, -45], shadow: ["shadow.t1.jpg", -37, 12], lift: 1,
      turret: { body: ["body.t1@2x.webp", -40, -34], strip: ["turret.t1@2x.webp", -27, -51, 54, 40, 32], pivot: [0, -20],
        aim: TURRET_AIM["21.t1"] } },
    { from: 4, top: ["top.t2@2x.webp", -40, -75], shadow: ["shadow.t2.jpg", -37, 2], lift: 31,
      turret: { body: ["body.t2@2x.webp", -40, -64], strip: ["turret.t2@2x.webp", -27, -81, 54, 40, 32], pivot: [0, -50],
        aim: TURRET_AIM["21.t2"] } },
    { from: 7, top: ["top.t3@2x.webp", -40, -105], shadow: ["shadow.t3.jpg", -38, -4], lift: 61,
      turret: { body: ["body.t3@2x.webp", -40, -94], strip: ["turret.t3@2x.webp", -27, -111, 54, 40, 32], pivot: [0, -80],
        aim: TURRET_AIM["21.t3"] } },
  ],
  // 22 Monster Bunker: 3D, five levels, so 1-2, 3-4 and 5; its shutters roll up into the deck as it lets its monsters out
  22: [
    { from: 1, top: ["top.t1@2x.webp", -42, -20], shadow: ["shadow.t1.jpg", -43, 35], lift: 5,
      anim: { strip: ["anim.t1@2x.webp", -42, -20, 84, 86, 15], whole: true } },
    { from: 3, top: ["top.t2@2x.webp", -44, -32], shadow: ["shadow.t2.jpg", -43, 27], lift: 17,
      anim: { strip: ["anim.t2@2x.webp", -44, -32, 88, 99, 15], whole: true } },
    { from: 5, top: ["top.t3@2x.webp", -45, -43], shadow: ["shadow.t3.jpg", -42, 21], lift: 28,
      anim: { strip: ["anim.t3@2x.webp", -45, -43, 90, 110, 15], whole: true } },
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
  // 25 Tesla Tower: 3D; its film rolls up the face as Flash's strip played, charging, zapping and winding down
  25: [
    { from: 1, top: ["top.t1@2x.webp", -35, -62], shadow: ["shadow.t1.jpg", -31, 8], lift: 5,
      anim: { strip: ["anim.t1@2x.webp", -19, -20, 13, 52, 55] } },
    { from: 4, top: ["top.t2@2x.webp", -35, -85], shadow: ["shadow.t2.jpg", -31, -1], lift: 28,
      anim: { strip: ["anim.t2@2x.webp", -19, -41, 13, 73, 55] } },
    { from: 7, top: ["top.t3@2x.webp", -35, -106], shadow: ["shadow.t3.jpg", -32, -8], lift: 49,
      anim: { strip: ["anim.t3@2x.webp", -19, -61, 13, 93, 55] } },
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
  // 129 Quake Tower: 3D, one look for all its levels as Flash's (new art, branch art/quake-3d). Each cell of its strike
  // is the whole tower, stepped by the battle's `towerCell` events as Flash's anim.1.png was; Flash's shadow kept.
  // Flash's damaged look animates; the 3D one is a still, as the other 3D buildings' (`export3d_quake.py`).
  129: [
    { from: 1, top: ["top.t1@2x.webp", -40, -74], shadow: ["shadow.1.v2.jpg", -37, 17], lift: -1,
      anim: { strip: ["anim.t1@2x.webp", -40, -74, 80, 129, 33], columns: 25, whole: true },
      damaged: { top: ["top.t1.damaged@2x.webp", -42, -74], shadow: ["shadow.1.v2.jpg", -40, 16] },
      destroyed: { top: ["top.t1.destroyed@2x.webp", -47, -12], shadow: ["shadow.1.v2.jpg", -44, 10] } },
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

/**
 * The 3D yard buildings (owner, 31 Oct 2026: "All approved", then "Add 3d
 * buildings into game"), each modelled in Blender on Flash's pictures in the
 * game's own pixel frame and exported by
 * `web/tools/tower-tiers/export3d_buildings.py`: one look for each of Flash's
 * (the producers' levels 1, 3, 6 and 10, the Hatchery's 1, 2 and 3, the
 * Academy's 1 to 4), each on its own 3D ground shadow, no outline. What
 * moves in Flash moves here, cell for cell (`yardAnim.ts` runs them as it
 * ran Flash's): the parts that move
 * are a strip over a `body` without them, and the Storage Silo's cells are
 * the box its sack fills, its fill level as Flash's was. The Monster Lab's
 * three strips are its dome's brew and its two side doors' cogs, as Flash's
 * three, each the whole building round what moves, fading out over the body. The Monster Housing
 * and the Hatchery Control Center stand still, as Flash's did.
 */
export const BUILDING_3D_ART: Readonly<Record<number, readonly TierArt[]>> = {
  // 1 Twig Snapper: 3D, Flash's four looks (levels 1, 3, 6 and 10); its saw and gears turn
  1: [
    { from: 1, top: ["top.3d1@2x.webp", -33, -23], shadow: ["shadow.3d1.jpg", -35, 16], lift: 0,
      anim: { strip: ["anim.3d1@2x.webp", 1, 12, 20, 29, 34], body: ["body.3d1@2x.webp", -33, -23] },
      damaged: { top: ["top.3d1.damaged@2x.webp", -41, -23], shadow: ["shadow.3d1.damaged.jpg", -36, 22] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -40, 7], shadow: ["shadow.3d3.destroyed.jpg", -40, 25] } },
    { from: 3, top: ["top.3d3@2x.webp", -33, -37], shadow: ["shadow.3d3.jpg", -34, 12], lift: 0,
      anim: { strip: ["anim.3d3@2x.webp", 1, 7, 20, 29, 34], body: ["body.3d3@2x.webp", -33, -37] },
      damaged: { top: ["top.3d3.damaged@2x.webp", -39, -32], shadow: ["shadow.3d3.damaged.jpg", -33, 16] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -40, 7], shadow: ["shadow.3d3.destroyed.jpg", -40, 25] } },
    { from: 6, top: ["top.3d6@2x.webp", -33, -37], shadow: ["shadow.3d6.jpg", -34, 11], lift: 0,
      anim: { strip: ["anim.3d6@2x.webp", 1, 4, 32, 32, 34], body: ["body.3d6@2x.webp", -33, -37] },
      damaged: { top: ["top.3d6.damaged@2x.webp", -31, -32], shadow: ["shadow.3d6.damaged.jpg", -32, 13] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -40, 7], shadow: ["shadow.3d3.destroyed.jpg", -40, 25] } },
    { from: 10, top: ["top.3d10@2x.webp", -33, -53], shadow: ["shadow.3d10.jpg", -34, 11], lift: 0,
      anim: { strip: ["anim.3d10@2x.webp", 1, 4, 32, 32, 34], body: ["body.3d10@2x.webp", -33, -53] },
      damaged: { top: ["top.3d10.damaged@2x.webp", -33, -49], shadow: ["shadow.3d10.damaged.jpg", -32, 13] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -40, 7], shadow: ["shadow.3d3.destroyed.jpg", -40, 25] } },
  ],
  // 2 Pebble Shiner: 3D, Flash's four looks; it shines as Flash's did
  2: [
    { from: 1, top: ["top.3d1@2x.webp", -32, -18], shadow: ["shadow.3d1.jpg", -32, 12], lift: 0,
      anim: { strip: ["anim.3d1@2x.webp", -29, 6, 55, 27, 26], body: ["body.3d1@2x.webp", -32, -18] },
      damaged: { top: ["top.3d1.damaged@2x.webp", -33, -16], shadow: ["shadow.3d1.damaged.jpg", -32, 14] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -38, 12], shadow: ["shadow.3d3.destroyed.jpg", -39, 20] } },
    { from: 3, top: ["top.3d3@2x.webp", -33, -33], shadow: ["shadow.3d3.jpg", -32, 8], lift: 0,
      anim: { strip: ["anim.3d3@2x.webp", -30, 4, 57, 30, 26], body: ["body.3d3@2x.webp", -33, -33] },
      damaged: { top: ["top.3d3.damaged@2x.webp", -35, -20], shadow: ["shadow.3d3.damaged.jpg", -35, 14] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -38, 12], shadow: ["shadow.3d3.destroyed.jpg", -39, 20] } },
    { from: 6, top: ["top.3d6@2x.webp", -33, -40], shadow: ["shadow.3d6.jpg", -32, 6], lift: 0,
      anim: { strip: ["anim.3d6@2x.webp", -30, -4, 57, 38, 26], body: ["body.3d6@2x.webp", -33, -40] },
      damaged: { top: ["top.3d6.damaged@2x.webp", -35, -39], shadow: ["shadow.3d6.damaged.jpg", -32, 7] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -38, 12], shadow: ["shadow.3d3.destroyed.jpg", -39, 20] } },
    { from: 10, top: ["top.3d10@2x.webp", -33, -40], shadow: ["shadow.3d10.jpg", -33, 6], lift: 0,
      anim: { strip: ["anim.3d10@2x.webp", -30, -37, 63, 71, 24], body: ["body.3d10@2x.webp", -33, -40] },
      damaged: { top: ["top.3d10.damaged@2x.webp", -33, -41], shadow: ["shadow.3d10.damaged.jpg", -33, 5] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -38, 12], shadow: ["shadow.3d3.destroyed.jpg", -39, 20] } },
  ],
  // 3 Putty Squisher: 3D (v3), Flash's four looks; it squishes as Flash's did
  3: [
    { from: 1, top: ["top.3d1@2x.webp", -24, 4], shadow: ["shadow.3d1.jpg", -18, 27], lift: 0,
      anim: { strip: ["anim.3d1@2x.webp", -7, 7, 24, 16, 26], body: ["body.3d1@2x.webp", -24, 4] },
      damaged: { top: ["top.3d1.damaged@2x.webp", -36, 4], shadow: ["shadow.3d1.damaged.jpg", -29, 28] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -24, 12], shadow: ["shadow.3d3.destroyed.jpg", -10, 30] } },
    { from: 3, top: ["top.3d3@2x.webp", -31, -23], shadow: ["shadow.3d3.jpg", -30, 11], lift: 0,
      anim: { strip: ["anim.3d3@2x.webp", -5, -9, 22, 16, 26], body: ["body.3d3@2x.webp", -31, -23] },
      damaged: { top: ["top.3d3.damaged@2x.webp", -44, -20], shadow: ["shadow.3d3.damaged.jpg", -44, 11] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -24, 12], shadow: ["shadow.3d3.destroyed.jpg", -10, 30] } },
    { from: 6, top: ["top.3d6@2x.webp", -31, -46], shadow: ["shadow.3d6.jpg", -30, 11], lift: 0,
      anim: { strip: ["anim.3d6@2x.webp", -5, -9, 22, 16, 26], body: ["body.3d6@2x.webp", -31, -46] },
      damaged: { top: ["top.3d6.damaged@2x.webp", -32, -38], shadow: ["shadow.3d6.damaged.jpg", -33, 13] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -24, 12], shadow: ["shadow.3d3.destroyed.jpg", -10, 30] } },
    { from: 10, top: ["top.3d10@2x.webp", -32, -52], shadow: ["shadow.3d10.jpg", -32, 11], lift: 0,
      anim: { strip: ["anim.3d10@2x.webp", -5, -52, 39, 59, 25], body: ["body.3d10@2x.webp", -32, -45] },
      damaged: { top: ["top.3d10.damaged@2x.webp", -44, -43], shadow: ["shadow.3d10.damaged.jpg", -40, 13] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -24, 12], shadow: ["shadow.3d3.destroyed.jpg", -10, 30] } },
  ],
  // 4 Goo Factory: 3D, Flash's four looks; its pump's globs as Flash's
  4: [
    { from: 1, top: ["top.3d1@2x.webp", -25, -34], shadow: ["shadow.3d1.jpg", -26, 19], lift: 0,
      anim: { strip: ["anim.3d1@2x.webp", 4, 14, 18, 42, 26], body: ["body.3d1@2x.webp", -25, -34] },
      damaged: { top: ["top.3d1.damaged@2x.webp", -38, -25], shadow: ["shadow.3d1.damaged.jpg", -39, 17] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -42, 3], shadow: ["shadow.3d3.destroyed.jpg", -42, 23] } },
    { from: 3, top: ["top.3d3@2x.webp", -28, -34], shadow: ["shadow.3d3.jpg", -28, 15], lift: 0,
      anim: { strip: ["anim.3d3@2x.webp", 4, 13, 19, 43, 26], body: ["body.3d3@2x.webp", -28, -34] },
      damaged: { top: ["top.3d3.damaged@2x.webp", -41, -33], shadow: ["shadow.3d3.damaged.jpg", -37, 14] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -42, 3], shadow: ["shadow.3d3.destroyed.jpg", -42, 23] } },
    { from: 6, top: ["top.3d6@2x.webp", -31, -34], shadow: ["shadow.3d6.jpg", -30, 15], lift: 0,
      anim: { strip: ["anim.3d6@2x.webp", -19, 13, 42, 47, 26], body: ["body.3d6@2x.webp", -31, -34] },
      damaged: { top: ["top.3d6.damaged@2x.webp", -41, -28], shadow: ["shadow.3d6.damaged.jpg", -39, 14] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -42, 3], shadow: ["shadow.3d3.destroyed.jpg", -42, 23] } },
    { from: 10, top: ["top.3d10@2x.webp", -40, -47], shadow: ["shadow.3d10.jpg", -39, 12], lift: 0,
      anim: { strip: ["anim.3d10@2x.webp", -19, 13, 42, 47, 26], body: ["body.3d10@2x.webp", -40, -47] },
      damaged: { top: ["top.3d10.damaged@2x.webp", -42, -39], shadow: ["shadow.3d10.damaged.jpg", -43, 13] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -42, 3], shadow: ["shadow.3d3.destroyed.jpg", -42, 23] } },
  ],
  // 5 Flinger: 3D, Flash's four looks (the fourth also level 5), still as Flash's
  5: [
    { from: 1, top: ["top.3d1@2x.webp", -46, -46], shadow: ["shadow.3d1.jpg", -44, 20], lift: 0,
      damaged: { top: ["top.3d1.damaged@2x.webp", -62, -27], shadow: ["shadow.3d1.damaged.jpg", -62, 26] },
      destroyed: { top: ["top.3d4.destroyed@2x.webp", -61, -4], shadow: ["shadow.3d4.destroyed.jpg", -60, 20] } },
    { from: 2, top: ["top.3d2@2x.webp", -46, -38], shadow: ["shadow.3d2.jpg", -44, 20], lift: 0,
      damaged: { top: ["top.3d2.damaged@2x.webp", -62, -10], shadow: ["shadow.3d2.damaged.jpg", -62, 28] },
      destroyed: { top: ["top.3d4.destroyed@2x.webp", -61, -4], shadow: ["shadow.3d4.destroyed.jpg", -60, 20] } },
    { from: 3, top: ["top.3d3@2x.webp", -46, -44], shadow: ["shadow.3d3.jpg", -44, 14], lift: 0,
      damaged: { top: ["top.3d3.damaged@2x.webp", -62, -41], shadow: ["shadow.3d3.damaged.jpg", -62, 17] },
      destroyed: { top: ["top.3d4.destroyed@2x.webp", -61, -4], shadow: ["shadow.3d4.destroyed.jpg", -60, 20] } },
    { from: 4, top: ["top.3d4@2x.webp", -46, -67], shadow: ["shadow.3d4.jpg", -44, 17], lift: 0,
      damaged: { top: ["top.3d4.damaged@2x.webp", -62, -35], shadow: ["shadow.3d4.damaged.jpg", -62, 23] },
      destroyed: { top: ["top.3d4.destroyed@2x.webp", -61, -4], shadow: ["shadow.3d4.destroyed.jpg", -60, 20] } },
  ],
  // 6 Storage Silo: 3D, one look; its 26 cells are the sack's fill, as Flash's
  6: [
    { from: 1, top: ["top.3d1@2x.webp", -36, -51], shadow: ["shadow.3d1.jpg", -37, 32], lift: 0,
      anim: { strip: ["anim.3d1@2x.webp", -33, -21, 66, 70, 26], body: ["body.3d1@2x.webp", -36, -51] },
      damaged: { top: ["top.3d1.damaged@2x.webp", -40, -54], shadow: ["shadow.3d1.damaged.jpg", -37, 28] },
      destroyed: { top: ["top.3d1.destroyed@2x.webp", -44, -5], shadow: ["shadow.3d1.destroyed.jpg", -55, 19] } },
  ],
  // 8 Monster Locker: 3D (owner, 10 Nov 2026), Flash's four looks; its key and gears turn while it unlocks a monster.
  // Each cell is the whole machine round what moves, over a body with that box cut out. One wreck for every level,
  // as Flash's (`top.2.destroyed.png`).
  8: [
    { from: 1, top: ["top.3d1@2x.webp", -35, -34], shadow: ["shadow.3d1.jpg", -29, 27], lift: 0,
      anim: { strip: ["anim.3d1@2x.webp", -37, -36, 20, 20, 21], body: ["body.3d1@2x.webp", -31, -30] },
      damaged: { top: ["top.3d1.damaged@2x.webp", -56, -24], shadow: ["shadow.3d1.damaged.jpg", -39, 27] },
      destroyed: { top: ["top.3d2.destroyed@2x.webp", -48, -32], shadow: ["shadow.3d2.destroyed.jpg", -38, 25] } },
    { from: 2, top: ["top.3d2@2x.webp", -44, -90], shadow: ["shadow.3d2.jpg", -47, 26], lift: 0,
      anim: { strip: ["anim.3d2@2x.webp", -47, -92, 61, 67, 20], body: ["body.3d2@2x.webp", -44, -59] },
      damaged: { top: ["top.3d2.damaged@2x.webp", -70, -59], shadow: ["shadow.3d2.damaged.jpg", -54, 26] },
      destroyed: { top: ["top.3d2.destroyed@2x.webp", -48, -32], shadow: ["shadow.3d2.destroyed.jpg", -38, 25] } },
    { from: 3, top: ["top.3d3@2x.webp", -51, -83], shadow: ["shadow.3d3.jpg", -54, 14], lift: 0,
      anim: { strip: ["anim.3d3@2x.webp", -47, -85, 90, 80, 20], body: ["body.3d3@2x.webp", -51, -78] },
      damaged: { top: ["top.3d3.damaged@2x.webp", -64, -82], shadow: ["shadow.3d3.damaged.jpg", -63, 12] },
      destroyed: { top: ["top.3d2.destroyed@2x.webp", -48, -32], shadow: ["shadow.3d2.destroyed.jpg", -38, 25] } },
    { from: 4, top: ["top.3d4@2x.webp", -54, -95], shadow: ["shadow.3d4.jpg", -58, 11], lift: 0,
      anim: { strip: ["anim.3d4@2x.webp", -48, -86, 95, 96, 21], body: ["body.3d4@2x.webp", -54, -95] },
      damaged: { top: ["top.3d4.damaged@2x.webp", -69, -95], shadow: ["shadow.3d4.damaged.jpg", -64, 8] },
      destroyed: { top: ["top.3d2.destroyed@2x.webp", -48, -32], shadow: ["shadow.3d2.destroyed.jpg", -38, 25] } },
  ],
  // 9 Monster Juicer: 3D, one look; its 51 cells as Flash's
  9: [
    { from: 1, top: ["top.3d1@2x.webp", -44, -22], shadow: ["shadow.3d1.jpg", -44, 27], lift: 0,
      anim: { strip: ["anim.3d1@2x.webp", -42, -22, 84, 68, 51], columns: 24, body: ["body.3d1@2x.webp", -44, -7] },
      damaged: { top: ["top.3d1.damaged@2x.webp", -56, -7], shadow: ["shadow.3d1.damaged.jpg", -55, 27] },
      destroyed: { top: ["top.3d1.destroyed@2x.webp", -51, 4], shadow: ["shadow.3d1.destroyed.jpg", -51, 15] } },
  ],
  // 10 Yard Planner: 3D, one look, still as Flash's
  10: [
    { from: 1, top: ["top.3d1@2x.webp", -46, -30], shadow: ["shadow.3d1.jpg", -46, 33], lift: 0,
      damaged: { top: ["top.3d1.damaged@2x.webp", -48, -17], shadow: ["shadow.3d1.damaged.jpg", -46, 33] },
      destroyed: { top: ["top.3d1.destroyed@2x.webp", -59, 13], shadow: ["shadow.3d1.destroyed.jpg", -59, 19] } },
  ],
  // 11 Map Room: 3D, one look, still as Flash's
  11: [
    { from: 1, top: ["top.3d1@2x.webp", -57, -67], shadow: ["shadow.3d1.jpg", -49, 22], lift: 0,
      damaged: { top: ["top.3d1.damaged@2x.webp", -74, -45], shadow: ["shadow.3d1.damaged.jpg", -73, 20] },
      destroyed: { top: ["top.3d1.destroyed@2x.webp", -77, 5], shadow: ["shadow.3d1.destroyed.jpg", -72, 34] } },
  ],
  // 12 General Store: 3D, one look, still as Flash's
  12: [
    { from: 1, top: ["top.3d1@2x.webp", -42, -38], shadow: ["shadow.3d1.jpg", -36, 1], lift: 0 },
  ],
  // 13 Hatchery: 3D, Flash's three looks; its crank turns while it hatches
  13: [
    { from: 1, top: ["top.3d1@2x.webp", -50, -67], shadow: ["shadow.3d1.jpg", -26, 21], lift: 0,
      anim: { strip: ["anim.3d1@2x.webp", -47, -100, 93, 76, 31], columns: 22, body: ["body.3d1@2x.webp", -50, -52] },
      damaged: { top: ["top.3d1.damaged@2x.webp", -58, -93], shadow: ["shadow.3d1.damaged.jpg", -74, 27] },
      destroyed: { top: ["top.3d2.destroyed@2x.webp", -46, 5], shadow: ["shadow.3d2.destroyed.jpg", -46, 42] } },
    { from: 2, top: ["top.3d2@2x.webp", -51, -114], shadow: ["shadow.3d2.jpg", -51, 15], lift: 0,
      anim: { strip: ["anim.3d2@2x.webp", -13, -121, 75, 87, 31], columns: 27, body: ["body.3d2@2x.webp", -51, -114] },
      damaged: { top: ["top.3d2.damaged@2x.webp", -51, -108], shadow: ["shadow.3d2.damaged.jpg", -51, 30] },
      destroyed: { top: ["top.3d2.destroyed@2x.webp", -46, 5], shadow: ["shadow.3d2.destroyed.jpg", -46, 42] } },
    { from: 3, top: ["top.3d3@2x.webp", -51, -113], shadow: ["shadow.3d3.jpg", -51, 13], lift: 0,
      anim: { strip: ["anim.3d3@2x.webp", 7, -102, 82, 92, 31], columns: 24, body: ["body.3d3@2x.webp", -51, -113] },
      damaged: { top: ["top.3d3.damaged@2x.webp", -58, -117], shadow: ["shadow.3d3.damaged.jpg", -72, 28] },
      destroyed: { top: ["top.3d2.destroyed@2x.webp", -46, 5], shadow: ["shadow.3d2.destroyed.jpg", -46, 42] } },
  ],
  // 15 Monster Housing: 3D, one look, still as Flash's
  15: [
    { from: 1, top: ["top.3d1@2x.webp", -107, 10], shadow: ["shadow.3d1.jpg", -102, 29], lift: 0,
      damaged: { top: ["top.3d1.damaged@2x.webp", -105, 11], shadow: ["shadow.3d1.damaged.jpg", -105, 29] },
      destroyed: { top: ["top.3d1.destroyed@2x.webp", -105, 29], shadow: ["shadow.3d1.destroyed.jpg", -102, 35] } },
  ],
  // 16 Hatchery Control Center: 3D, one look, still as Flash's
  16: [
    { from: 1, top: ["top.3d1@2x.webp", -40, -57], shadow: ["shadow.3d1.jpg", -40, 21], lift: 0,
      damaged: { top: ["top.3d1.damaged@2x.webp", -53, -51], shadow: ["shadow.3d1.damaged.jpg", -40, 20] },
      destroyed: { top: ["top.3d1.destroyed@2x.webp", -56, -6], shadow: ["shadow.3d1.destroyed.jpg", -72, 36] } },
  ],
  // 17 Block: 3D, Flash's five looks, still
  17: [
    { from: 1, top: ["top.3d1@2x.webp", -21, -21], shadow: ["shadow.3d1.jpg", -20, -2], lift: 0,
      damaged: { top: ["top.3d1.damaged@2x.webp", -21, -21], shadow: ["shadow.3d1.damaged.jpg", -20, -2] },
      destroyed: { top: ["top.3d1.destroyed@2x.webp", -20, -6], shadow: ["shadow.3d1.destroyed.jpg", -20, 7] } },
    { from: 2, top: ["top.3d2@2x.webp", -20, -20], shadow: ["shadow.3d2.jpg", -20, -1], lift: 0,
      damaged: { top: ["top.3d2.damaged@2x.webp", -20, -20], shadow: ["shadow.3d2.damaged.jpg", -20, -1] },
      destroyed: { top: ["top.3d2.destroyed@2x.webp", -17, 0], shadow: ["shadow.3d2.destroyed.jpg", -17, 1] } },
    { from: 3, top: ["top.3d3@2x.webp", -20, -21], shadow: ["shadow.3d3.jpg", -8, -2], lift: 0,
      damaged: { top: ["top.3d3.damaged@2x.webp", -20, -21], shadow: ["shadow.3d3.damaged.jpg", -8, 0] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -20, -2], shadow: ["shadow.3d3.destroyed.jpg", -16, 8] } },
    { from: 4, top: ["top.3d4@2x.webp", -20, -21], shadow: ["shadow.3d4.jpg", -20, -2], lift: 0,
      damaged: { top: ["top.3d4.damaged@2x.webp", -20, -21], shadow: ["shadow.3d4.damaged.jpg", -20, -2] },
      destroyed: { top: ["top.3d4.destroyed@2x.webp", -15, 1], shadow: ["shadow.3d4.destroyed.jpg", 1, 9] } },
    { from: 5, top: ["top.3d5@2x.webp", -20, -20], shadow: ["shadow.3d5.jpg", -21, -2], lift: 0,
      damaged: { top: ["top.3d5.damaged@2x.webp", -20, -20], shadow: ["shadow.3d5.damaged.jpg", -21, -2] },
      destroyed: { top: ["top.3d5.destroyed@2x.webp", -18, -1], shadow: ["shadow.3d5.destroyed.jpg", -18, 5] } },
  ],
  // 18 Stone Block: 3D, one look, still
  18: [
    { from: 1, top: ["top.3d1@2x.webp", -16, -19], shadow: ["shadow.3d1.jpg", -16, -1], lift: 0,
      damaged: { top: ["top.3d1.damaged@2x.webp", -16, -19], shadow: ["shadow.3d1.damaged.jpg", -16, -1] },
      destroyed: { top: ["top.3d1.destroyed@2x.webp", -11, -2], shadow: ["shadow.3d1.destroyed.jpg", -11, 4] } },
  ],
  // 19 Wild Monster Baiter: 3D, one look; its 41 cells as Flash's
  19: [
    { from: 1, top: ["top.3d1@2x.webp", -40, -23], shadow: ["shadow.3d1.jpg", -41, 30], lift: 0,
      anim: { strip: ["anim.3d1@2x.webp", -33, -24, 66, 72, 41], columns: 31, body: ["body.3d1@2x.webp", -40, -8] },
      damaged: { top: ["top.3d1.damaged@2x.webp", -40, -17], shadow: ["shadow.3d1.damaged.jpg", -41, 30] },
      destroyed: { top: ["top.3d1.destroyed@2x.webp", -47, 16], shadow: ["shadow.3d1.destroyed.jpg", -47, 27] } },
  ],
  // 26 Monster Academy: 3D, Flash's four looks (the fourth also level 5); its gold cogs turn while it trains
  26: [
    { from: 1, top: ["top.3d1@2x.webp", -42, -12], shadow: ["shadow.3d1.jpg", -43, 24], lift: 0,
      anim: { strip: ["anim.3d1@2x.webp", -18, -13, 40, 24, 21], body: ["body.3d1@2x.webp", -42, -12] },
      damaged: { top: ["top.3d1.damaged@2x.webp", -72, -12], shadow: ["shadow.3d1.damaged.jpg", -71, 24] },
      destroyed: { top: ["top.3d1.destroyed@2x.webp", -61, 12], shadow: ["shadow.3d1.destroyed.jpg", -60, 17] } },
    { from: 2, top: ["top.3d2@2x.webp", -42, -21], shadow: ["shadow.3d2.jpg", -43, 24], lift: 0,
      anim: { strip: ["anim.3d2@2x.webp", -18, -13, 40, 24, 21], body: ["body.3d2@2x.webp", -42, -21] },
      damaged: { top: ["top.3d2.damaged@2x.webp", -72, -24], shadow: ["shadow.3d2.damaged.jpg", -72, 24] },
      destroyed: { top: ["top.3d2.destroyed@2x.webp", -61, 12], shadow: ["shadow.3d2.destroyed.jpg", -60, 17] } },
    { from: 3, top: ["top.3d3@2x.webp", -51, -18], shadow: ["shadow.3d3.jpg", -52, 23], lift: 0,
      anim: { strip: ["anim.3d3@2x.webp", -19, -19, 38, 23, 21], body: ["body.3d3@2x.webp", -51, -18] },
      damaged: { top: ["top.3d3.damaged@2x.webp", -76, -18], shadow: ["shadow.3d3.damaged.jpg", -92, 9] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -61, 12], shadow: ["shadow.3d3.destroyed.jpg", -60, 17] } },
    { from: 4, top: ["top.3d4@2x.webp", -51, -37], shadow: ["shadow.3d4.jpg", -51, 17], lift: 0,
      anim: { strip: ["anim.3d4@2x.webp", -19, -38, 38, 23, 21], body: ["body.3d4@2x.webp", -51, -37] },
      damaged: { top: ["top.3d4.damaged@2x.webp", -76, -44], shadow: ["shadow.3d4.damaged.jpg", -90, 0] },
      destroyed: { top: ["top.3d4.destroyed@2x.webp", -61, 12], shadow: ["shadow.3d4.destroyed.jpg", -60, 17] } },
  ],
  // 51 Catapult: 3D, Flash's three looks (the third also level 4), still
  51: [
    { from: 1, top: ["top.3d1@2x.webp", -43, 12], shadow: ["shadow.3d1.jpg", -41, 34], lift: 0,
      damaged: { top: ["top.3d1.damaged@2x.webp", -51, 4], shadow: ["shadow.3d1.damaged.jpg", -49, 34] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -48, 22], shadow: ["shadow.3d3.destroyed.jpg", -49, 26] } },
    { from: 2, top: ["top.3d2@2x.webp", -44, -23], shadow: ["shadow.3d2.jpg", -41, 21], lift: 0,
      damaged: { top: ["top.3d2.damaged@2x.webp", -52, -23], shadow: ["shadow.3d2.damaged.jpg", -49, 23] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -48, 22], shadow: ["shadow.3d3.destroyed.jpg", -49, 26] } },
    { from: 3, top: ["top.3d3@2x.webp", -44, -29], shadow: ["shadow.3d3.jpg", -41, 21], lift: 0,
      damaged: { top: ["top.3d3.damaged@2x.webp", -52, -29], shadow: ["shadow.3d3.damaged.jpg", -49, 22] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -48, 22], shadow: ["shadow.3d3.destroyed.jpg", -49, 26] } },
  ],
  // 114 Champion Cage: 3D, one look, still as Flash's
  114: [
    { from: 1, top: ["top.3d1@2x.webp", -128, -12], shadow: ["shadow.3d1.jpg", -128, 17], lift: 0,
      damaged: { top: ["top.3d1.damaged@2x.webp", -128, -12], shadow: ["shadow.3d1.damaged.jpg", -128, 17] },
      destroyed: { top: ["top.3d1.destroyed@2x.webp", -128, 11], shadow: ["shadow.3d1.destroyed.jpg", -128, 18] } },
  ],
  // 116 Monster Lab: 3D, Flash's one look for every level; its brew and its side doors' cogs move while it researches
  116: [
    { from: 1, top: ["top.3d1@2x.webp", -75, -92], shadow: ["shadow.3d1.jpg", -74, 5], lift: 0,
      anim: { strip: ["anim.3d1.dome@2x.webp", -22, -24, 48, 40, 32], body: ["body.3d1@2x.webp", -75, -92],
        more: [["anim.3d1.doorL@2x.webp", -68, 26, 34, 35, 5], ["anim.3d1.doorR@2x.webp", 40, 26, 27, 33, 5]] },
      damaged: { top: ["top.3d1.damaged@2x.webp", -75, -81], shadow: ["shadow.3d1.damaged.jpg", -72, 11] },
      destroyed: { top: ["top.3d1.destroyed@2x.webp", -75, -33], shadow: ["shadow.3d1.destroyed.jpg", -74, 10] } },
  ],
  // 24 Booby Trap: 3D (art/traps-3d), one look; destroyed is the fired trap (the spikes lying round a burnt patch)
  24: [
    { from: 1, top: ["top.3d1@2x.webp", -14, 2], shadow: ["shadow.3d1.jpg", -1, 7], lift: 0,
      destroyed: { top: ["top.3d1.destroyed@2x.webp", -13, 3], shadow: null } },
  ],
  // 117 Heavy Trap: 3D (art/traps-3d), one look; destroyed is the fired trap (the jaws shut in an arch)
  117: [
    { from: 1, top: ["top.3d1@2x.webp", -13, -2], shadow: ["shadow.3d1.jpg", -6, 5], lift: 0,
      destroyed: { top: ["top.3d1.destroyed@2x.webp", -13, 1], shadow: ["shadow.3d1.destroyed.jpg", 0, 7] } },
  ],
  // 119 Champion Chamber: 3D, Flash's one look, still as Flash's
  119: [
    { from: 1, top: ["top.3d1@2x.webp", -66, -61], shadow: ["shadow.3d1.jpg", -65, 17], lift: 0,
      damaged: { top: ["top.3d1.damaged@2x.webp", -66, -61], shadow: ["shadow.3d1.damaged.jpg", -66, 19] },
      destroyed: { top: ["top.3d1.destroyed@2x.webp", -66, -25], shadow: ["shadow.3d1.destroyed.jpg", -66, 23] } },
  ],  // 150 Observatory: this project's own (alliances), 3D design C, the lookout deck; it idles (`revampBuildings.ts`)
  150: OBSERVATORY_MODERN_ART,
};

/**
 * The Inferno's own 3D buildings, drawn in an Inferno yard from the
 * Inferno's folders: its Bone Cruncher (1, `buildings/iboneharvester/`), three
 * tiers from art/buildings-3d-inferno (owner, 6 Nov 2026: "3d bone crusher has
 * been approved"), exported by `export3d_buildings.py bone`, which split at
 * levels 3 and 7 where the main yard's harvesters split at 3, 6 and 10 (the
 * server's `INFERNO_ART_LEVELS`); its Blocks (17, `buildings/iwalls/`), three looks as
 * Flash's, the first a low rim of rock that casts no shadow; and its
 * Incubator Control Centre (16, in the Hatchery Control Center's folder,
 * which the Inferno's row shares), look C from art/icc-inferno-looks (owner,
 * 2 Nov 2026: "I want to see it in the inferno + the soft animated glow of the
 * lava"), exported by `export3d_buildings.py icc`.
 */
export const INFERNO_BUILDING_3D_ART: Readonly<Record<number, readonly TierArt[]>> = {
  // 1 Bone Cruncher: 3D (owner, 6 Nov 2026: "3d bone crusher has been approved"), the clean-room model's three tiers,
  // levels 1-2, 3-6 and 7-10 as the model splits them (Flash's has two looks, from 1 and 3); bones tip into the bowl
  // and the rollers crunch them, 36 cells round. Exported grown 1.2x about its middle on the ground (9 Nov 2026: the
  // model came out smaller than Flash's in the same spot; `grow` in export3d_buildings.py). No damaged or destroyed
  // look of its own yet: the damaged one is the whole look tinted, the destroyed Flash's.
  1: [
    { from: 1, top: ["top.3d1@2x.webp", -48, -29], shadow: ["shadow.3d1.jpg", -46, 18], lift: 0,
      anim: { strip: ["anim.3d1@2x.webp", -28, -23, 67, 67, 36], columns: 30, body: ["body.3d1@2x.webp", -48, -29] } },
    { from: 3, top: ["top.3d3@2x.webp", -48, -37], shadow: ["shadow.3d3.jpg", -46, 17], lift: 0,
      anim: { strip: ["anim.3d3@2x.webp", -28, -37, 62, 85, 36], columns: 33, body: ["body.3d3@2x.webp", -48, -37] } },
    { from: 7, top: ["top.3d7@2x.webp", -48, -37], shadow: ["shadow.3d7.jpg", -47, 16], lift: 0,
      anim: { strip: ["anim.3d7@2x.webp", -29, -37, 80, 85, 36], columns: 25, body: ["body.3d7@2x.webp", -48, -37] } },
  ],
  // 3 Sulfur Swirler: 3D (owner, 14 Nov 2026, Review Desk), the clean-room model of art/sulfur-3d
  // (`export3d_buildings.py sulfur`), three tiers at levels 1-2, 3-6 and 7-10 as the Bone Cruncher's (Flash's has two
  // looks, from 1 and 3; the top tier adds the side boiler, the big gear and the lit firebox). The chain runs round its
  // wheels, a lump of sulfur goes up the gold pipe and the sulfur swirls behind the window, in Flash's 51 cells
  // (levels 1-2) and 45. Each tier has its own damaged still (sooted, holes in the shell running sulfur, the pipe off
  // its hood, the chain drive askew, the window dim and cracked, plates and stones at its feet), one rough pass
  // (`sulfur:damaged`). Destroyed is Flash's rubble, as the others'.
  3: [
    { from: 1, top: ["top.3d1@2x.webp", -36, -59], shadow: ["shadow.3d1.jpg", -10, 10], lift: 0,
      anim: { strip: ["anim.3d1@2x.webp", -37, -56, 52, 92, 51], columns: 39, body: ["body.3d1@2x.webp", -36, -59] },
      damaged: { top: ["top.3d1.damaged@2x.webp", -42, -55], shadow: ["shadow.3d1.damaged.jpg", -10, 10] } },
    { from: 3, top: ["top.3d3@2x.webp", -37, -61], shadow: ["shadow.3d3.jpg", -16, 18], lift: 0,
      anim: { strip: ["anim.3d3@2x.webp", -38, -61, 50, 119, 45], columns: 40, body: ["body.3d3@2x.webp", -37, -59] },
      damaged: { top: ["top.3d3.damaged@2x.webp", -37, -54], shadow: ["shadow.3d3.damaged.jpg", -16, 17] } },
    { from: 7, top: ["top.3d7@2x.webp", -40, -61], shadow: ["shadow.3d7.jpg", -26, 17], lift: 0,
      anim: { strip: ["anim.3d7@2x.webp", -38, -61, 50, 119, 45], columns: 40, body: ["body.3d7@2x.webp", -40, -59] },
      damaged: { top: ["top.3d7.damaged@2x.webp", -40, -54], shadow: ["shadow.3d7.damaged.jpg", -28, 16] } },
  ],
  // 16 Incubator Control Centre: 3D look C, on a small magma pool. Each cell is the whole building: 32 cells of its
  // idle loop (the lava's light breathing), then 64 of its loop while it hatches (the crystal pulsing twice as well).
  // No damaged or destroyed look of its own yet: the damaged one is the whole look tinted, the destroyed Flash's.
  16: [
    { from: 1, top: ["top.i3d1@2x.webp", -67, -53], shadow: ["shadow.i3d1.jpg", -65, 24], lift: 0,
      anim: { strip: ["anim.i3d1@2x.webp", -67, -60, 133, 160, 96], columns: 15, whole: true, rest: 32 } },
  ],
  // 17 Block: 3D, the Inferno's three looks, still
  17: [
    { from: 1, top: ["top.3d1@2x.webp", -24, -6], shadow: null, lift: 0,
      damaged: { top: ["top.3d1.damaged@2x.webp", -24, -7], shadow: null },
      destroyed: { top: ["top.3d1.destroyed@2x.webp", -20, 0], shadow: null } },
    { from: 2, top: ["top.3d2@2x.webp", -21, -10], shadow: ["shadow.3d2.jpg", -21, 4], lift: 0,
      damaged: { top: ["top.3d2.damaged@2x.webp", -21, -9], shadow: ["shadow.3d2.damaged.jpg", -21, 4] },
      destroyed: { top: ["top.3d2.destroyed@2x.webp", -21, -2], shadow: ["shadow.3d2.destroyed.jpg", -21, 7] } },
    { from: 3, top: ["top.3d3@2x.webp", -20, -24], shadow: ["shadow.3d3.jpg", -20, -3], lift: 0,
      damaged: { top: ["top.3d3.damaged@2x.webp", -20, -24], shadow: ["shadow.3d3.damaged.jpg", -20, -3] },
      destroyed: { top: ["top.3d3.destroyed@2x.webp", -20, -3], shadow: ["shadow.3d3.destroyed.jpg", -17, 7] } },
  ],
};

/**
 * The Inferno's own painted buildings, drawn in an Inferno yard from the Inferno's folders: its Under Hall (14, the
 * centre building of every Inferno yard, `buildings/itownhall/`; owner on the Review Desk, 6 Nov 2026: "Underhall can
 * be repainted"), painted by Codex from Flash's three looks (levels 1, 2 and 3 to 6) in the finish of the painted
 * Town Hall, and fitted onto Flash's footprint by `web/tools/underhall-repaint/` (`finish.py`, then `export.py`), on
 * Flash's own shadows. Each look has its own damaged and destroyed picture, as Flash's has; like Flash's, it stands
 * still. The main yard's Town Hall (also type 14) keeps `TOWN_HALL_ART`.
 */
export const INFERNO_PAINTED_BUILDING_ART: Readonly<Record<number, readonly TierArt[]>> = {
  // 14 Under Hall: painted, Flash's three looks, each damaged and destroyed in paint too
  14: [
    { from: 1, top: ["top.c1@2x.webp", -52, -30], shadow: ["shadow.1.v2.jpg", -65, 49], lift: 0,
      damaged: { top: ["top.c1.damaged@2x.webp", -57, -38], shadow: ["shadow.1.damaged.v2.jpg", -65, 47] },
      destroyed: { top: ["top.c1.destroyed@2x.webp", -66, 10], shadow: ["shadow.1.destroyed.v2.jpg", -68, 43] } },
    { from: 2, top: ["top.c2@2x.webp", -51, -58], shadow: ["shadow.2.v2.jpg", -70, 35], lift: 0,
      damaged: { top: ["top.c2.damaged@2x.webp", -50, -47], shadow: ["shadow.2.damaged.v2.jpg", -59, 44] },
      destroyed: { top: ["top.c2.destroyed@2x.webp", -53, 1], shadow: ["shadow.2.destroyed.v2.jpg", -76, 33] } },
    { from: 3, top: ["top.c3@2x.webp", -51, -54], shadow: ["shadow.3.v2.jpg", -74, 35], lift: 0,
      damaged: { top: ["top.c3.damaged@2x.webp", -56, -65], shadow: ["shadow.3.damaged.v2.jpg", -73, 33] },
      destroyed: { top: ["top.c3.destroyed@2x.webp", -61, -21], shadow: ["shadow.3.destroyed.v2.jpg", -75, 29] } },
  ],
};

/**
 * Every type with new art the old-art switch turns back: the towers, the Town Hall (14), the 3D buildings,
 * the Flash decorations' Modern look (`decorationModernArt.ts`) and this project's own decorations' Modern
 * look (`revampDecorations.ts`).
 */
const NEW_ART: Readonly<Record<number, readonly TierArt[]>> = {
  ...TOWER_TIER_ART,
  14: TOWN_HALL_ART,
  ...BUILDING_3D_ART,
  ...DECORATION_MODERN_ART,
  ...REVAMP_DECORATION_MODERN_ART,
};

/**
 * Whether an Inferno yard's `type` has tiers of its own (`INFERNO_TOWER_TIER_ART`,
 * `INFERNO_BUILDING_3D_ART`, `INFERNO_PAINTED_BUILDING_ART`).
 */
export const hasInfernoTiers = (type: number, kind: YardKind): boolean =>
  kind === "inferno" &&
  (type in INFERNO_TOWER_TIER_ART || type in INFERNO_BUILDING_3D_ART || type in INFERNO_PAINTED_BUILDING_ART);

/**
 * The new picture a building shows at `level` in a `kind` yard, or null with
 * the Classic look, for a tower not in `MODERN_TOWERS`, below level 1, for
 * every type without new art and for a 3D building in an Inferno yard with
 * no Inferno 3D or painted look of its own (it keeps its Inferno art until
 * one is approved).
 */
export const tierArtFor = (type: number, level: number, kind: YardKind = "main"): TierArt | null => {
  // This project's own buildings (the Observatory) have a Classic look of their own; Flash has none to fall back on.
  if (!newTowerArt()) return kind === "inferno" ? null : pickTier(CLASSIC_OWN_ART[type], level);
  let looks: readonly TierArt[] | undefined;
  if (kind === "inferno" && type in INFERNO_BUILDING_3D_ART) {
    looks = INFERNO_BUILDING_3D_ART[type];
  } else if (kind === "inferno" && type in INFERNO_PAINTED_BUILDING_ART) {
    looks = INFERNO_PAINTED_BUILDING_ART[type];
  } else if (kind === "inferno" && type in BUILDING_3D_ART) {
    return null;
  } else {
    const inferno = kind === "inferno" && type in INFERNO_TOWER_TIER_ART;
    if ((inferno || type in TOWER_TIER_ART) && !MODERN_TOWERS.includes(type)) return null;
    looks = inferno ? INFERNO_TOWER_TIER_ART[type] : NEW_ART[type];
  }
  return pickTier(looks, level);
};

/** The last of `looks` (lowest first) that starts at or below `level`, or null. */
const pickTier = (looks: readonly TierArt[] | undefined, level: number): TierArt | null => {
  let chosen: TierArt | null = null;
  for (const tier of looks ?? []) {
    if (tier.from > level) break;
    chosen = tier;
  }
  return chosen;
};

/** World px a tower's gun stands above the Flash tower's at this level; 0 with the old art. */
export const tierLift = (type: number, level: number, kind: YardKind = "main"): number =>
  tierArtFor(type, level, kind)?.lift ?? 0;
