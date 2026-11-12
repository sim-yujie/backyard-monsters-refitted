import type { Texture } from "pixi.js";
import { classicLook } from "@/game/classicLook";
import { LOAD_TRIES, loadWithRetries } from "./retryLoad";

/**
 * The yard mushrooms' pictures (owner, 12 Nov 2026: the drawn stand-in was
 * "hideous, low effort and barely cohesive with the rest of the game").
 *
 * Flash drew a mushroom as `doodad_mushroom_mc` stopped on the frame its save
 * entry names, 1 to 5, over `doodad_mushroom_shadow` on the same frame
 * (`client/scripts/BMUSHROOM.as:24-44`). Both were embedded in the game file;
 * their bitmaps are in the exported `client/images/` (1683 to 1691 the
 * mushrooms, 1670 to 1678 the shadows, and an unused tall sixth). So:
 * - **Classic** shows Flash's own five, at Flash's size.
 * - **Modern** shows the same five groups redrawn as clean 3D renders like the
 *   Modern decorations (Codex, the game-art skill; the job, its three options
 *   per look and the comparison sheets are in `design/mushrooms/`), at the
 *   same height, `@2x`.
 * Each picture holds the mushroom over its shadow (Flash's shadow JPEG turned
 * into black with alpha, which looks the same as its multiply), so a mushroom
 * stays one sprite that shakes, pops and sorts by depth as one. Every picture
 * is `[file, x, y]`: its top-left corner from the mushroom's spot, in world
 * px, as the building art rows place theirs; the group stands centred on the
 * spot with its lowest foot on it.
 */
export type MushroomPicture = readonly [file: string, x: number, y: number];

/** How many art variants Flash had: `doodad_mushroom_mc` frames 1 to 5 (`MUSHROOMS.as:62`, `:166`). */
export const MUSHROOM_VARIANTS = 5;

/** Where the pictures are served from. */
export const MUSHROOM_ART_ROOT = "/assets/buildings/mushrooms/";

/** Flash's five, frame 1 first (`design/mushrooms/make_files.py`, option classic-a). */
export const CLASSIC_MUSHROOMS: readonly MushroomPicture[] = [
  ["classic-1.png", -29, -39],
  ["classic-2.png", -26, -26],
  ["classic-3.png", -22, -36],
  ["classic-4.png", -24, -36],
  ["classic-5.png", -27, -42],
];

/** The Modern five, the same groups in the same order (option modern-a). */
export const MODERN_MUSHROOMS: readonly MushroomPicture[] = [
  ["modern-1@2x.webp", -22, -38.5],
  ["modern-2@2x.webp", -29, -24.5],
  ["modern-3@2x.webp", -22, -36.5],
  ["modern-4@2x.webp", -22, -35.5],
  ["modern-5@2x.webp", -29, -41.5],
];

/** The five pictures of the look this page shows (read once, as `classicLook` is). */
export const mushroomPictures = (classic: boolean = classicLook()): readonly MushroomPicture[] =>
  classic ? CLASSIC_MUSHROOMS : MODERN_MUSHROOMS;

/**
 * Which of the five pictures a mushroom's art variant shows, 0 to 4: variant 1
 * to 5 (`YardMushroom.variant`, the frame its save entry names); anything else
 * shows the first, as `yardModel` already makes it.
 */
export const mushroomArtIndex = (variant: number): number =>
  Number.isInteger(variant) && variant >= 1 && variant <= MUSHROOM_VARIANTS ? variant - 1 : 0;

/** The picture for a mushroom's art variant, in this page's look. */
export const mushroomPictureFor = (
  variant: number,
  pictures: readonly MushroomPicture[] = mushroomPictures(),
): MushroomPicture => pictures[mushroomArtIndex(variant)]!;

/**
 * Where a sprite showing `picture` is anchored, as fractions of its texture
 * (`width`, `height` in world px; an `@2x` texture already reports half its
 * file size): the mushroom's spot.
 */
export const mushroomAnchor = (picture: MushroomPicture, width: number, height: number): { x: number; y: number } => ({
  x: -picture[1] / width,
  y: -picture[2] / height,
});

/**
 * The five pictures of this page's look, loaded with the yard's retries
 * (`retryLoad.ts`). A picture that never arrives is left out (null), and its
 * mushrooms keep the drawn stand-in (`yardAtlas.ts`).
 */
export const loadMushroomArt = async (gone: () => boolean): Promise<readonly (Texture | null)[]> => {
  const pictures = mushroomPictures();
  return Promise.all(
    pictures.map(([file]) =>
      loadWithRetries(MUSHROOM_ART_ROOT + file, gone).catch((caught: unknown) => {
        if (!gone()) console.warn(`The mushroom picture ${file} did not load in ${LOAD_TRIES} tries; the drawn one stays.`, caught);
        return null;
      }),
    ),
  );
};
