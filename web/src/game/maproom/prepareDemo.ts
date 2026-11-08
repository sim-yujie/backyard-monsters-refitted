import type { PrepareState } from "./prepareProgress";

/**
 * A test switch for Map Room 2's "Preparing map" loading screen (owner, 8 Nov 2026): the real screen
 * only shows on a first open where the painted look's shaders still compile (Firefox), which a tester
 * in Chromium, or anyone on a second open, never sees. `?prepbar-demo=1` runs a made-up 0-100% over
 * {@link DEMO_MS} on every Map Room 2 open instead, in any browser and in Classic too; leave the map
 * and open it again to replay. `?prepbar-demo=0` turns it off.
 *
 * Off by default, and harmless in production: it works only on a test server (a development build,
 * or a page served from localhost), and it is remembered only in this tab (session storage), so a
 * shared link cannot leave a player's map covered.
 */

export const PREPBAR_DEMO_KEY = "bymr.prepbarDemo";

/** How long the demo's made-up progress takes, 0 to 100%. */
export const DEMO_MS = 15_000;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Whether this page may run the demo: a development build, or served from this computer. */
export const demoAllowed = (
  dev: boolean = import.meta.env.DEV,
  host: string = typeof location === "undefined" ? "" : location.hostname,
): boolean => dev || LOCAL_HOSTS.has(host);

const tabStorage = (): Storage | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};

/**
 * Whether the demo runs on this open: the URL's 1/0 if given (remembered for this tab, so the game's
 * own page changes keep it), else this tab's remembered choice. Always false where not allowed.
 * Never throws.
 */
export const readPrepareDemo = (
  search: string = typeof location === "undefined" ? "" : location.search,
  store: Storage | null = tabStorage(),
  allowed: boolean = demoAllowed(),
): boolean => {
  if (!allowed) return false;
  const asked = new URLSearchParams(search).get("prepbar-demo");
  try {
    if (asked !== null) {
      const on = ["1", "on", "true", "yes"].includes(asked.trim().toLowerCase());
      if (on) store?.setItem(PREPBAR_DEMO_KEY, "1");
      else store?.removeItem(PREPBAR_DEMO_KEY);
      return on;
    }
    return store?.getItem(PREPBAR_DEMO_KEY) === "1";
  } catch {
    return asked !== null && ["1", "on", "true", "yes"].includes(asked.trim().toLowerCase());
  }
};

/**
 * The demo's state `elapsedMs` after the map opened: shown at once, climbing a little unevenly (like
 * real compiles: quick parts, then a long one) to 100% at {@link DEMO_MS}, then done.
 */
export const demoState = (elapsedMs: number): PrepareState => {
  if (elapsedMs >= DEMO_MS) return { show: false, percent: 100 };
  const t = Math.max(0, elapsedMs) / DEMO_MS;
  // Fast for the first fifth (the Low ground and the small programs), steady after.
  const share = t < 0.2 ? t * 1.5 : 0.3 + ((t - 0.2) / 0.8) * 0.7;
  return { show: true, percent: Math.min(99, Math.floor(share * 100)) };
};
