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

export const PRESENT_ART_ROOT = "/assets/specialevent/christmas/";

export const CLASSIC_PRESENT: PresentPicture = { file: "present@2x.png", base: 0.725 };
export const MODERN_PRESENT: PresentPicture = { file: "present.modern@2x.webp", base: 0.744 };

/** The present picture of the look this page shows (read once, as `classicLook` is). */
export const presentPicture = (classic: boolean = classicLook()): PresentPicture =>
  classic ? CLASSIC_PRESENT : MODERN_PRESENT;

/** Where to ask for the present of this page's look. */
export const presentArtUrl = (classic: boolean = classicLook()): string =>
  artUrl(PRESENT_ART_ROOT + presentPicture(classic).file);

/** The golden present for the golden find's popup (`ui/yard/MushroomReward.ts`), one for both looks. */
export const GOLDEN_PRESENT_ART = artUrl(`${PRESENT_ART_ROOT}golden-present.png`);

/**
 * The small present on the Events card (hint line, ladder title): the
 * Classic present, `@2x` for a 25 x 22 slot. A page file (`web/public`), as
 * the event banners, so the card's CSS can use it too.
 */
export const PRESENT_ICON = "/events/christmas-2026-present.png";
