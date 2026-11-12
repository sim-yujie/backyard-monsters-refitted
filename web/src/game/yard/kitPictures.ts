import { classicLook } from "@/game/classicLook";
import type { StarterKitSummary } from "./starterKitData";

/**
 * The Starter Kits' pictures (owner, 12 Nov 2026: Flash's 145 × 90 thumbnails
 * were "so pixelated and low resolution"): each kit's real layout shot in our
 * game, once in each look, so Modern shows the 3D art and Classic Flash's.
 *
 * The picker draws them about 350 × 220 (`.kit-card__picture`, 3 cards in the
 * 1180 px window, `object-fit: cover`), so each file is twice that,
 * {@link KIT_PICTURE_WIDTH} × {@link KIT_PICTURE_HEIGHT}, sharp on a 2x screen.
 * A file that fails to load falls back to Flash's thumbnail
 * ({@link StarterKitSummary.thumbnail}) through {@link showKitPicture}.
 */

/** Saved size of each picture, 2x the picker's card picture (about 350 × 220 at 1600 × 900 and up). */
export const KIT_PICTURE_WIDTH = 704;
export const KIT_PICTURE_HEIGHT = 440;

/**
 * Raised by hand when the pictures change: pictures are kept a week by the
 * browser (`corsCacheControlSetup.ts`), so a new one is asked for by a new `?v=`.
 */
export const KIT_PICTURE_VERSION = 1;

/** Where the pictures live, under the game server's `public/`. */
const KIT_PICTURE_ROOT = "/assets/ui/kits/";

const KIT_FILE_NAME: Readonly<Record<StarterKitSummary["id"], string>> = {
  1: "regular",
  2: "mega",
  3: "ultra",
};

/** `kit-<regular|mega|ultra>-<modern|classic>.webp`: the file for a kit in a look. */
export const kitPictureFile = (id: StarterKitSummary["id"], classic: boolean): string =>
  `kit-${KIT_FILE_NAME[id]}-${classic ? "classic" : "modern"}.webp`;

/** The kit's picture in the player's look (or the one given). */
export const kitPicture = (kit: Pick<StarterKitSummary, "id">, classic: boolean = classicLook()): string =>
  `${KIT_PICTURE_ROOT}${kitPictureFile(kit.id, classic)}?v=${KIT_PICTURE_VERSION}`;

/**
 * Points `img` at the kit's picture in the player's look; if that file does not
 * load, at Flash's thumbnail instead, once (never a loop if that fails too).
 */
export const showKitPicture = (
  img: HTMLImageElement,
  kit: Pick<StarterKitSummary, "id" | "thumbnail">,
  classic: boolean = classicLook(),
): HTMLImageElement => {
  img.addEventListener(
    "error",
    () => {
      if (img.getAttribute("src") !== kit.thumbnail) img.src = kit.thumbnail;
    },
    { once: true },
  );
  img.src = kitPicture(kit, classic);
  return img;
};
