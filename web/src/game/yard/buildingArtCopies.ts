import { artPath } from "@/artUrl";
import { quality, type Quality } from "@/game/quality";
import { BUILDING_ART_COPIES } from "./buildingArtCopiesData";

/**
 * Smaller Modern building pictures for Low and Medium Quality (beta 9, owner
 * 21 Nov 2026, card b9-speed-picks).
 *
 * The Modern buildings are painted at twice the game's size (`@2x`). On High
 * the yard draws those. On Low it draws their `@1x` copies, half a side (a
 * quarter of the graphics memory, about half the bytes); on Medium, a phone's
 * default, their `@1.5x` copies, three quarters a side (a little over half
 * the memory). A strip whose cells are an odd number of game units has no
 * `@1.5x` (its cells would not be whole pixels), so Medium draws its `@2x`.
 *
 * Pixi reads a picture's size from the `@1x` / `@1.5x` in its name, so every
 * position and cell in the art tables stays in game units whichever copy is
 * drawn. The copies are made by `web/tools/building-copies/make_copies.py`,
 * which also writes the list of them (`buildingArtCopiesData.ts`): a picture
 * not on it is always drawn from the file named.
 *
 * Only the yard's Pixi drawing asks for the copies (`YardTextures`, the
 * upgrade preview, the building being placed); pictures in windows keep the
 * `@2x`.
 */

const BUILDINGS = "/assets/buildings/";

/**
 * The copy of a building picture to load at `level`: `.../anim.3d1@2x.webp`
 * as it is on High, `.../anim.3d1@1.5x.webp` on Medium where there is one,
 * `.../anim.3d1@1x.webp` on Low. Anything that is not a listed building
 * picture comes back unchanged.
 *
 * @param {string} url - The picture as the art tables name it (with or without `VITE_ART_URL`'s origin).
 * @param {Quality} level - The Quality in use.
 * @returns {string} The address to load.
 */
export const buildingArtCopy = (url: string, level: Quality = quality()): string => {
  if (level === "high") return url;
  const path = artPath(url);
  if (!path.startsWith(BUILDINGS)) return url;
  const copies = BUILDING_ART_COPIES[path.slice(BUILDINGS.length)];
  if (!copies) return url;
  if (level === "medium" && copies < 2) return url;
  const at = url.lastIndexOf("@2x.");
  if (at < 0) return url;
  return `${url.slice(0, at)}${level === "low" ? "@1x." : "@1.5x."}${url.slice(at + 4)}`;
};
