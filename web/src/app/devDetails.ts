/**
 * Whether the screens show developer details (#150): a building's type id,
 * footprint, position and art file in its Details, a cell's alliance id.
 * Players see names and the facts they decide with; the details are for
 * whoever is building the client, so they show in a dev build
 * (`import.meta.env.DEV`, `npm run dev`) and never in a production one. The
 * frame-time readout a player can still open to report lag is the separate
 * PerfOverlay (backtick or F8, `ui/PerfOverlay.ts`).
 *
 * The status lines' counts and frame times are a separate, opt-in switch
 * (`devStats`): the owner plays on the dev server, and they cluttered the
 * yard (beta 6).
 */

let forced: boolean | null = null;

export const devDetails = (): boolean => forced ?? import.meta.env.DEV;

/** For tests: shows the details, or hides them, whatever the build; null goes back to the build's. */
export const setDevDetails = (on: boolean | null): void => {
  forced = on;
};

/**
 * Where a developer opts in to the status lines' counts (`devStats`):
 * `localStorage.setItem("bymr.devStats", "1")` in the browser console, then
 * reload. Removing it turns them off again.
 */
export const DEV_STATS_KEY = "bymr.devStats";

let forcedStats: boolean | null = null;

const storedStats = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(DEV_STATS_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * Whether the yard's and Map Room 2's status lines show their counts
 * ("575 buildings · … · 4.2 ms/frame", "12 zones · 0 queued · …"). Off for
 * normal play, the dev server included: a dev build shows them only once the
 * `bymr.devStats` switch is set, and a production build never does.
 */
export const devStats = (): boolean => forcedStats ?? (import.meta.env.DEV && storedStats());

/** For tests: shows the counts, or hides them, whatever the build and switch; null goes back to those. */
export const setDevStats = (on: boolean | null): void => {
  forcedStats = on;
};
