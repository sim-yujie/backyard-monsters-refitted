/**
 * Repeat attack's progress bar (owner, 15 Nov 2026): the timing and the
 * look switch, kept apart from the DOM so the tests can drive them.
 *
 * The server answers a Repeat attack at once, so the bar is theatre: it runs
 * for at least {@link REPEAT_BAR_MIN_MS}, and only once the answer is in AND
 * that time has passed does it jump to full and the result show. A slower
 * answer keeps the bar creeping (never full before the answer); an error stops
 * it at once and the error shows as before.
 */

/** The shortest time the bar runs (owner: "at least 5 seconds"). */
export const REPEAT_BAR_MIN_MS = 5000;

/** Where the bar is when the minimum time is up; it creeps on from there. */
const AT_MINIMUM = 0.85;
/** The most it ever shows before the answer: never full. */
const CEILING = 0.97;
/** How slowly it creeps past the minimum (ms for ~63% of what is left). */
const CREEP_MS = 6000;

/**
 * The bar's fill while it waits, 0 to just under 1: it eases to 85% over the
 * minimum time, then creeps on towards 97% and never reaches full. Rises
 * with time and never goes back.
 *
 * @param elapsedMs - Time since the bar started.
 * @param minMs - The minimum run time.
 */
export const waitingProgress = (elapsedMs: number, minMs: number = REPEAT_BAR_MIN_MS): number => {
  const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  if (minMs <= 0 || elapsed >= minMs) {
    const over = elapsed - Math.max(0, minMs);
    return AT_MINIMUM + (CEILING - AT_MINIMUM) * (1 - Math.exp(-over / CREEP_MS));
  }
  const left = 1 - elapsed / minMs;
  return AT_MINIMUM * (1 - left * left);
};

/** A clock and a timer; the real ones by default, fakes in the tests. */
export interface BarTimers {
  /** Milliseconds, any origin. */
  readonly now: () => number;
  /** Resolves after `ms`. Uses `setTimeout`, which a hidden tab still runs (rAF does not). */
  readonly wait: (ms: number) => Promise<void>;
}

export const REAL_TIMERS: BarTimers = {
  now: () => Date.now(),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
};

/**
 * Waits for `work`, and for at least `minMs` since `startedAt`. An error from
 * `work` comes out at once, without waiting out the minimum.
 *
 * @param work - The request.
 * @param minMs - The minimum time.
 * @param timers - The clock and timer.
 * @param startedAt - When the bar started, on `timers.now`'s clock.
 */
export const atLeast = async <T>(
  work: Promise<T>,
  minMs: number,
  timers: BarTimers = REAL_TIMERS,
  startedAt: number = timers.now(),
): Promise<T> => {
  const result = await work;
  const left = minMs - (timers.now() - startedAt);
  if (left > 0) await timers.wait(left);
  return result;
};

/* ── The look (dev switch until the owner picks one) ────────────────────── */

export const REPEAT_BAR_LOOKS = ["army", "fuse", "goo"] as const;
export type RepeatBarLook = (typeof REPEAT_BAR_LOOKS)[number];

/** The look shown when nobody picked one. */
export const DEFAULT_REPEAT_BAR_LOOK: RepeatBarLook = "army";

/** Where this browser keeps a tester's `?repeatBar=` choice. */
export const REPEAT_BAR_KEY = "bymr.repeatBar";

/**
 * How long the full bar stays up before the result, per look: long enough to
 * see it land (the fuse's bomb bursts in this time).
 */
export const REPEAT_BAR_FULL_HOLD_MS: Readonly<Record<RepeatBarLook, number>> = {
  army: 600,
  fuse: 900,
  goo: 600,
};

const isLook = (value: string | null): value is RepeatBarLook =>
  (REPEAT_BAR_LOOKS as readonly (string | null)[]).includes(value);

/** The look: a tester's `?repeatBar=` if valid, else the one they saved, else the default. */
export const pickRepeatBarLook = (asked: string | null, saved: string | null): RepeatBarLook => {
  if (isLook(asked)) return asked;
  if (isLook(saved)) return saved;
  return DEFAULT_REPEAT_BAR_LOOK;
};

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * The look for this page. `?repeatBar=army|fuse|goo` picks one and this
 * browser remembers it; `?repeatBar=auto` forgets it.
 */
export const repeatBarLook = (
  search: string = typeof location === "undefined" ? "" : location.search,
  store: Storage | null = storage(),
): RepeatBarLook => {
  const asked = new URLSearchParams(search).get("repeatBar");
  let saved: string | null = null;
  try {
    if (asked === "auto") store?.removeItem(REPEAT_BAR_KEY);
    else if (isLook(asked)) store?.setItem(REPEAT_BAR_KEY, asked);
    saved = store?.getItem(REPEAT_BAR_KEY) ?? null;
  } catch {
    saved = null;
  }
  return pickRepeatBarLook(asked, saved);
};
