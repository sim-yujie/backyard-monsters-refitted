/**
 * The expiration time for a wild monster save in seconds.
 * 12 hours.
 */
export const WILD_MONSTER_EXPIRATION = 43200;

/**
 * The parts of a save the expiry rule looks at.
 * Kept structural so partially-loaded map cell saves satisfy it too.
 */
export interface ExpirableWildMonsterSave {
  wmid?: number | null;
  savetime?: number | null;
}

/**
 * Whether a wild monster camp has regenerated since its last save.
 *
 * A camp regenerates 12 hours after the last time it was saved, so any damage
 * recorded before that point no longer describes the camp. Every path that
 * reports or loads a wild monster save must agree on this rule - the yard view
 * (`baseModeView`), the map (`wildMonsterCell`) and the bulk snapshot.
 *
 * @param {ExpirableWildMonsterSave | null | undefined} save - The save to test.
 * @param {number} now - The current unix timestamp in seconds.
 * @returns {boolean} True when the save is a wild monster save past its expiry.
 */
export const isWildMonsterExpired = (
  save: ExpirableWildMonsterSave | null | undefined,
  now: number
) => {
  if (!save || !save.wmid) return false;

  return now - (save.savetime ?? 0) > WILD_MONSTER_EXPIRATION;
};
