import type { PrepareState } from "./prepareProgress";

/**
 * Prototype switches for the "Preparing map" feedback (owner, 8 Nov 2026: the first bar "was not
 * what i imagined"; Codex proposed three designs, archive/prepare-bar-review/codex-review.md):
 *
 * - `?prepbar=a`: an illustrated loading screen over the map area; the map waits behind it.
 * - `?prepbar=b`: a broad strip just under the top bar; the map stays usable (Codex's pick).
 * - `?prepbar=c`: a painted mist over the map that clears as it prepares, and a small plaque.
 * - `?prepbar=bar` (or nothing): the first bar, low in the middle.
 *
 * `?prepbar-demo=1` runs a made-up 0-100% over {@link DEMO_MS} on every Map Room 2 open, in any
 * browser and in Classic too (where the real look never compiles), so the designs can be seen and
 * replayed by leaving and reopening the map. `?prepbar-demo=0` turns it off. Both are remembered in
 * this browser, like `?skin=`, so they survive the game's own page changes.
 */

export const PREPARE_DESIGNS = ["bar", "a", "b", "c"] as const;
export type PrepareDesign = (typeof PREPARE_DESIGNS)[number];

export const PREPBAR_KEY = "bymr.prepbar";
export const PREPBAR_DEMO_KEY = "bymr.prepbarDemo";

/** How long the demo's made-up progress takes, 0 to 100%. */
export const DEMO_MS = 15_000;

const isDesign = (value: string | null): value is PrepareDesign =>
  (PREPARE_DESIGNS as readonly (string | null)[]).includes(value);

/** The design: the URL's if it names one, else this browser's remembered one, else the first bar. */
export const pickPrepareDesign = (asked: string | null, saved: string | null): PrepareDesign => {
  const a = asked?.trim().toLowerCase() ?? null;
  if (isDesign(a)) return a;
  const s = saved?.trim().toLowerCase() ?? null;
  return isDesign(s) ? s : "bar";
};

/** Whether the demo runs: the URL's 1/0 if given, else this browser's remembered choice. */
export const pickDemo = (asked: string | null, saved: string | null): boolean => {
  if (asked !== null) return ["1", "on", "true", "yes"].includes(asked.trim().toLowerCase());
  return saved === "1";
};

const storage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/**
 * Reads both switches from the URL, remembers what the URL said, and returns the choice. Never
 * throws (private windows, blocked storage).
 */
export const readPrepareChoice = (
  search: string = typeof location === "undefined" ? "" : location.search,
  store: Storage | null = storage(),
): { design: PrepareDesign; demo: boolean } => {
  const params = new URLSearchParams(search);
  const askedDesign = params.get("prepbar");
  const askedDemo = params.get("prepbar-demo");
  let savedDesign: string | null = null;
  let savedDemo: string | null = null;
  try {
    savedDesign = store?.getItem(PREPBAR_KEY) ?? null;
    savedDemo = store?.getItem(PREPBAR_DEMO_KEY) ?? null;
  } catch {
    // Storage blocked: the URL alone decides.
  }
  const design = pickPrepareDesign(askedDesign, savedDesign);
  const demo = pickDemo(askedDemo, savedDemo);
  try {
    if (askedDesign !== null) {
      if (design === "bar") store?.removeItem(PREPBAR_KEY);
      else store?.setItem(PREPBAR_KEY, design);
    }
    if (askedDemo !== null) {
      if (demo) store?.setItem(PREPBAR_DEMO_KEY, "1");
      else store?.removeItem(PREPBAR_DEMO_KEY);
    }
  } catch {
    // Not remembered; the URL still works for this page.
  }
  return { design, demo };
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
