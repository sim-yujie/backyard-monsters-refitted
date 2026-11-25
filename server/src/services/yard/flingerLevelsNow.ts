import { Save } from "../../database/models/save.model.js";
import { postgres } from "../../server.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { flingerLevelAt, type FlingerClockSave } from "./derivedLevels.js";

/**
 * Flinger level per `baseid`, as of now, for the Map Room 2 rules that measure
 * a yard's reach: the fog of war's sight (`sightService.ts`) and the attack
 * range (`validateRange.ts`), so the two always agree.
 *
 * Read off each yard's Flinger and clock (`flingerLevelAt`), not the cached
 * `save.flinger` column: that one only moves when the yard is next written, so
 * an upgrade that finished while its owner was elsewhere would not count
 * until they opened that yard again. A running upgrade still counts at the
 * level the Flinger has, as in Flash (`BFOUNDATION.as`, `_lvl` rises only in
 * `Upgraded()`).
 *
 * Loaded outside the identity map: a caller's own main save is often already
 * in it with only a few fields, and these rows are read, never written.
 *
 * @param baseids - The yards asked about; blanks and repeats are ignored. A
 *   yard whose row is gone is left out of the map.
 */
export const flingerLevelsNow = async (
  baseids: readonly (string | null | undefined)[],
): Promise<Map<string, number | undefined>> => (await flingerLevelsWithNextChange(baseids, 0)).levels;

/**
 * {@link flingerLevelsNow}, plus how many seconds from now the first of these
 * yards' Flinger levels will change by its clock alone (an upgrade or build
 * running out, with nobody writing the yard), looking no further than
 * `horizon` seconds ahead. Undefined when none changes within the horizon.
 *
 * A cache of something built from these levels (the alliance's sight,
 * `sightService.ts`) uses it to run out no later than that moment: nothing
 * else drops the cache then, because nothing is written.
 *
 * @param baseids - As {@link flingerLevelsNow}.
 * @param horizon - Seconds ahead to look; 0 skips the look ahead.
 */
export const flingerLevelsWithNextChange = async (
  baseids: readonly (string | null | undefined)[],
  horizon: number,
): Promise<{ levels: Map<string, number | undefined>; nextChangeIn: number | undefined }> => {
  const unique = [...new Set(baseids.filter((baseid): baseid is string => Boolean(baseid)))];
  if (!unique.length) return { levels: new Map(), nextChangeIn: undefined };

  const rows = await postgres.em.find(
    Save,
    { baseid: { $in: unique } },
    {
      fields: ["baseid", "flinger", "buildingdata", "buildinghealthdata", "savetime"],
      disableIdentityMap: true,
    },
  );

  const now = getCurrentDateTime();
  const levels = new Map<string, number | undefined>();
  let nextChangeIn: number | undefined;
  for (const row of rows) {
    const level = flingerLevelAt(row, now);
    levels.set(row.baseid, level);
    if (horizon > 0) {
      const changeIn = secondsUntilLevelChanges(row, now, level, horizon);
      if (changeIn !== undefined && (nextChangeIn === undefined || changeIn < nextChangeIn)) nextChangeIn = changeIn;
    }
  }
  return { levels, nextChangeIn };
};

/**
 * The first whole second, `1..horizon` from `now`, at which the yard's
 * Flinger level differs from `level` by its clock alone, or undefined if it
 * still reads `level` at `now + horizon`. A Flinger's level only rises with
 * time (an upgrade or build finishing), so a halving search finds the moment.
 */
const secondsUntilLevelChanges = (
  row: FlingerClockSave,
  now: number,
  level: number | undefined,
  horizon: number,
): number | undefined => {
  if (flingerLevelAt(row, now + horizon) === level) return undefined;
  let same = 0;
  let changed = horizon;
  while (changed - same > 1) {
    const middle = Math.floor((same + changed) / 2);
    if (flingerLevelAt(row, now + middle) === level) same = middle;
    else changed = middle;
  }
  return changed;
};
