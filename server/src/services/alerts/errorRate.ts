import type { ErrorRate } from "./alerts.js";

/**
 * Server errors per 10 minutes, for the "sudden jump in errors" alert
 * (`alerts.ts`), kept in memory: one count per 10-minute slot for the past
 * day. The error store's flush (`flushServerErrors` in
 * `services/errors/errorStore.ts`) calls `noteServerErrors` every half minute
 * with the errors the logger caught; before the first flush the rate reads as
 * unknown and the error check is skipped.
 *
 * "Usual" is the average of the finished slots over the past day; a restart
 * starts the history afresh.
 */

export const ERROR_SLOT_MS = 10 * 60 * 1000;
const SLOTS = (24 * 60 * 60 * 1000) / ERROR_SLOT_MS;

export const errorRateCounter = () => {
  const counts = new Map<number, number>();
  let firstSlot: number | null = null;

  return {
    /** `count` server errors happened (now). */
    note(count: number, now: number = Date.now()): void {
      if (!(count > 0)) return;
      const slot = Math.floor(now / ERROR_SLOT_MS);
      firstSlot ??= slot;
      counts.set(slot, (counts.get(slot) ?? 0) + count);
      for (const old of counts.keys()) if (old <= slot - SLOTS) counts.delete(old);
    },

    /** Marks the counter as fed even with no errors yet, so the check runs. */
    start(now: number = Date.now()): void {
      firstSlot ??= Math.floor(now / ERROR_SLOT_MS);
    },

    /** The last 10 minutes against the usual; null before anything was noted. */
    rate(now: number = Date.now()): ErrorRate | null {
      if (firstSlot === null) return null;
      const slot = Math.floor(now / ERROR_SLOT_MS);
      // The last 10 minutes: this slot and the part of the previous one still inside them.
      const into = (now % ERROR_SLOT_MS) / ERROR_SLOT_MS;
      const recent = Math.round((counts.get(slot) ?? 0) + (counts.get(slot - 1) ?? 0) * (1 - into));
      const from = Math.max(firstSlot, slot - SLOTS);
      const finished = slot - 1 - from;
      let total = 0;
      for (let one = from; one < slot - 1; one++) total += counts.get(one) ?? 0;
      return { recent, usual: finished > 0 ? total / finished : 0 };
    },
  };
};

/** The server's own counter. */
export const serverErrorRate = errorRateCounter();

/** For the error store: `count` server errors were just taken in. */
export const noteServerErrors = (count: number, now: number = Date.now()): void => {
  serverErrorRate.start(now);
  serverErrorRate.note(count, now);
};
