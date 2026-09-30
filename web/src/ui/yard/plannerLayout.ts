import { formatCompact, formatCountdown } from "@/ui/format";
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

/** The four pool resources, which is what a cost is made of. */
type PoolKey = (typeof RESOURCE_KEYS)[number];

/** One figure on a phone's cost line. */
export interface CostLinePart {
  readonly key: PoolKey | "time";
  readonly text: string;
  /** More is needed than the yard holds. */
  readonly short: boolean;
}

/**
 * The costs a phone has room for: one line, only what is not zero.
 *
 * The desktop's nine cells read "needed / held" and take a row of their own,
 * which a phone cannot spare, and most of them are zero most of the time. So
 * the line names what the selection or the plan would take, compact ("500.0K"),
 * then the worker time; the full cells are one tap away. Empty when nothing
 * costs anything, and the caller says something else there instead.
 */
export const costLineParts = (
  needed: Readonly<Record<PoolKey, number>>,
  shortfall: Readonly<Record<PoolKey, number>>,
  seconds: number,
): CostLinePart[] => {
  const parts: CostLinePart[] = [];
  for (const key of RESOURCE_KEYS) {
    if (needed[key] <= 0) continue;
    parts.push({ key, text: formatCompact(needed[key]), short: shortfall[key] > 0 });
  }
  if (seconds > 0) parts.push({ key: "time", text: formatCountdown(seconds), short: false });
  return parts;
};

/**
 * What a notice calls undo: the key on a keyboard, the button on a touched
 * screen, which has no Ctrl+Z to press (#45). "Ctrl+Z puts them back".
 */
export const undoName = (touch: boolean): string => (touch ? "Undo" : "Ctrl+Z");
