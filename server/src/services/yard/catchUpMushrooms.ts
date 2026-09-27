import {
  MUSHROOM_BURST,
  MUSHROOM_CAP,
  MUSHROOM_RESPAWN_SECONDS,
  readMushrooms,
  spawnMushrooms,
  type MushroomYardSave,
  type Random,
} from "./mushrooms.js";

/**
 * Catch-up step 3 (mushrooms): new mushrooms grow while the player is away
 * (`docs/design/yard-buildings.md` §2.3, §5.6).
 *
 * One mushroom per {@link MUSHROOM_RESPAWN_SECONDS} since the last spawn,
 * `mushrooms.s`; at most {@link MUSHROOM_BURST} in one catch-up and never more
 * than {@link MUSHROOM_CAP} in the yard (a yard already above it keeps its
 * mushrooms and grows none, owner decision 2026-09-28). Whenever at least one period has
 * passed, `s` moves to `now`, capped or not, and the part-period left over is
 * dropped: the Flash load did exactly that (`client/scripts/MUSHROOMS.as:129-141`).
 * A yard that never had a spawn (`s` missing or 0) counts as long overdue and
 * gets one burst.
 *
 * Spots are drawn at random on free ground (`services/yard/mushrooms.ts`), so
 * this step takes its random source as a parameter; it is otherwise pure.
 * Idempotent: a second run at the same `now` finds no whole period since `s`.
 *
 * Nothing is reported in `completed`: a mushroom growing is not news, and the
 * `mushrooms` column in the answer already shows it.
 *
 * @param save - The yard, mutated in place: `mushrooms` may change.
 * @param now - Unix seconds to advance to.
 * @param random - The spot and frame source.
 */
export const catchUpMushrooms = (
  save: MushroomYardSave,
  now: number,
  random: Random = Math.random
): [] => {
  const { l, s } = readMushrooms(save.mushrooms);
  const periods = s > 0 ? Math.floor((now - s) / MUSHROOM_RESPAWN_SECONDS) : MUSHROOM_BURST;
  if (periods <= 0) return [];

  const count = Math.min(periods, MUSHROOM_BURST, MUSHROOM_CAP - l.length);
  const list = count > 0 ? spawnMushrooms(save, l, count, random) : l;

  save.mushrooms = { l: list, s: now };
  return [];
};
