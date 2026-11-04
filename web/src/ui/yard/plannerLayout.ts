import { RESOURCE_KEYS } from "@/ui/resourceIcon";

/**
 * Which shape the planner's chrome takes (#45, the owner's Option A).
 *
 * A desktop or a tablet keeps the two full bars it always had. A phone gets
 * slim bars, one sheet at a time and a More sheet for the rest, in one of two
 * shapes: upright, a top bar and a bottom bar of one row each; sideways, one
 * bar along the bottom and the panels down the right, because a bottom sheet
 * in a screen 400 px tall leaves no yard at all.
 *
 * Only phones: the owner kept tablets and desktops as they are, so the tests
 * below are about the screen a phone has rather than about a breakpoint in
 * general. Upright is anything 620 px wide or less, the width the bars' own
 * phone rules (#151) already switch at, so the two cannot disagree. Sideways
 * is a screen 500 px tall or less that is wider than it is tall *and* is
 * touched: a laptop window dragged short keeps its mouse and its full bars.
 */
export const PlannerLayout = {
  DESKTOP: "desktop",
  PORTRAIT: "portrait",
  LANDSCAPE: "landscape",
} as const;
export type PlannerLayout = (typeof PlannerLayout)[keyof typeof PlannerLayout];

/** At or below this width a window is an upright phone. */
export const PHONE_WIDTH = 620;
/** At or below this height a wide, touched screen is a phone on its side. */
export const PHONE_HEIGHT = 500;

export const plannerLayout = (width: number, height: number, coarse: boolean): PlannerLayout => {
  if (coarse && height <= PHONE_HEIGHT && width > height) return PlannerLayout.LANDSCAPE;
  if (width <= PHONE_WIDTH) return PlannerLayout.PORTRAIT;
  return PlannerLayout.DESKTOP;
};

/** True for either phone shape. */
export const isPhone = (layout: PlannerLayout): boolean => layout !== PlannerLayout.DESKTOP;

/**
 * The three things that can fill a phone's one sheet slot (#45): the building
 * sheet, a docked panel (the drawer, the checklist, Find, Layouts, a dialog)
 * and the More sheet.
 */
export type PhoneSheet = "inspector" | "dock" | "more";

/** What `shownSheet` decides from. */
export interface SheetChoice {
  readonly layout: PlannerLayout;
  /** The More sheet is open. */
  readonly moreOpen: boolean;
  /** The sheet the player raised last. */
  readonly raised: PhoneSheet;
  /** Something is docked in the panel slot. */
  readonly dockFilled: boolean;
  /** The building sheet has something in it. */
  readonly inspectorFilled: boolean;
  /**
   * The yard is being kept clear for a move: a building is in hand, or was put
   * down and the player has not tapped or opened anything since.
   */
  readonly yardClear: boolean;
}

/**
 * Which sheet a phone shows: null off a phone, where every panel shows as it
 * always has, and "none" while the yard is kept clear for a move.
 *
 * A phone's sheet covers half the yard: the bottom half upright, the right half
 * on its side. A player reported that picking a building up opened its sheet
 * there, over the spot they were trying to line it up on. So while a building
 * is in hand no sheet shows, and after the drop the yard stays clear until the
 * player taps (which brings the building sheet back) or opens something. More
 * still opens on request, since only the player opens it.
 */
export const shownSheet = (choice: SheetChoice): PhoneSheet | "none" | null => {
  if (!isPhone(choice.layout)) return null;
  if (choice.moreOpen) return "more";
  if (choice.yardClear) return "none";
  if (choice.raised === "dock" && choice.dockFilled) return "dock";
  if (choice.inspectorFilled) return "inspector";
  return "dock";
};

/** The four pool resources, which is what a cost is made of. */
type PoolKey = (typeof RESOURCE_KEYS)[number];

/**
 * A worker time in one unit, rounded down: "45s", "33m", "5h", "12d", and
 * "999d+" past that. The Cost button (owner, 2026-11-04: the bar's
 * figures "will eventually be too long") has room for five characters of
 * time whatever the plan is; the pop-up and the tooltip keep the exact one.
 */
export const formatTimeShort = (seconds: number): string => {
  const whole = Math.floor(seconds);
  if (whole <= 0) return "0s";
  if (whole < 60) return `${whole}s`;
  if (whole < 3_600) return `${Math.floor(whole / 60)}m`;
  if (whole < 86_400) return `${Math.floor(whole / 3_600)}h`;
  const days = Math.floor(whole / 86_400);
  return days > 999 ? "999d+" : `${days}d`;
};

/** What the Cost button shows, on a desktop and a phone: never a resource figure. */
export interface CostButtonState {
  /** Nothing selected or planned costs anything. */
  readonly empty: boolean;
  /** Some resource is needed past what the yard holds. */
  readonly short: boolean;
  /** The worker time, one unit ("33m"), or "" when there is none. */
  readonly time: string;
}

/**
 * The one Cost button (owner, 2026-11-04; a phone's too). The four "needed /
 * held" cells, the time and the shiny price moved into a pop-up over the bar,
 * so the button stays the same short width at 1.2B as at 100: the painted
 * resource pile, a red "!" when anything is short, and the worker time.
 */
export const costButtonState = (
  needed: Readonly<Record<PoolKey, number>>,
  shortfall: Readonly<Record<PoolKey, number>>,
  seconds: number,
): CostButtonState => {
  const costs = RESOURCE_KEYS.some((key) => needed[key] > 0);
  return {
    empty: !costs && seconds <= 0,
    short: RESOURCE_KEYS.some((key) => shortfall[key] > 0),
    time: seconds > 0 ? formatTimeShort(seconds) : "",
  };
};

/**
 * What a notice calls undo: the key on a keyboard, the button on a touched
 * screen, which has no Ctrl+Z to press (#45). "Ctrl+Z puts them back".
 */
export const undoName = (touch: boolean): string => (touch ? "Undo" : "Ctrl+Z");
