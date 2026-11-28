import type { WaveStatus } from "@/api/waves";

/**
 * The wave event's status as the yard's waves plugin last read it (`GET
 * /bm/events/wave`), for the Events card and the Events button's "wave
 * ready" mark, so neither reads it a second time. No bar on the yard (owner,
 * 27 Nov 2026): the Events card is where a wave starts.
 *
 * - `status`: null while no wave event is on (or before the first read).
 * - `busy`: a wave is being called.
 * - `blocked`: a wild raid is open or fighting; the server would refuse a
 *   wave, so the card's Start waits.
 */

export interface WaveFeedState {
  readonly status: WaveStatus | null;
  readonly busy: boolean;
  readonly blocked: boolean;
}

const EMPTY: WaveFeedState = { status: null, busy: false, blocked: false };

let state: WaveFeedState = EMPTY;
let key = "";
const listeners = new Set<() => void>();

/** Takes the status just read and the yard's state; tells the listeners only when something changed. */
export const setWaveFeed = (status: WaveStatus | null, busy = false, blocked = false): void => {
  const next: WaveFeedState = { status, busy, blocked };
  const nextKey = JSON.stringify(next);
  if (nextKey === key) return;
  state = next;
  key = nextKey;
  for (const listener of listeners) listener();
};

/** What the plugin last said. */
export const waveFeed = (): WaveFeedState => state;

/** A wave the player can start now: the event is on, not every wave is beaten, and nothing is in the way. */
export const waveReady = (feed: WaveFeedState = state): boolean =>
  feed.status !== null && feed.status.next !== null && !feed.busy && !feed.blocked;

/** Follows the feed; returns the stop. */
export const onWaveFeed = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const SNOOZE_KEY = "bymr.waveMarkSnooze";

/** The server's day (UTC) of `now` (seconds), so a snooze ends at the daily reset. */
const dayOf = (now: number): number => Math.floor(now / 86_400);

/**
 * Whether the Events button's swords mark shows: a wave can be started and
 * the player has not opened Events yet today (neon, 27 Nov 2026: it must not
 * nag a player who leaves the event alone; it comes back the next day).
 */
export const waveMarkDue = (now: number, feed: WaveFeedState = state): boolean => {
  if (!waveReady(feed)) return false;
  try {
    return window.localStorage.getItem(SNOOZE_KEY) !== `${feed.status!.run}|${dayOf(now)}`;
  } catch {
    return true;
  }
};

/** Events opened while a wave was ready: the mark rests until the next day. */
export const snoozeWaveMark = (now: number, feed: WaveFeedState = state): void => {
  if (!feed.status) return;
  try {
    window.localStorage.setItem(SNOOZE_KEY, `${feed.status.run}|${dayOf(now)}`);
  } catch {
    /* private mode: the mark shows again next time */
  }
};

/** For tests: back to nothing read. */
export const resetWaveFeed = (): void => {
  state = EMPTY;
  key = "";
  listeners.clear();
};
