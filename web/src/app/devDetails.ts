/**
 * Whether the screens show developer details (#150): the yard's and the
 * attack's status-line counts, frame time and building ids, a building's
 * type id, footprint, position and art file in its Details, a cell's
 * alliance id. Players see names and the facts they decide with; the details
 * are for whoever is building the client, so they show in a dev build
 * (`import.meta.env.DEV`, `npm run dev`) and never in a production one. The
 * frame-time readout a player can still open to report lag is the separate
 * PerfOverlay (backtick or F8, `ui/PerfOverlay.ts`).
 */

let forced: boolean | null = null;

export const devDetails = (): boolean => forced ?? import.meta.env.DEV;

/** For tests: shows the details, or hides them, whatever the build; null goes back to the build's. */
export const setDevDetails = (on: boolean | null): void => {
  forced = on;
};
