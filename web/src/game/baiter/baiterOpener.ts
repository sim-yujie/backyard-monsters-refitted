import type { BaiterView } from "@/game/yard/yardIntent";

/**
 * The way to the Baiter window's friend tabs from elsewhere (beta 9 #4): an
 * invite notice opens Invited me, a finished test's notice opens Results. The
 * main yard registers how to open it while it is on screen and clears it when
 * it goes, as the Friends screen's door does (`friendsView.ts`).
 */

let opener: ((view: BaiterView) => void) | null = null;

/** Sets how to open the window; null when it cannot be opened. Returns an undo for that opener. */
export const setBaiterOpener = (open: ((view: BaiterView) => void) | null): (() => void) => {
  opener = open;
  return () => {
    if (opener === open) opener = null;
  };
};

/** How to open the window now, or null. */
export const baiterOpener = (): ((view: BaiterView) => void) | null => opener;
