import { classicLook } from "@/game/classicLook";
import { artUrl } from "../../artUrl";

/**
 * The Christmas yard present (`game/season.ts`, season `christmas`): during
 * the present hunt every mushroom on the yard stands as a small wrapped gift
 * box, as Halloween's mushrooms stood as pumpkins. One still picture per
 * look, no walking (turkeys walked; a present stays put, so it costs a phone
 * nothing more than a mushroom).
 *
 * PLACEHOLDER ART (beta 10, 27 Nov 2026): Codex paintings from the Christmas
 * option sheet (`art-samples/christmas/`), Classic and Modern, until the
 * owner picks the final look. Swap the files in place and raise
 * `BUILDING_ART_VERSION` (`retryLoad.ts`), or give new names here.
 *
 * Each picture is `@2x` and holds the box over its own soft shadow, so a
 * present is one sprite that shakes, pops and sorts by depth as a mushroom
 * does. `base` is where its bottom sits, as a fraction of its height.
 */
export interface PresentPicture {
  readonly file: string;
  /** Fraction of the picture's height where the box stands on the ground. */
  readonly base: number;
}

/** Where the pictures are served from (through `artUrl`, as the mushrooms' root). */
export const PRESENT_ART_ROOT = artUrl("/assets/specialevent/christmas/");

/**
 * How big a present stands, as the pumpkin's 1.3 (owner, 20 Oct 2026): a
 * little bigger than a mushroom, so it reads on a busy yard (neon, round 1).
 * The tap box (`mushroomPick.ts` `MUSHROOM_HIT`, 52 x 52) still covers it.
 */
export const PRESENT_SCALE = 1.3;

export const CLASSIC_PRESENT: PresentPicture = { file: "present@2x.png", base: 0.725 };
export const MODERN_PRESENT: PresentPicture = { file: "present.modern@2x.webp", base: 0.744 };

/** The present picture of the look this page shows (read once, as `classicLook` is). */
export const presentPicture = (classic: boolean = classicLook()): PresentPicture =>
  classic ? CLASSIC_PRESENT : MODERN_PRESENT;

/** Where to ask for the present of this page's look. */
export const presentArtUrl = (classic: boolean = classicLook()): string =>
  PRESENT_ART_ROOT + presentPicture(classic).file;

/** The golden present for the golden find's popup (`ui/yard/MushroomReward.ts`), one for both looks. */
export const GOLDEN_PRESENT_ART = `${PRESENT_ART_ROOT}golden-present.png`;

// The small present by the Events card's "Presents found" is a page file,
// `web/public/events/christmas-2026-present.png`, set in `ui/events/events.css`.
