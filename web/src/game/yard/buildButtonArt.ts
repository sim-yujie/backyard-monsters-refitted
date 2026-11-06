import { classicLook } from "@/game/classicLook";
import { MODERN_BUTTON_FILE } from "./buildButtonModernData";
import type { YardKind } from "./buildingCosts";

/**
 * The build menu's pictures: the original's building buttons, 120 × 160 JPEGs
 * in `server/public/assets/buildingbuttons/` (#157).
 *
 * A tile shows `<type>.jpg`, or the props table's `buildingbuttons[0]` where it
 * names one — only the Block, whose button is `17.1`
 * (`BUILDINGBUTTON.as:86-93`) — or, for the Victory Totem Pole, which has only
 * a button per level on disk, its first (#128). A type the yard holds none of and cannot build
 * yet shows its dark silhouette instead, `upgradeImgData[first].silhouette_img`
 * (`BUILDINGBUTTON.as:74-84`). The props table names a silhouette for every
 * type, but only these are on disk; the rest are drawn dark by the menu's CSS
 * from the plain picture.
 *
 * With the Modern look (owner, 2 Nov 2026: "refresh the images in 'buildings'
 * for both overworld and inferno to use our new look for the modern
 * setting"), a building that has a new look in the yard shows that look
 * instead: {@link buildPicture}, from `MODERN_BUTTON_FILE`, which
 * `web/tools/build-pictures/make.py` makes from the yard's own art. With the
 * Classic look, and for a building with no new look yet, Flash's button.
 */

/** Where the game server keeps the art. Proxied in development. */
const ROOT = "/assets/buildingbuttons/";

/**
 * Types whose button is not simply `<type>.jpg`, the main yard's Inferno
 * buildings among them (`YARD_PROPS.as` `buildingbuttons`, Inferno WP 6.1).
 */
const BUTTON_FILE: Readonly<Record<number, string>> = {
  17: "17.1.jpg",
  121: "121.bb1.jpg",
  129: "quake_tower.v2.jpg",
  132: "magma_tower.v2.jpg",
  133: "seige_factory.jpg",
  134: "siege_lab.jpg",
};

/** The silhouettes that exist, by type (`YARD_PROPS.as` `silhouette_img`). */
export const SILHOUETTE_FILE: Readonly<Record<number, string>> = {
  6: "6.silhouette.jpg",
  8: "8.2.silhouette.jpg",
  9: "9.silhouette.jpg",
  10: "10.silhouette.jpg",
  13: "13.2.silhouette.jpg",
  16: "16.silhouette.jpg",
  17: "17.1.silhouette.jpg",
  19: "19.silhouette.jpg",
  22: "22.silhouette.jpg",
  23: "23.silhouette.jpg",
  24: "24.silhouette.jpg",
  25: "25.silhouette.jpg",
  26: "26.2.silhouette.jpg",
  51: "51.3.silhouette.jpg",
  114: "114.silhouette.jpg",
  115: "115.silhouette.jpg",
  116: "116.silhouette.jpg",
  117: "117.silhouette.jpg",
  118: "118.silhouette.jpg",
  119: "119.silhouette.jpg",
  129: "quake_tower.v2.silhouette.jpg",
  132: "magma_tower.v2.silhouette.jpg",
};

/**
 * The Inferno yard's buttons (Inferno WP 1.19): every Inferno type's own
 * `buildingbuttons[0]` (`client/scripts/INFERNOYARDPROPS.as`), all of which
 * are on disk. The Block's first is Brimstone, `coal_wall.v3`. The Monster
 * Juicer names none, so it shows `9.jpg`, as on the surface. The Yard
 * Planner, which Flash never let the Inferno build, has a painted one in the
 * style of the others (29 Oct 2026, beside its `buildings/iyardplanner/`).
 */
export const INFERNO_BUTTON_FILE: Readonly<Record<number, string>> = {
  1: "bone_crusher.v2.jpg",
  2: "coal_producer.v2.jpg",
  3: "sulfur.v2.jpg",
  4: "magma_producer.v2.jpg",
  6: "sillo.v2.jpg",
  8: "monster_locker.v2.jpg",
  10: "yard_planner.v2.jpg",
  13: "hatchery.v2.jpg",
  17: "coal_wall.v3.jpg",
  21: "sniper_tower.v2.jpg",
  24: "booby_trap.v2.jpg",
  26: "inferno_monster_academy.jpg",
  128: "monster_housing.v2.jpg",
  129: "quake_tower.v2.jpg",
  130: "canon_tower.v2.jpg",
  132: "magma_tower.v2.jpg",
};

/**
 * The Inferno silhouettes on disk. The props table names one for most types
 * (`bone_crusher.v2.silhouette.jpg`..), but only these two were recovered;
 * the rest are drawn dark from the plain picture, as on the surface.
 */
export const INFERNO_SILHOUETTE_FILE: Readonly<Record<number, string>> = {
  129: "quake_tower.v2.silhouette.jpg",
  132: "magma_tower.v2.silhouette.jpg",
};

/** The file name of a type's button picture on a yard of `kind`. */
export const buttonFile = (type: number, kind: YardKind = "main"): string =>
  (kind === "inferno" ? INFERNO_BUTTON_FILE[type] : undefined) ?? BUTTON_FILE[type] ?? `${type}.jpg`;

/** The URL of a type's button picture on a yard of `kind`. */
export const buttonUrl = (type: number, kind: YardKind = "main"): string => ROOT + buttonFile(type, kind);

/** The URL of a type's silhouette, or null when it has none on disk. */
export const silhouetteUrl = (type: number, kind: YardKind = "main"): string | null => {
  const file = kind === "inferno" ? INFERNO_SILHOUETTE_FILE[type] : SILHOUETTE_FILE[type];
  return file ? ROOT + file : null;
};

/** Where the Modern pictures are (`web/tools/build-pictures/make.py`). */
const MODERN_ROOT = `${ROOT}modern/`;

/** A building's picture for a menu, and whether it is the Modern one. */
export interface BuildPicture {
  readonly url: string;
  /**
   * The building's new look on a transparent ground, rather than Flash's
   * button: a locked one is shaded from it (Flash's silhouettes are of the
   * Flash art).
   */
  readonly modern: boolean;
}

/** The Modern picture's file for a yard of `kind`, if the type has one; an outpost draws the main yard's art. */
export const modernButtonFile = (type: number, kind: YardKind = "main"): string | null =>
  MODERN_BUTTON_FILE[kind === "inferno" ? "inferno" : "main"][type] ?? null;

/**
 * The picture of a type on a yard of `kind`, for the build menu and anything
 * else that shows a building (quests, say): with the Modern look, the
 * building's new look as the yard draws it at level 1 (`newLookFor`) where it
 * has one; otherwise Flash's button ({@link buttonUrl}). `classic` is the
 * player's look (`classicLook`), given only by tests.
 */
export const buildPicture = (type: number, kind: YardKind = "main", classic: boolean = classicLook()): BuildPicture => {
  const file = classic ? null : modernButtonFile(type, kind);
  return file ? { url: MODERN_ROOT + file, modern: true } : { url: buttonUrl(type, kind), modern: false };
};

/** The URL of {@link buildPicture}. */
export const buildPictureUrl = (type: number, kind: YardKind = "main"): string => buildPicture(type, kind).url;
