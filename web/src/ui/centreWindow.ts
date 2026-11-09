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
 * - **Never over the dock** (tester, 9 Nov). The band's bottom is measured,
 *   not guessed: {@link fitCentreWindow} keeps the window above the top of
 *   every dock button under it (More, Monsters, Build, Collect all, Main
 *   yard, Map, Add friends, their words and badges, in either look), and
 *   narrows a window that would reach the button column under the HUD's
 *   right end (Events), close X included. A window short of room gets
 *   shorter, its body scrolling; it never comes down over the buttons.
 * - **Notices stay readable.** While a middle window is open the yard's
 *   notices (a claim's "Day 1 claimed") hang just under its title bar rather
 *   than on it, so the name plate and close X stay in sight. Nothing moves to
 *   make room: the window keeps its place and the notice covers the top of
 *   its body until it goes.
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

/** A box in px from the overlay layer's top-left corner. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Where a middle window may go, as {@link fitCentreWindow} works it out. */
export interface CentreFit {
  /** A cap on the window's width in px, or null when its own width clears the side columns. */
  readonly maxWidth: number | null;
  /** The px kept free under the window: from the layer's bottom to the window's lowest edge. */
  readonly bottom: number;
}

/** Between the window's bottom edge and the top of the dock button under it. */
export const CENTRE_DOCK_GAP = 12;
/** Between the window's side and the button column under the HUD: the close X hangs ~16px out. */
export const CENTRE_SIDE_GAP = 28;
/** Under the window when no dock button is below it. */
export const CENTRE_MIN_BOTTOM = 16;
/** A dock button this near the window's side counts as under it. */
const OVERLAP_SLACK = 8;

/**
 * Where a window `width` px wide may go in a `layer` holding the dock's
 * buttons at `buttons`. A button in the top half of the layer near its left
 * or right edge (Events, under the HUD) is a side column: the window is
 * narrowed to stay clear of it, by the same on both sides so it stays
 * centred. A button in the bottom half is the dock row: the window's bottom
 * stays above the top of every one under it.
 */
export const fitCentreWindow = (
  layer: { readonly width: number; readonly height: number },
  width: number,
  buttons: readonly Box[],
): CentreFit => {
  let side = 0;
  const row: Box[] = [];
  for (const box of buttons) {
    const middleX = (box.left + box.right) / 2;
    if ((box.top + box.bottom) / 2 >= layer.height / 2) row.push(box);
    else if (middleX > (layer.width * 3) / 4) side = Math.max(side, layer.width - box.left);
    else if (middleX < layer.width / 4) side = Math.max(side, box.right);
  }
  const cap = side > 0 ? Math.max(0, Math.floor(layer.width - 2 * (side + CENTRE_SIDE_GAP))) : Infinity;
  const kept = Math.min(width, cap);
  const left = (layer.width - kept) / 2;
  const right = left + kept;
  let bottom = CENTRE_MIN_BOTTOM;
  for (const box of row) {
    if (box.right > left - OVERLAP_SLACK && box.left < right + OVERLAP_SLACK) {
      bottom = Math.max(bottom, layer.height - box.top + CENTRE_DOCK_GAP);
    }
  }
  return { maxWidth: width > cap ? cap : null, bottom: Math.ceil(bottom) };
};

/** The dock's buttons as laid out in the yard (not the More fan's bubbles, which fold away). */
const DOCK_BUTTONS = [
  ":scope > .yard-dock > :not(.yard-dock__left, .yard-dock__right, .yard-menu)",
  ":scope > .yard-dock > .yard-dock__left > *",
  ":scope > .yard-dock > .yard-dock__right > *",
  ":scope > .friends-bar",
].join(", ");

/** The badges that sit on a button's rim, partly outside its box. */
const BADGES = "[class*='__badge'], [class*='__count']";

const visibleBox = (element: Element): DOMRect | null => {
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  return getComputedStyle(element).visibility === "hidden" ? null : box;
};

/** Each dock button's box with its badges, from the layer's corner. */
const dockBoxes = (layer: HTMLElement, origin: DOMRect): Box[] => {
  const boxes: Box[] = [];
  for (const button of layer.querySelectorAll(DOCK_BUTTONS)) {
    const box = visibleBox(button);
    if (!box) continue;
    let { left, top, right, bottom } = box;
    for (const badge of button.querySelectorAll(BADGES)) {
      if (badge.closest(".bubble-menu__fan")) continue;
      const rim = visibleBox(badge);
      if (!rim) continue;
      left = Math.min(left, rim.left);
      top = Math.min(top, rim.top);
      right = Math.max(right, rim.right);
      bottom = Math.max(bottom, rim.bottom);
    }
    boxes.push({
      left: left - origin.left,
      top: top - origin.top,
      right: right - origin.left,
      bottom: bottom - origin.top,
    });
  }
  return boxes;
};

/**
 * Places the open middle window clear of the dock and the Events column
 * (`max-width` and ui.css's `--centre-bottom`, inline on the window) and
 * tells ui.css where the yard's notices go (`--centre-notice-top` on the
 * layer). A phone's sheets, and a scene without the yard's dock, keep
 * ui.css's own places.
 */
const layoutCentreWindow = (element: HTMLElement): void => {
  const layer = element.parentElement;
  if (!layer || !shown(element)) return;
  const style = element.style;
  style.removeProperty("max-width");
  if (!centredLayout() || layer.querySelector(":scope > .yard-dock") === null) {
    style.removeProperty("--centre-bottom");
    layer.style.removeProperty("--centre-notice-top");
    return;
  }
  const origin = layer.getBoundingClientRect();
  if (origin.width <= 0 || origin.height <= 0) return;
  const fit = fitCentreWindow(origin, element.offsetWidth, dockBoxes(layer, origin));
  if (fit.maxWidth !== null) style.maxWidth = `${fit.maxWidth}px`;
  style.setProperty("--centre-bottom", `${fit.bottom}px`);
  const bar = element.querySelector(":scope > .panel__titlebar");
  const head = (bar ?? element).getBoundingClientRect();
  const under = bar ? head.bottom : head.top + 48;
  layer.style.setProperty("--centre-notice-top", `${Math.round(under - origin.top + 8)}px`);
};

/* The open window is laid out again as it or the screen changes size (a tab
   change, its content loading, the browser resized). */
let watcher: ResizeObserver | null = null;
let watched: HTMLElement | null = null;
let resizeHeard = false;

const relayout = (): void => {
  if (current) layoutCentreWindow(current.element);
};

const watch = (element: HTMLElement): void => {
  if (typeof window === "undefined") return;
  if (!resizeHeard) {
    window.addEventListener("resize", relayout);
    resizeHeard = true;
  }
  if (typeof ResizeObserver === "undefined" || watched === element) return;
  watcher ??= new ResizeObserver(relayout);
  if (watched) watcher.unobserve(watched);
  watcher.observe(element);
  watched = element;
};

const unwatch = (element: HTMLElement): void => {
  if (watched !== element) return;
  watcher?.unobserve(element);
  watched = null;
};

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
      layoutCentreWindow(element);
      watch(element);
    },
    closed() {
      if (current === entry) current = null;
      unwatch(element);
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
