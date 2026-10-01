/**
 * The tutorial's targets: a name for every control or thing on the canvas Bob
 * can point at, resolved to where it is on screen right now (issue #227,
 * `docs/design/tutorial.md` §2.2).
 *
 * DOM controls carry a `data-tut="<name>"` attribute, set by the foundation
 * package's sweep through {@link tutTarget}. Things drawn on the canvas (a
 * building, the building in hand, the practice attack's drop box) are
 * registered by whoever draws them with {@link registerCanvasTarget}, as a
 * function that answers the current screen rectangle, because the camera moves.
 *
 * A name may carry a parameter after a colon: `build-card:21`,
 * `building:7`. A DOM control is tagged with the full name; a canvas
 * resolver registered under the bare prefix (`"building:"`) answers every
 * name that starts with it and is handed the parameter.
 */

/** The attribute every DOM target carries. */
export const TUT_ATTRIBUTE = "data-tut";

/**
 * The target names the foundation package put in place, for the packages to
 * point at without guessing. Parameterised ones are prefixes.
 */
export const TutTarget = {
  COLLECT_ALL: "collect-all",
  DOCK_BUILD: "dock-build",
  DOCK_MAP: "dock-map",
  DOCK_MONSTERS: "dock-monsters",
  DOCK_LAYOUT: "dock-layout",
  /** Package (a) tags the Goals button it adds to the dock. */
  DOCK_GOALS: "dock-goals",
  DOCK_MAIL: "dock-mail",
  DOCK_YARDS: "dock-yards",
  BUILD_TAB: "build-tab:",
  BUILD_CARD: "build-card:",
  BUILD_NEXT_PAGE: "build-next-page",
  BUILD_GO: "build-go",
  BUILD_INSTANT: "build-instant",
  BUILD_HERE: "build-here",
  BUILD_CANCEL_CARRY: "build-cancel-carry",
  CARRY_GHOST: "carry-ghost",
  BUILDING: "building:",
  FINISH: "finish",
  UPGRADE: "upgrade",
  INSTANT: "instant",
  REPAIR: "repair",
  REPAIR_ALL: "repair-all",
  HUD_SHINY: "hud-shiny",
  SHOP_WORKERS: "shop-workers",
  SHOP_PROTECTION: "shop-protection",
  MAIL_THREADS: "mail-threads",
  MAIL_NEW: "mail-new",
  MONSTERS_TAB: "monsters-tab:",
  MR1_TRIBES: "mr1-tribes",
  MR1_NEIGHBOURS: "mr1-neighbours",
  /** Package (b) tags the practice camp's tile and pin. */
  MR1_PRACTICE: "mr1-practice",
  TARGET_ATTACK: "target-attack",
  MR2_RANGE: "mr2-range",
  MR2_TAKEOVER: "mr2-takeover",
  MR2_FIND: "mr2-find",
  FILL_ALL: "fill-all",
  ATTACK_SPEED: "attack-speed",
  ATTACK_RETREAT: "attack-retreat",
  /** Package (b) registers the practice attack's drop box on the canvas. */
  PRACTICE_BOX: "practice-box",
  ATTACK_HOME: "attack-home",
  BAITER_RUN: "baiter-run",
  CHAMPION_FEED: "champion-feed",
  YARD_SWITCHER: "yard-switcher",
  STARTER_KITS: "starter-kits",
  PLANNER_HELP: "planner-help",
} as const;

/** Tags a DOM control as a target; returns it, so it can wrap a creation. */
export const tutTarget = <E extends HTMLElement>(element: E, name: string): E => {
  element.setAttribute(TUT_ATTRIBUTE, name);
  return element;
};

/** A rectangle on screen, in CSS px from the viewport's top-left. */
export interface TargetRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Answers where a canvas target is now, or null when it is not on screen. */
export type CanvasTargetResolver = (param: string | undefined) => TargetRect | null;

const canvasTargets = new Map<string, CanvasTargetResolver>();

/**
 * Registers a thing drawn on the canvas as a target. `name` is a full name
 * (`"carry-ghost"`) or a prefix ending in a colon (`"building:"`). The latest
 * registration under a name wins; the returned function removes it again,
 * and only if it is still the one registered.
 */
export const registerCanvasTarget = (name: string, resolve: CanvasTargetResolver): (() => void) => {
  canvasTargets.set(name, resolve);
  return () => {
    if (canvasTargets.get(name) === resolve) canvasTargets.delete(name);
  };
};

/** What {@link findTarget} found. */
export interface FoundTarget {
  rect: TargetRect;
  /** The DOM control, or null for a canvas target. */
  element: HTMLElement | null;
}

/** Whether a DOM element is on screen: attached, not hidden, with a size. */
const shown = (element: HTMLElement): boolean => {
  if (!element.isConnected || element.closest("[hidden]")) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

const rectOf = (element: HTMLElement): TargetRect => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
};

/**
 * Where a target is on screen now: the first shown DOM control tagged with
 * the name, else a registered canvas target. Null when it is not on screen,
 * which a tip treats as "skip" and the guided start as "not yet".
 *
 * @param root - Where to look for DOM targets; the whole document by default.
 */
export const findTarget = (name: string, root: ParentNode = document): FoundTarget | null => {
  const selector = `[${TUT_ATTRIBUTE}="${CSS.escape(name)}"]`;
  for (const element of root.querySelectorAll<HTMLElement>(selector)) {
    if (shown(element)) return { rect: rectOf(element), element };
  }

  const exact = canvasTargets.get(name);
  if (exact) {
    const rect = exact(undefined);
    return rect ? { rect, element: null } : null;
  }
  const colon = name.indexOf(":");
  if (colon >= 0) {
    const prefixed = canvasTargets.get(name.slice(0, colon + 1));
    const rect = prefixed?.(name.slice(colon + 1)) ?? null;
    return rect ? { rect, element: null } : null;
  }
  return null;
};

/** Forgets every canvas target (tests). */
export const clearCanvasTargets = (): void => {
  canvasTargets.clear();
};
