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
 */

/** Where the game server keeps the art. Proxied in development. */
const ROOT = "/assets/buildingbuttons/";

/** Types whose button is not simply `<type>.jpg`. */
const BUTTON_FILE: Readonly<Record<number, string>> = { 17: "17.1.jpg", 121: "121.bb1.jpg" };

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
};

/**
 * The Inferno yard's buttons (Inferno WP 1.19): every Inferno type's own
 * `buildingbuttons[0]` (`client/scripts/INFERNOYARDPROPS.as`), all of which
 * are on disk. The Block's first is Brimstone, `coal_wall.v3`. The Monster
 * Juicer names none, so it shows `9.jpg`, as on the surface.
 */
export const INFERNO_BUTTON_FILE: Readonly<Record<number, string>> = {
  1: "bone_crusher.v2.jpg",
  2: "coal_producer.v2.jpg",
  3: "sulfur.v2.jpg",
  4: "magma_producer.v2.jpg",
  6: "sillo.v2.jpg",
  8: "monster_locker.v2.jpg",
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
