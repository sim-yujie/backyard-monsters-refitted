import { mushroomKey } from "./mushroomPick";
import type { YardMushroom } from "./yardModel";

/**
 * A mushroom popping up (#263): one that has just appeared on the player's
 * own yard grows out of the ground with a small overshoot. That is one a
 * building landed on, which the server moved to free ground, or a new one
 * that grew while the yard was open.
 *
 * The Flash client had no such animation; a mushroom simply appeared where
 * `MUSHROOMS.as` placed it. The owner asked for this one (2026-10-04: "make
 * the mushroom pop up elsewhere").
 */

/** How long the pop lasts, seconds. */
export const MUSHROOM_POP_SECONDS = 0.45;

/** The overshoot of an ease-out-back curve: about 10% past full size. */
const OVERSHOOT = 1.70158;

/**
 * The mushroom's scale `elapsed` seconds into its pop: 0 at the start,
 * slightly over 1 near the end, exactly 1 from {@link MUSHROOM_POP_SECONDS} on.
 */
export const mushroomPopScale = (elapsed: number): number => {
  if (elapsed <= 0) return 0;
  if (elapsed >= MUSHROOM_POP_SECONDS) return 1;
  const t = elapsed / MUSHROOM_POP_SECONDS - 1;
  return 1 + (OVERSHOOT + 1) * t ** 3 + OVERSHOOT * t ** 2;
};

/**
 * The keys of the mushrooms in `mushrooms` that were not on screen before
 * ({@link mushroomKey}): the ones to pop. A moved mushroom has a new spot,
 * so a new key.
 */
export const newMushroomKeys = (
  before: ReadonlySet<string>,
  mushrooms: readonly YardMushroom[],
): string[] =>
  mushrooms.map((mushroom) => mushroomKey(mushroom)).filter((key) => !before.has(key));
