/**
 * Middle windows (owner, 9 Nov 2026, option A).
 *
 * On a computer the game's windows open in the true middle of the screen, as
 * the pop-ups do and as Flash did, instead of some docked right, some left
 * and some at the top. One shared piece does it for all of them:
 *
 * - **Where.** {@link CENTRE_WINDOW_CLASS} on the window's `.panel`; ui.css
 *   centres it on both axes in the band between the HUD and the dock row.
 *   Each window keeps its own width, and its own height through
 *   `--centre-height` (else it fits its content), never taller than the band.
 *   A phone, upright or on its side, keeps each window's own sheet.
 * - **One at a time.** {@link centreWindow} gives the window an `opened` and
 *   a `closed` to call; opening one closes the middle window open before it.
 * - **The building panel makes way.** {@link onCentreWindowOpen} tells the
 *   yard, which closes its building panel, as the Build menu always did.
 *
 * Only four things stay at the side on purpose: the building panel (so the
 * building clicked stays in view), the Yard Planner's tools, world chat and
 * the attack screen's tools. None of them uses this.
 */

/** The class ui.css centres a window by. */
export const CENTRE_WINDOW_CLASS = "panel--centre";

/** A middle window's link to the shared piece. */
export interface CentreWindow {
  /** Call as the window shows: closes the middle window open before it. */
  opened(): void;
  /** Call as the window shuts or hides. */
  closed(): void;
}

interface Entry {
  readonly element: HTMLElement;
  readonly close: () => void;
}

let current: Entry | null = null;
const listeners = new Set<() => void>();

/** Still on the page and not hidden: a scene left without closing its windows leaves stale ones. */
const shown = (element: HTMLElement): boolean => element.isConnected && !element.hidden;

/**
 * Makes `element` a middle window: adds the class and returns its
 * `opened`/`closed`. `close` is how another window's opening shuts this one.
 */
export const centreWindow = (element: HTMLElement, close: () => void): CentreWindow => {
  element.classList.add(CENTRE_WINDOW_CLASS);
  const entry: Entry = { element, close };
  return {
    opened() {
      const before = current;
      current = entry;
      if (before && before !== entry && shown(before.element)) before.close();
      for (const listener of [...listeners]) listener();
    },
    closed() {
      if (current === entry) current = null;
    },
  };
};

/** Hears every middle window's opening (the yard closes its building panel). Returns the unsubscribe. */
export const onCentreWindowOpen = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Closes the open middle window, if any (a building's panel opening). */
export const closeCentreWindow = (): void => {
  const open = current;
  current = null;
  if (open && shown(open.element)) open.close();
};

/** The open middle window's element, or null. */
export const openCentreWindow = (): HTMLElement | null =>
  current && shown(current.element) ? current.element : null;

/** The screens ui.css centres middle windows on: not a phone, upright or on its side. */
export const CENTRED_LAYOUT_QUERY = "(width > 620px) and (height > 500px)";

/**
 * Whether windows open in the middle here. A phone keeps its sheets, and
 * with them its old ways: a monster building's click still opens its tab
 * over the panel, which waits under the sheet. True where nothing can tell
 * (a test's page without `matchMedia`).
 */
export const centredLayout = (): boolean =>
  typeof window.matchMedia !== "function" || window.matchMedia(CENTRED_LAYOUT_QUERY).matches;
