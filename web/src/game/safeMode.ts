import type { Quality } from "./quality";

/**
 * Safe mode (patch 7.11): the rescue for a device the game keeps crashing on.
 *
 * iOS closes a tab that uses too much memory, with no error and no event. So
 * each page load leaves a mark in this browser when its yard starts loading
 * and takes it away once the yard has run fine for a while, or when the
 * player leaves or hides the page. A mark still there at the next page load
 * is a load that died. Two of them, and the game starts one Quality level
 * lower (the cap) and says so once (`ui/quality/SafeModeDialog.ts`).
 *
 * - The cap is not the player's choice (`bymr.quality` is never written), so
 *   the music and the "Slow internet?" logic do not take it for one. It stays
 *   after a good load, or the next visit would crash again, and goes only
 *   when the player picks a level (Settings, or `?quality=`): `setQuality`
 *   calls {@link clearSafeMode}.
 * - Each load's mark carries its own id, so a load only ever adds or removes
 *   its own. A second tab does not count against the first: a tab that
 *   reached "stable" has no mark, and a hidden tab has taken its own back.
 * - Nothing is marked on the login page: the mark is made when a yard is
 *   about to be drawn (`safeModeYard.ts`).
 * - With site data blocked, or anything unreadable kept, safe mode is off.
 */

/** Where safe mode is kept: `{"cap":"medium"|"low"|null,"loads":{"<load id>":"high"|"medium"|"low"}}`. */
export const SAFE_MODE_KEY = "bymr.safeMode";

/** The most the Quality may be while safe mode is on. */
export type SafeModeCap = "medium" | "low";

export interface SafeModeState {
  readonly cap: SafeModeCap | null;
  /** The loads that started a yard and have not finished, by load id: the level each ran at. */
  readonly loads: Readonly<Record<string, Quality>>;
}

/** Unfinished loads in a row before the game steps down. */
export const UNFINISHED_LIMIT = 2;
/** How long the yard must run, page visible, before a load counts as fine. */
export const STABLE_MS = 30_000;
/** How often the visible time is counted. */
export const TICK_MS = 1000;

const EMPTY: SafeModeState = { cap: null, loads: {} };
const RANK: Record<Quality, number> = { high: 2, medium: 1, low: 0 };

const isLevel = (value: unknown): value is Quality => value === "high" || value === "medium" || value === "low";

const browserStore = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** The lower of two levels. */
export const lowerQuality = (a: Quality, b: Quality | null): Quality => (b !== null && RANK[b] < RANK[a] ? b : a);

/** What a kept value says; anything unreadable is the empty state. */
export const parseSafeMode = (raw: string | null | undefined): SafeModeState => {
  if (!raw) return EMPTY;
  try {
    const kept = JSON.parse(raw) as { cap?: unknown; loads?: unknown } | null;
    if (!kept || typeof kept !== "object") return EMPTY;
    const cap = kept.cap === "medium" || kept.cap === "low" ? kept.cap : null;
    const loads: Record<string, Quality> = {};
    if (kept.loads && typeof kept.loads === "object") {
      for (const [id, level] of Object.entries(kept.loads)) loads[id] = isLevel(level) ? level : "high";
    }
    return { cap, loads };
  } catch {
    return EMPTY;
  }
};

/** `quality()` asks many times a second: the last value read is not parsed again. */
let lastRaw: string | null = null;
let lastState: SafeModeState = EMPTY;

/** The state kept in `store`; the empty state where there is none or it cannot be read. */
export const readSafeMode = (store: Storage | null = browserStore()): SafeModeState => {
  try {
    const raw = store?.getItem(SAFE_MODE_KEY) ?? null;
    if (raw === null) return EMPTY;
    if (raw !== lastRaw) {
      lastState = parseSafeMode(raw);
      lastRaw = raw;
    }
    return lastState;
  } catch {
    return EMPTY;
  }
};

/** Keeps `state`; false when it could not be written (safe mode is then off). */
const writeSafeMode = (store: Storage | null, state: SafeModeState): boolean => {
  try {
    if (!store) return false;
    store.setItem(SAFE_MODE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
};

/** The cap in force, or null. */
export const safeModeCap = (store: Storage | null = browserStore()): SafeModeCap | null => readSafeMode(store).cap;

/**
 * The player picked a level: the cap goes, and the count starts afresh (the
 * marks were made at the level they have just left).
 */
export const clearSafeMode = (store: Storage | null = browserStore()): void => {
  try {
    store?.removeItem(SAFE_MODE_KEY);
  } catch {
    // Site data blocked: there was nothing kept.
  }
};

/** How many loads started a yard and never finished. */
export const unfinishedLoads = (store: Storage | null = browserStore()): number =>
  Object.keys(readSafeMode(store).loads).length;

/** Marks load `id` as started, at the level its monsters are drawn at. Marking twice is once. */
export const markLoad = (store: Storage | null, id: string, level: Quality): void => {
  const state = readSafeMode(store);
  if (state.loads[id] === level) return;
  writeSafeMode(store, { cap: state.cap, loads: { ...state.loads, [id]: level } });
};

/** Takes load `id`'s mark back: the player left or hid the page. Twice is once. */
export const unmarkLoad = (store: Storage | null, id: string): void => {
  const state = readSafeMode(store);
  if (!(id in state.loads)) return;
  const loads = { ...state.loads };
  delete loads[id];
  writeSafeMode(store, { cap: state.cap, loads });
};

/** A load ran fine: the count of unfinished loads in a row starts again. The cap stays. */
export const clearLoads = (store: Storage | null): void => {
  const state = readSafeMode(store);
  if (Object.keys(state.loads).length === 0) return;
  writeSafeMode(store, { cap: state.cap, loads: {} });
};

/**
 * At page boot, before anything heavy loads: with {@link UNFINISHED_LIMIT}
 * marks or more left by earlier loads, the cap goes one step below the lowest
 * level those loads ran at (High to Medium, Medium to Low; Low stays Low) and
 * the marks are cleared. Returns the new level when the game stepped down
 * (the notice names it), else null.
 */
export const stepDownAtBoot = (store: Storage | null = browserStore()): SafeModeCap | null => {
  const state = readSafeMode(store);
  const levels = Object.values(state.loads);
  if (levels.length < UNFINISHED_LIMIT) return null;
  const ranAt = levels.reduce<Quality>((lowest, level) => lowerQuality(lowest, level), lowerQuality("high", state.cap));
  const cap: SafeModeCap = ranAt === "high" ? "medium" : "low";
  if (!writeSafeMode(store, { cap, loads: {} })) return null;
  return cap === ranAt ? null : cap;
};

export interface SafeModeWatchOptions {
  readonly store: Storage | null;
  /** This page load's own id. */
  readonly id: string;
  /** The level this load's monsters are drawn at, for its mark. */
  readonly level: () => Quality;
  /** Whether the yard's monster sheets are all in (none waiting or in flight). */
  readonly idle: () => boolean;
  /** Whether the page is on screen now. */
  readonly visible: () => boolean;
  readonly setTimer: (run: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

/**
 * One page load's mark and its "ran fine" clock.
 *
 * {@link start} when the yard begins loading: the mark is made (if the page
 * is on screen) and the visible time starts counting. After
 * {@link STABLE_MS} of it, and once the yard's sheets are in, the load is
 * stable: every mark is cleared and the watch is over. {@link hidden} (the
 * page was hidden or left) takes the mark back and stops the clock;
 * {@link shown} makes it again and starts the clock from zero. Both can be
 * called any number of times.
 */
export class SafeModeWatch {
  private started = false;
  private marked = false;
  private done = false;
  private seenMs = 0;
  private timer: unknown = null;

  constructor(private readonly options: SafeModeWatchOptions) {}

  /** Whether this load ran fine. */
  get stable(): boolean {
    return this.done;
  }

  /** The yard starts loading. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.shown();
  }

  /** The page is on screen (again): `visibilitychange` to visible, `pageshow`. */
  shown(): void {
    if (!this.started || this.done || this.marked || !this.options.visible()) return;
    this.marked = true;
    this.seenMs = 0;
    markLoad(this.options.store, this.options.id, this.options.level());
    this.timer = this.options.setTimer(this.tick, TICK_MS);
  }

  /** The page was hidden or left: `visibilitychange` to hidden, `pagehide`. */
  hidden(): void {
    if (!this.marked) return;
    this.marked = false;
    if (this.timer !== null) this.options.clearTimer(this.timer);
    this.timer = null;
    unmarkLoad(this.options.store, this.options.id);
  }

  private readonly tick = (): void => {
    this.timer = null;
    if (!this.marked) return;
    this.seenMs += TICK_MS;
    if (this.seenMs >= STABLE_MS && this.options.idle()) {
      this.marked = false;
      this.done = true;
      clearLoads(this.options.store);
      return;
    }
    this.timer = this.options.setTimer(this.tick, TICK_MS);
  };
}

// This page load, in the browser.

/** The level safe mode stepped down to at this page's boot, or null. */
let steppedTo: SafeModeCap | null = null;
let noticeShown = false;
let watch: SafeModeWatch | null = null;

/** Page boot, after `?quality=` was read and before anything loads (`main.ts`). */
export const bootSafeMode = (store: Storage | null = browserStore()): SafeModeCap | null => {
  steppedTo = stepDownAtBoot(store);
  noticeShown = false;
  return steppedTo;
};

/** The level safe mode stepped down to on this page load, or null when it did not. */
export const safeModeSteppedTo = (): SafeModeCap | null => steppedTo;

/** The level to tell the player about, until the notice has shown; then null. */
export const safeModeNotice = (): SafeModeCap | null => (noticeShown ? null : steppedTo);

export const noteSafeModeNoticeShown = (): void => {
  noticeShown = true;
};

/**
 * The first yard of this page load starts loading: marks the load and starts
 * its clock, and listens for the page being hidden, left or shown again. Once
 * a page load; nothing with site data blocked.
 */
export const watchYardLoad = (level: () => Quality, idle: () => boolean): void => {
  if (watch) return;
  const store = browserStore();
  if (!store || typeof document === "undefined") return;
  const made = new SafeModeWatch({
    store,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    level,
    idle,
    visible: () => document.visibilityState !== "hidden",
    setTimer: (run, ms) => window.setTimeout(run, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  });
  watch = made;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") made.hidden();
    else made.shown();
  });
  window.addEventListener("pagehide", () => made.hidden());
  // A page brought back from the back/forward cache.
  window.addEventListener("pageshow", () => made.shown());
  made.start();
};
