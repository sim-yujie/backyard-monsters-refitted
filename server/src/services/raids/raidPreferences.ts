/**
 * The player's more / same / less choice after a wild monster raid, and what
 * it does (#226, `docs/design/wild-raids.md` §2.1 and D2).
 *
 * Kept apart from `raidSchedule.ts`, which re-exports it, so the raid planner
 * (`raidPlan.ts`, pure) reads the same numbers without loading the save model
 * or Redis.
 */

/** The player's choice after a raid: -1 less often, 0 the same, 1 more often. */
export type RaidPreference = -1 | 0 | 1;

/**
 * What a preference does (`WMATTACK.as:978-1008`). Flash's third effect, the
 * hit limit each raider left on (50 / 30 / 20, `_hitsPerCreep`), is dropped:
 * a raider now fights until it dies or has nothing left to attack, as an
 * attacker does (owner decision, 2026-10-06, `docs/design/wild-raids.md` §5.4).
 */
export interface RaidPreferenceEffect {
  /** The wait from the last raid to the next. */
  readonly waitSeconds: number;
  /** The army's size multiplier (`_attackVolumeAmplifier`). */
  readonly amplifier: number;
}

const DAY = 24 * 60 * 60;

export const RAID_PREFERENCES: Readonly<Record<RaidPreference, RaidPreferenceEffect>> = {
  [-1]: { waitSeconds: 4 * DAY, amplifier: 0.5 },
  0: { waitSeconds: 3 * DAY, amplifier: 1 },
  1: { waitSeconds: 2 * DAY, amplifier: 1.3 },
};
