import { qualityChoice } from "@/game/quality";

/**
 * Whether to suggest the Low Quality setting (`game/quality.ts`): once, to a
 * player who never picked a Quality, when the connection looks slow. The game
 * never switches by itself; the player answers the suggestion.
 *
 * Chrome, Edge and Android browsers say what the connection is (the Network
 * Information API): Data Saver on, a 2G or 3G link, or under 1.5 Mbit/s is
 * slow. Safari and Firefox do not; there the game times its own downloads
 * (the page's program, 0.6 MB on a first visit) from the browser's resource
 * timings, and a link that brought the fastest of them in at under 1.5 Mbit/s
 * is slow. A visit where everything came from the browser's cache says
 * nothing, and nothing is suggested.
 */

/** What the Network Information API tells a page, where the browser has it. */
export interface ConnectionInfo {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
  /** Estimated speed in Mbit/s. */
  readonly downlink?: number;
}

/** The part of a `PerformanceResourceTiming` the timing reads. */
export interface DownloadTiming {
  readonly transferSize: number;
  readonly startTime: number;
  readonly responseEnd: number;
}

/** Below this the connection counts as slow, in Mbit/s. */
export const SLOW_MBPS = 1.5;
/** Connections Chrome rates 3G or worse. */
const SLOW_TYPES: ReadonlySet<string> = new Set(["slow-2g", "2g", "3g"]);
/** Downloads smaller than this are mostly waiting, not downloading, and say little about speed. */
const MIN_TIMED_BYTES = 100_000;

/** Set once the suggestion has shown, so it never comes back in this browser. */
export const SLOW_SUGGESTED_KEY = "bymr.quality.slowSuggested";

/** The speed the page's own downloads came in at, in Mbit/s: the fastest big one, or null with none. */
export const measuredMbps = (timings: readonly DownloadTiming[]): number | null => {
  let best: number | null = null;
  for (const timing of timings) {
    const seconds = (timing.responseEnd - timing.startTime) / 1000;
    if (timing.transferSize < MIN_TIMED_BYTES || seconds <= 0) continue;
    const mbps = (timing.transferSize * 8) / seconds / 1e6;
    if (best === null || mbps > best) best = mbps;
  }
  return best;
};

/** Whether the connection looks slow: what the browser says, else the timed downloads. */
export const connectionLooksSlow = (
  connection: ConnectionInfo | undefined,
  timings: readonly DownloadTiming[],
): boolean => {
  if (connection) {
    if (connection.saveData === true) return true;
    if (connection.effectiveType && SLOW_TYPES.has(connection.effectiveType)) return true;
    if (typeof connection.downlink === "number" && connection.downlink > 0) return connection.downlink < SLOW_MBPS;
  }
  const mbps = measuredMbps(timings);
  return mbps !== null && mbps < SLOW_MBPS;
};

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** Whether the suggestion may still show: never shown here, and no Quality picked yet. */
export const maySuggestLow = (store: Storage | null = storage()): boolean => {
  try {
    return store !== null && store.getItem(SLOW_SUGGESTED_KEY) !== "1" && qualityChoice(store) === null;
  } catch {
    return false;
  }
};

export const noteLowSuggested = (store: Storage | null = storage()): void => {
  try {
    store?.setItem(SLOW_SUGGESTED_KEY, "1");
  } catch {
    // Site data blocked: maySuggestLow already said no.
  }
};

/** This browser's connection and resource timings, for {@link connectionLooksSlow}. */
export const browserConnection = (): { connection: ConnectionInfo | undefined; timings: DownloadTiming[] } => ({
  connection: typeof navigator === "undefined" ? undefined : (navigator as { connection?: ConnectionInfo }).connection,
  timings:
    typeof performance === "undefined" || typeof performance.getEntriesByType !== "function"
      ? []
      : (performance.getEntriesByType("resource") as PerformanceResourceTiming[]),
});

export interface LowSuggestionOptions {
  /** Whether the suggestion may show here at all: {@link maySuggestLow} by default. */
  readonly allowed?: () => boolean;
  /** Whether the connection looks slow: this browser's, by default. */
  readonly slow?: () => boolean;
  /** Whether something else has the screen (the guided start, a popup, Bob): wait while it does. */
  readonly busy: () => boolean;
  /** Shows the suggestion; it is noted as shown at once, so it never comes back. */
  readonly show: () => void;
  readonly setTimer: (run: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

/** How long after the yard opens the connection is first judged: the yard's own downloads have started by then. */
export const FIRST_LOOK_MS = 4000;
/** How often a waiting suggestion looks again for a free screen. */
export const RETRY_MS = 5000;
/** Looks for a free screen before giving up for this visit (two minutes). */
export const MAX_TRIES = 24;

/**
 * Suggests Low once, a few seconds after the yard opens, when the connection
 * looks slow and nothing else has the screen. Returns the stop.
 */
export const suggestLowOnce = (options: LowSuggestionOptions): (() => void) => {
  const allowed = options.allowed ?? (() => maySuggestLow());
  const slow =
    options.slow ??
    (() => {
      const { connection, timings } = browserConnection();
      return connectionLooksSlow(connection, timings);
    });
  let handle: unknown = null;
  let tries = 0;
  const look = (): void => {
    handle = null;
    if (!allowed()) return;
    if (tries === 0 && !slow()) return;
    tries += 1;
    if (options.busy()) {
      if (tries < MAX_TRIES) handle = options.setTimer(look, RETRY_MS);
      return;
    }
    noteLowSuggested();
    options.show();
  };
  handle = options.setTimer(look, FIRST_LOOK_MS);
  return () => {
    if (handle !== null) options.clearTimer(handle);
    handle = null;
  };
};
