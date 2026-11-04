import { Save } from "../../../database/models/save.model.js";
import { postgres } from "../../../server.js";
import { freshTribeData } from "./tribeSaveV2.js";

/** What the regrow leaves on the row: its identity, its place and its world. */
const KEPT = ["basesaveid", "baseid", "worldid", "cell", "mapversion", "id"] as const;

/**
 * Regrows a healed Map Room 2 camp (`wildMonsterExpiry.ts`) in place, for an
 * attack about to be fought on it.
 *
 * Atomic against a second attack on the same camp at the same moment: the row
 * is first claimed with one conditional write, `savetime` moved from the value
 * this request read to `now`, which only one request can win. The winner then
 * resets the row to a fresh camp (its tribe's yard for its level, no damage)
 * and flushes it. The loser's claim touches nothing, and it reads the row again
 * instead: by then healed by the winner, or saved by an attack in between, and
 * either way not to be wiped. The row keeps its id and its map cell, so nothing
 * is deleted or created and no second row can appear for the camp.
 *
 * The new `savetime` also makes the camp fresh for the expiry rule straight
 * away, so nothing else regrows it under the attack before its save lands.
 *
 * @param save - The camp's row, already found expired.
 * @param readSavetime - Its `savetime` when this request found it expired.
 *   Taken then rather than off the entity now, which a shared identity map
 *   could already show with another request's write.
 * @param now - The current unix time in seconds.
 * @returns The row to attack: this one regrown, or as another request left it;
 *   null when it has gone meanwhile.
 */
export const regrowCamp = async (save: Save, readSavetime: number, now: number): Promise<Save | null> => {
  const claimed = await postgres.em.nativeUpdate(
    Save,
    { basesaveid: save.basesaveid, savetime: readSavetime },
    { savetime: now }
  );

  if (claimed === 0) {
    return postgres.em.findOne(Save, { basesaveid: save.basesaveid }, { refresh: true });
  }

  // A copy: the template's nested objects are shared by every camp like it.
  const fresh: Record<string, unknown> = structuredClone(freshTribeData(save.baseid));
  for (const key of KEPT) delete fresh[key];

  postgres.em.assign(save, { ...fresh, savetime: now }, { onlyProperties: true });
  await postgres.em.flush();
  return save;
};
