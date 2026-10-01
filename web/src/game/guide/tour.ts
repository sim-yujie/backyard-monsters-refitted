/**
 * Where Help's "Replay the guided start" goes (issue #227, decision Q5): the
 * own yard's guided start plugin offers a tour while it is mounted, and the
 * account menu asks for it. Nothing else is shared: the tour calls no route,
 * grants nothing, builds nothing and opens no camp.
 */

type TourHandler = () => void;

let handler: TourHandler | null = null;

/** Offers the tour (the yard plugin, on mount); returns the withdrawal. */
export const offerGuideTour = (run: TourHandler): (() => void) => {
  handler = run;
  return () => {
    if (handler === run) handler = null;
  };
};

/** Whether a tour can start here (the own yard is up and the guided start is not running). */
export const guideTourAvailable = (): boolean => handler !== null;

/** Starts the tour; false when none is on offer. */
export const startGuideTour = (): boolean => {
  if (!handler) return false;
  handler();
  return true;
};
