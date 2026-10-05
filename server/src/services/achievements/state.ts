import { ACHIEVEMENT_STATS, type AchievementStat } from "../../game-data/achievements.js";

/**
 * The achievements' server record, `save.achievements`
 * (`docs/design/achievements.md` §6, issue #204).
 *
 * One jsonb column on the main save, built like `save.onboarding`
 * (`services/onboarding/state.ts`). Flash's shape is kept inside it, `s` for
 * stats and `c` for completed, with Flash's stat names and numbers
 * (`client/scripts/ACHIEVEMENTS.as:159-167`), plus what the server needs: when
 * each unlocked, the Shiny it paid, whether the pop-up was seen, and whether
 * the backfill found it.
 *
 * The client can never write it. It is not a `@FrontendKey` and it is in
 * neither `Save.saveKeys` nor `Save.attackSaveKeys`, so `/base/save` cannot
 * touch it; Flash's own `stats.achievements` is left unread for that reason
 * (the client wrote it). Every write goes through {@link updateAchievements}
 * so a writer never loses a field another owns.
 *
 * A `NULL` column means "never worked out": the record reads empty with no
 * `backfilledAt`, and the first evaluation under the main row's lock fills in
 * what the save already proves (§8) and sets it.
 */

/** One unlocked achievement, under Flash's number in {@link Achievements.c}. */
export interface UnlockRecord {
  /** Unix seconds it unlocked. */
  at: number;
  /** The Shiny paid for it. */
  shiny: number;
  /** 1 once the client says it showed the pop-up. */
  seen?: 1;
  /** 1 when the first read's backfill found it (one summary pop-up, §8). */
  backfill?: 1;
  /**
   * 1 while its Shiny is still owed: it unlocked while rewards were switched
   * off (`config/AchievementConfig.ts`). No bell line and no pop-up until the
   * first evaluation with rewards on pays it.
   */
  unpaid?: 1;
}

/** Every stat, each a whole number that only ever goes up. */
export type AchievementStats = Record<AchievementStat, number>;

/** The whole column, version 1. */
export interface Achievements {
  v: 1;
  s: AchievementStats;
  /** Flash's number (as a string key) to its unlock. */
  c: Record<string, UnlockRecord>;
  /** Unix seconds the backfill ran; absent until it has (§8). */
  backfilledAt?: number;
}

/** The slice of a save the achievements helpers read. */
export interface AchievementsSave {
  achievements?: unknown;
}

/** Every stat at zero. */
export const emptyStats = (): AchievementStats =>
  Object.fromEntries(ACHIEVEMENT_STATS.map((stat) => [stat, 0])) as AchievementStats;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A finite number, or undefined. */
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** A whole non-negative count, 0 for anything else. */
const count = (value: unknown): number => {
  const n = num(value);
  return n !== undefined && n > 0 ? Math.floor(n) : 0;
};

const readStats = (raw: unknown): AchievementStats => {
  const stats = emptyStats();
  if (!isRecord(raw)) return stats;
  for (const stat of ACHIEVEMENT_STATS) stats[stat] = count(raw[stat]);
  return stats;
};

/**
 * The unlocks, keyed by a positive whole number. An id the catalogue does not
 * know is kept: whatever is in `c` has been paid, or is owed once (`unpaid`),
 * and must never be paid again.
 */
const readCompleted = (raw: unknown): Record<string, UnlockRecord> => {
  const out: Record<string, UnlockRecord> = {};
  if (!isRecord(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    if (!/^[1-9]\d*$/.test(id) || !isRecord(value)) continue;
    const at = num(value.at);
    if (at === undefined) continue;
    const unlock: UnlockRecord = { at, shiny: count(value.shiny) };
    if (value.seen) unlock.seen = 1;
    if (value.backfill) unlock.backfill = 1;
    if (value.unpaid) unlock.unpaid = 1;
    out[id] = unlock;
  }
  return out;
};

/**
 * Reads `save.achievements` into the full shape, every stat present, so
 * callers never null-check. `NULL` (or anything unreadable) reads as an empty
 * record with no `backfilledAt`. The result is a fresh object: mutate it
 * freely, then write it back.
 *
 * @param save - A main save (an outpost seen through `poolView` reads its main yard's).
 */
export const readAchievements = (save: AchievementsSave): Achievements => {
  const raw = isRecord(save.achievements) ? save.achievements : {};
  const record: Achievements = { v: 1, s: readStats(raw.s), c: readCompleted(raw.c) };
  const backfilledAt = num(raw.backfilledAt);
  if (backfilledAt !== undefined) record.backfilledAt = backfilledAt;
  return record;
};

/**
 * The one way to change the column: reads it with defaults, lets `change`
 * edit the copy, and returns it for the caller to store. Fields `change` does
 * not touch come back as they were.
 */
export const updateAchievements = (
  save: AchievementsSave,
  change: (record: Achievements) => void
): Achievements => {
  const record = readAchievements(save);
  change(record);
  return record;
};

/** Whether the first read's backfill (§8) has still to run. */
export const needsBackfill = (record: Achievements): boolean => record.backfilledAt === undefined;

/** Whether achievement `id` is unlocked (and so paid, or owed once). */
export const isEarned = (record: Achievements, id: number): boolean => record.c[String(id)] !== undefined;
