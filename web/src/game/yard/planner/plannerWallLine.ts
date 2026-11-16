import type { SpotCheck } from "../BuildPlacement";
import type { Point } from "../YardGrid";
import { planLine, polylinePath, snapAnchor, type LineBudget, type LinePlan } from "../wallLine";

/**
 * The Yard Planner's wall line (owner, 16 Nov 2026, beta 8 item 3): the same
 * corner-tap line as building walls (`BuildPlacement` line mode, maths in
 * `wallLine.ts`), drawing from the walls in the Planner's drawer instead of
 * the purse.
 *
 * Each tap or click puts a corner down; the stretch between two corners is
 * straight or one L-bend ({@link polylinePath}). With a mouse the next
 * stretch follows the pointer; a second tap on the last corner straight away
 * (a double-click or a double-tap) ends the line, so the live stretch stops
 * following; ✓ Place puts the green Blocks down. Backspace, a right-click or
 * ↶ takes the last corner away.
 *
 * What each Block comes to is {@link planLine}'s: green will be placed, red is
 * blocked (off the plot or on a building, skipped), grey is past the walls
 * left in the drawer (not placed). Nothing here costs anything: the budget is
 * the drawer's stock, so a grey Block always means "no wall left for it".
 *
 * No Pixi and no DOM: the session feeds it spots in yard units and draws
 * what {@link PlannerWallLine.plan} answers.
 */

/** A second tap on the last corner within this many milliseconds ends the line. */
export const DOUBLE_TAP_MS = 450;

/** What a tap did: a new corner, the line ended, or nothing (the same corner again, slowly). */
export type LineTapResult = "corner" | "finish" | "none";

/** No price: the drawer's walls are already the player's. */
const FREE = { r1: 0, r2: 0, r3: 0, r4: 0 } as const;

/** The drawer's walls as a line budget: nothing to pay, `stock` Blocks to place. */
export const drawerBudget = (stock: number): LineBudget => ({
  afford: Number.POSITIVE_INFINITY,
  room: Math.max(0, stock),
});

/** The stack a line draws from: one type and level, as the drawer groups it. */
export interface LineStack {
  readonly type: number;
  readonly level: number;
}

export class PlannerWallLine {
  readonly type: number;
  readonly level: number;
  /** One Block's width in yard units: the step between Blocks. */
  readonly step: number;

  private anchorList: Point[] = [];
  private hoverSpot: Point | null = null;
  private ended = false;
  private lastTap: { x: number; y: number; at: number } | null = null;

  constructor(stack: LineStack, step: number) {
    this.type = stack.type;
    this.level = stack.level;
    this.step = step;
  }

  /** The corners put down so far, each on the Block its stretch ends on. */
  get anchors(): readonly Point[] {
    return this.anchorList;
  }

  /** The pointer's spot, which the live stretch runs to, or null. */
  get hover(): Point | null {
    return this.hoverSpot;
  }

  /** A double-tap ended the line: no live stretch until the next corner. */
  get finished(): boolean {
    return this.ended;
  }

  /**
   * A tap or click at `spot` (a footprint origin, snapped). The first is the
   * start; each later one fixes the stretch from the corner before it, and is
   * kept on the Block that stretch really ends on ({@link snapAnchor}). The
   * last corner tapped again within {@link DOUBLE_TAP_MS} ends the line; a
   * slower tap there adds nothing.
   */
  tap(spot: Point, now: number): LineTapResult {
    const last = this.anchorList[this.anchorList.length - 1];
    const anchor = last ? snapAnchor(last, spot, this.step) : { x: spot.x, y: spot.y };
    const previous = this.lastTap;
    this.lastTap = { x: anchor.x, y: anchor.y, at: now };
    if (last && last.x === anchor.x && last.y === anchor.y) {
      if (previous && previous.x === anchor.x && previous.y === anchor.y && now - previous.at <= DOUBLE_TAP_MS) {
        // A third quick tap is not a fourth: the next one starts afresh.
        this.lastTap = null;
        this.ended = true;
        return "finish";
      }
      return "none";
    }
    this.anchorList.push(anchor);
    this.ended = false;
    return "corner";
  }

  /** The mouse moved to `spot` (null: it left the yard). True when the live stretch changed. */
  hoverAt(spot: Point | null): boolean {
    const was = this.hoverSpot;
    if (was === spot || (was && spot && was.x === spot.x && was.y === spot.y)) return false;
    this.hoverSpot = spot ? { x: spot.x, y: spot.y } : null;
    return this.anchorList.length > 0 && !this.ended;
  }

  /** Takes the last corner away. False when there was none. */
  undo(): boolean {
    if (this.anchorList.length === 0) return false;
    this.anchorList.pop();
    this.ended = false;
    this.lastTap = null;
    return true;
  }

  /** Ends the line where it is (the double-click): the live stretch stops following. */
  finish(): void {
    if (this.anchorList.length > 0) this.ended = true;
  }

  /** Lets the whole line go (Escape, ✗, after it is placed); the stack stays armed. */
  clear(): void {
    this.anchorList = [];
    this.ended = false;
    this.lastTap = null;
  }

  /**
   * What each Block comes to, given `stock` walls left on the stack. With
   * `live`, the stretch to the pointer counts too (the preview); without it,
   * only the corners put down (what ✓ places). Null with no corner.
   */
  plan(check: (x: number, y: number) => SpotCheck, stock: number, live: boolean): LinePlan | null {
    if (this.anchorList.length === 0) return null;
    const tail = live && !this.ended ? this.hoverSpot : null;
    const path = polylinePath(this.anchorList, this.step, tail);
    return planLine(path, check, drawerBudget(stock), FREE);
  }
}
