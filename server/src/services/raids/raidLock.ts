/**
 * The yard's lock while a wild monster raid is being fought (#226 WP3,
 * `docs/design/wild-raids.md` §7.2 and §7.3).
 *
 * The fight is run once, on the yard as it stood when it started, and the
 * finish applies its outcome to the yard, so nothing may change the yard in
 * between: every yard action is refused with `raidInProgress`, and an attack
 * load on the yard with `baseUnderAttackErr`. The lock lives on the save row
 * itself, as `aiattacks.fight`, so the yard actions read it under the same row
 * lock they already take, and so this module, which they import, reads no
 * Redis (`yardAction.ts` never loads `server.ts`). `attackid` is not used:
 * that would lock the owner out of their own yard (`baseModeBuild.ts`).
 *
 * The lock ends by itself at `until`, the moment the open raid's Redis key
 * expires (the fight's length plus the grace, `raidStore.ts`), and is cleared
 * by the finish, by a finish that finds the raid cancelled, and by the
 * player's next yard load, which cancels any fight (`startSession`).
 */

/** `aiattacks.fight`: the raid being fought and when the lock lapses at the latest. */
export interface RaidFightLock {
  readonly id: string;
  /** Unix seconds. */
  readonly until: number;
}

/** The lock as stored, or undefined for anything that is not one. */
export const readFightLock = (value: unknown): RaidFightLock | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { id, until } = value as Record<string, unknown>;
  if (typeof id !== "string" || typeof until !== "number" || !Number.isFinite(until)) return undefined;
  return { id, until: Math.floor(until) };
};

/**
 * Whether a raid is being fought on this yard now.
 *
 * @param save - The yard row (its `aiattacks`, stored in any shape).
 * @param now - Unix seconds.
 */
export const raidFighting = (save: { aiattacks?: unknown }, now: number): boolean => {
  const aiattacks = save.aiattacks;
  if (typeof aiattacks !== "object" || aiattacks === null) return false;
  const lock = readFightLock((aiattacks as Record<string, unknown>).fight);
  return lock !== undefined && now < lock.until;
};
