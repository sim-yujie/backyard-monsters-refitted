import { Save } from "../../database/models/save.model.js";
import { postgres } from "../../server.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { flingerLevelAt } from "./derivedLevels.js";

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
): Promise<Map<string, number | undefined>> => {
  const unique = [...new Set(baseids.filter((baseid): baseid is string => Boolean(baseid)))];
  if (!unique.length) return new Map();

  const rows = await postgres.em.find(
    Save,
    { baseid: { $in: unique } },
    {
      fields: ["baseid", "flinger", "buildingdata", "buildinghealthdata", "savetime"],
      disableIdentityMap: true,
    },
  );

  const now = getCurrentDateTime();
  return new Map(rows.map((row) => [row.baseid, flingerLevelAt(row, now)]));
};
