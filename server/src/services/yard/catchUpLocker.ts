import type { JsonObject } from "../../types/JsonObject.js";
import {
  CLOD_EXTRA_SECONDS,
  overdriveOverlap,
  overdriveWindow,
  runningUnlock,
  unlockFinishAt,
  unlockedSlices,
  withStarterUnlocked,
} from "./locker.js";

/**
 * Catch-up step: the Monster Locker's unlock (`docs/design/yard-buildings.md`
 * §4.3, §4.6 item 1).
 *
 * An unlock ends on wall-clock time (`lockerdata[id].e`, absolute), so it
 * finishes while the player is away. The Flash client did two things each
 * tick (`client/scripts/CREATURELOCKER.as:904-913`) and this does both for the
 * whole window at once:
 *
 * - **Overdrive** (`CLOD`): 4 extra seconds off `e` for every second the buff
 *   was active, so `e -= 4 × (seconds of the window inside CLOD's period)`.
 * - **Completion** once `e` has passed: `t: 2`, `s`/`e` removed,
 *   `academy[id] ??= { level: 1 }`, and a `completed` entry.
 *
 * This step runs **before** the buildings step: that one removes store buffs
 * whose `e` has passed, and an Overdrive that ran out during the window still
 * has to be counted here. Nothing else ties the two together (a Locker
 * upgrade does not change a running unlock).
 *
 * Pure apart from mutating the save it is handed. Idempotent: a second run at
 * the same moment has an empty window and nothing left at zero.
 */

/** An unlock the catch-up finished. */
export interface UnlockJob {
  kind: "unlock";
  /** The monster, e.g. `C5`. */
  id: string;
  t: null;
  /** Unix seconds at which the unlock finished, the Overdrive counted. */
  at: number;
  detail: Record<string, never>;
}

/** The slice of a save this step reads and writes. */
export interface CatchUpLockerSave {
  lockerdata?: JsonObject | null;
  academy?: JsonObject | null;
  storedata?: JsonObject | null;
}

/**
 * Advances the running unlock from `from` to `now`.
 *
 * @param save - The yard, mutated in place: `lockerdata` and `academy` may
 *   change. `storedata` is only read.
 * @param from - The save's `savetime`.
 * @param now - The moment to advance to.
 */
export const catchUpLocker = (save: CatchUpLockerSave, from: number, now: number): UnlockJob[] => {
  const running = runningUnlock(save.lockerdata);
  const e = Number(running?.entry.e);
  if (!running || !Number.isFinite(e)) return [];

  const { monster } = running;
  const started = Number(running.entry.s);
  const since = Number.isFinite(started) ? Math.max(from, started) : from;
  const window = overdriveWindow(save.storedata);
  const at = unlockFinishAt(e, since, window);

  if (at <= now) {
    Object.assign(save, unlockedSlices(save, monster));
    return [{ kind: "unlock", id: monster, t: null, at, detail: {} }];
  }

  const boosted = overdriveOverlap(since, now, window);
  if (boosted > 0) {
    save.lockerdata = {
      ...save.lockerdata,
      [monster]: { ...running.entry, e: e - CLOD_EXTRA_SECONDS * boosted },
    };
  }
  return [];
};

/**
 * Catch-up step: the Pokey is always unlocked (issue #218), as Flash's load
 * made it (`CREATURELOCKER.as:63-65`). A save from before new saves started
 * with it gets it here, on its next owner load or yard action, so no migration
 * is needed. Writes only when it was missing.
 *
 * @param save - The yard, mutated in place: `lockerdata` may change.
 */
export const unlockStarterMonster = (save: CatchUpLockerSave): void => {
  const lockerdata = withStarterUnlocked(save.lockerdata);
  if (lockerdata !== save.lockerdata) save.lockerdata = lockerdata;
};
