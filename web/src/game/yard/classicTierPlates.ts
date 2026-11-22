import { classicLook } from "@/game/classicLook";
import { artUrl } from "../../artUrl";
import type { ResolvedImage } from "./buildingArt";
import type { YardKind } from "./buildingCostData";
import { INFERNO_TOWER_TIER_ART, MODERN_TOWERS, TOWER_TIER_ART } from "./buildingArtTiers";

/**
 * The Classic look's tower tier plates (beta 9, owner 21 Nov 2026, desk card
 * b9-tier-look, option A): with the Classic look a defence tower keeps its
 * Flash picture, so a small painted plate bolted to its right side shows the
 * tier the Modern look shows as plain / gold / black: one bar on grey steel,
 * two on bronze, three on dark iron with a gold rim. Every tier has its plate,
 * tier 1 included. Only towers whose Modern art has three tiers get one, at
 * the same level splits; a visitor's copy of the level is already the tier's
 * first level (`server/src/services/base/viewMask.ts`), so an attacker sees
 * the right plate too.
 */

/** The plates' files, painted with Codex (`art-samples/tier-plates`), 26 x 17 world px at 1:1. */
export const TIER_PLATE_FILES: readonly string[] = [
  "/assets/buildings/tierplates/plate.t1@2x.png",
  "/assets/buildings/tierplates/plate.t2@2x.png",
  "/assets/buildings/tierplates/plate.t3@2x.png",
];

/** The plate's size in world px at 1:1 (its `@2x` file is twice that). */
export const TIER_PLATE_WIDTH = 26;
export const TIER_PLATE_HEIGHT = 17;

/** The plate picture for a tier (1-3), as the yard's texture cache asks for it. */
export const tierPlateImage = (tier: number): ResolvedImage | null => {
  const file = TIER_PLATE_FILES[tier - 1];
  return file ? { url: artUrl(file), x: 0, y: 0, frame: null } : null;
};

/**
 * The Modern tier (1-3) a tower at `level` shows in a `kind` yard, and so the
 * plate the Classic look puts on it, or 0 for none: with the Modern look,
 * below level 1, and for a tower without three tiers of Modern art (the Quake
 * Tower and the Spurtz Cannons keep one look for every level, so they have no
 * tier to show).
 */
export const classicTowerTier = (type: number, level: number, kind: YardKind): number => {
  if (!classicLook() || !(level >= 1) || !MODERN_TOWERS.includes(type)) return 0;
  const looks = kind === "inferno" && type in INFERNO_TOWER_TIER_ART ? INFERNO_TOWER_TIER_ART[type] : TOWER_TIER_ART[type];
  if (!looks || looks.length < 3) return 0;
  let tier = 0;
  looks.forEach((look, index) => {
    if (look.from <= level) tier = index + 1;
  });
  return tier;
};

/**
 * Where the plate goes on each Flash tower, from the building's origin (its
 * footprint's top corner): the middle of the plate's top edge. On the tower's
 * right side, its top edge at least 3 px below the battle health bar (which
 * runs from 14 to 8 px above the origin, `game/attack/buildingBars.ts`), so
 * neither ever hides the other; the plate grows downwards from it when the
 * camera zooms out (`tierPlateScale`).
 */
export const TIER_PLATE_SPOT: Readonly<Record<number, readonly [x: number, top: number]>> = {
  20: [19, -4], // Cannon Tower
  21: [21, -5], // Sniper Tower
  22: [25, -3], // Monster Bunker
  23: [19, -5], // Laser Tower
  25: [19, -5], // Tesla Tower
  115: [23, 11], // Aerial Defense Tower
  118: [23, 11], // Railgun
  132: [21, -1], // Magma Tower
};

/** An Inferno yard's own towers, drawn from the Inferno's pictures. */
export const TIER_PLATE_SPOT_INFERNO: Readonly<Record<number, readonly [x: number, top: number]>> = {
  20: [15, -1], // Blast Tower: on its drum
  21: [18, 10], // Sharpshooter: on its base ring, not beside its stem
  130: [15, -1], // Blast Tower
};

/** Where a `type`'s plate goes in a `kind` yard (see {@link TIER_PLATE_SPOT}). */
export const tierPlateSpot = (type: number, kind: YardKind): readonly [number, number] =>
  (kind === "inferno" ? TIER_PLATE_SPOT_INFERNO[type] : undefined) ?? TIER_PLATE_SPOT[type] ?? [21, -5];

/** The smallest the plate may look on screen, CSS px wide, and the most it grows past its world size. */
const MIN_SCREEN_WIDTH = 24;
const MAX_GROW = 1.7;

/**
 * The plate's scale at a camera zoom: its world size, grown when the camera
 * zooms out so it never reads narrower than 24 CSS px, up to 1.7 times.
 */
export const tierPlateScale = (zoom: number): number =>
  Math.min(MAX_GROW, Math.max(1, MIN_SCREEN_WIDTH / (TIER_PLATE_WIDTH * Math.max(zoom, 0.05))));
