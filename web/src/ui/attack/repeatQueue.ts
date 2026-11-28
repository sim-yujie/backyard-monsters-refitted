import { artUrl } from "@/artUrl";
import type { BarTimers } from "./repeatBarTiming";

/**
 * Where a Repeat attack waits in the server's battle line (patch 9.1), asked
 * while the attack is out: the server holds the Repeat request until its turn
 * (`server/src/services/base/combat/replayGate.ts`) and answers the place on
 * a second, cheap route. Nothing is asked for the first
 * {@link QUEUE_FIRST_ASK_MS}: almost every Repeat goes straight in and is
 * answered well before then.
 */

/** When the first ask goes out, after the Repeat. */
export const QUEUE_FIRST_ASK_MS = 1_200;
/** Between asks while it is out. */
export const QUEUE_ASK_EVERY_MS = 1_000;

/**
 * Asks for the place until stopped, telling `onPlace` each answer that
 * differs from the last (null: not in line, or no longer). A failed ask is
 * skipped: the Repeat's own answer is what counts.
 *
 * @returns Stops the asking (idempotent).
 */
export const watchQueuePlace = (
  ask: () => Promise<{ readonly place: number | null }>,
  onPlace: (place: number | null) => void,
  timers: BarTimers,
): (() => void) => {
  let stopped = false;
  let last: number | null = null;
  void (async () => {
    await timers.wait(QUEUE_FIRST_ASK_MS);
    while (!stopped) {
      try {
        const { place } = await ask();
        const now = typeof place === "number" && place > 0 ? Math.floor(place) : null;
        if (!stopped && now !== last) {
          last = now;
          onPlace(now);
        }
      } catch {
        /* the next ask may do better */
      }
      if (stopped) break;
      await timers.wait(QUEUE_ASK_EVERY_MS);
    }
  })();
  return () => {
    stopped = true;
  };
};

/** The hourglass beside the place in the battle line: painted, as the game's icons are (patch 9.1). */
export const QUEUE_ICON = artUrl("/assets/popups/hourglass.png");

/** The words under the working bar: "Attacking…", or the place in line (neon round 1, 26 Nov 2026). */
export const queueWords = (place: number | null): string => (place === null ? "Attacking…" : `Waiting in line · #${place}`);

/** Under the place: that nothing is taken yet and the attack needs no tap. */
export const QUEUE_NOTE = "Nothing spent yet · starts by itself";
