/**
 * PROTOTYPE (proto/live-map-ux, beta 9 live map UX round, never merged).
 *
 * Which look each of the three live-map questions shows, so the owner can pick:
 * - Q1 "cell changed": A snap + own/selected brighten, B colour-coded inner pulse, C expanding ring.
 * - Q2 "open panel when its cell changes": A Attack morphs in place, B strip over the panel top, C veil + Update.
 * - Q3 "connection lost": A top-centre chip, B docked in the top bar / tool row, C beside the "?".
 *
 * Chosen with `?live1=B&live2=A&live3=A` on the page address, or live with `__liveDemo.use({ q1: "C" })`.
 */

export type LiveOption = "A" | "B" | "C";

export interface LiveOptions {
  q1: LiveOption;
  q2: LiveOption;
  q3: LiveOption;
}

const parse = (value: string | null, fallback: LiveOption): LiveOption =>
  value === "A" || value === "B" || value === "C" ? value : fallback;

const fromAddress = (): LiveOptions => {
  const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  return {
    q1: parse(params.get("live1"), "B"),
    q2: parse(params.get("live2"), "A"),
    q3: parse(params.get("live3"), "A"),
  };
};

let current: LiveOptions = fromAddress();
const listeners = new Set<(options: LiveOptions) => void>();

export const liveOptions = (): LiveOptions => current;

export const setLiveOptions = (next: Partial<LiveOptions>): LiveOptions => {
  current = {
    q1: parse(next.q1 ?? null, current.q1),
    q2: parse(next.q2 ?? null, current.q2),
    q3: parse(next.q3 ?? null, current.q3),
  };
  for (const listener of listeners) listener(current);
  return current;
};

export const onLiveOptions = (listener: (options: LiveOptions) => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** What changed on a cell, for the Q1 look and the Q2 panel. */
export type LiveChangeKind = "taken" | "attack" | "attackEnd" | "shield" | "shieldEnd" | "minor";

/** How much a change matters to the viewer, for Q1's tiers. */
export type LiveTier = "own" | "selected" | "range" | "far";
