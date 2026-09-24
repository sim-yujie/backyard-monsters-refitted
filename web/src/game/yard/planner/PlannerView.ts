import type { Rect } from "../YardGrid";
import { YardView, type YardRenderer } from "../YardRenderer";
import { blueprintDragToYard } from "./blueprint";
import { polygonIntersectsRect } from "./marquee";
import { dragToYard } from "./placement";
import type { Plan } from "./plan";

/**
 * Everything the planner asks of the renderer.
 *
 * The session owns the plan, the selection and the history; this owns the one
 * question that needs both the plan and the screen — where should each
 * building be drawn — and the ones that need only the screen: what is under a
 * point, which footprints a marquee touches, what a pixel drag is in yard
 * units, and what chrome to draw.
 *
 * Keeping it apart is what stops the session growing a second job. It is also
 * the only place the session meets a world pixel: the renderer answers every
 * question in whichever view is showing, so the session never learns whether
 * the yard is isometric or flat.
 */

export class PlannerView {
  private readonly renderer: YardRenderer;
  private readonly plan: Plan;

  constructor(options: { renderer: YardRenderer; plan: Plan }) {
    this.renderer = options.renderer;
    this.plan = options.plan;
  }

  /** Which drawing of the yard is showing. */
  get view(): YardView {
    return this.renderer.view;
  }

  /**
   * Draws a building where the plan says it is, plus an optional drag offset.
   *
   * The position is recomputed from the plan every time rather than
   * accumulated, so a long session of drags, undos and loads cannot walk a
   * sprite away from its building.
   */
  sync(id: number, dx = 0, dy = 0): void {
    const node = this.plan.get(id);
    if (!node) return;
    this.renderer.placeBuilding(id, node.x + dx, node.y + dy);
  }

  /** Redraws a set of buildings, shifted by a live drag. */
  syncSome(ids: Iterable<number>, dx = 0, dy = 0): void {
    for (const id of ids) this.sync(id, dx, dy);
  }

  /** Redraws the whole yard: what undo, redo and a load need. */
  syncAll(): void {
    for (const node of this.plan.buildings()) this.sync(node.id);
  }

  /** Re-stacks the draw list. Worth doing on a commit, not on a drag. */
  resort(): void {
    this.renderer.resortByDepth();
  }

  /** The building under a world point, or null. */
  pick(worldX: number, worldY: number): number | null {
    return this.renderer.pick(worldX, worldY)?.id ?? null;
  }

  /** A world-pixel drag in snapped yard units, in the view that is showing. */
  dragToYard(worldDx: number, worldDy: number): { dx: number; dy: number } {
    return this.view === YardView.BLUEPRINT
      ? blueprintDragToYard(worldDx, worldDy)
      : dragToYard(worldDx, worldDy);
  }

  /** Every building whose footprint the rectangle touches. */
  inMarquee(rect: Rect): Set<number> {
    const hit = new Set<number>();
    for (const node of this.plan.buildings()) {
      const corners = this.renderer.cornersOf(node.id);
      if (corners && polygonIntersectsRect(corners, rect)) hit.add(node.id);
    }
    return hit;
  }

  /** Updates the selection, moved, planned and invalid chrome and the marquee. */
  draw(state: {
    selected: ReadonlySet<number>;
    moved: ReadonlySet<number>;
    invalid: ReadonlySet<number>;
    /** Planned target level by id, for the badge and the blueprint labels. */
    planned: ReadonlyMap<number, number> | null;
    marquee: Rect | null;
  }): void {
    this.renderer.setPlannerVisuals({ ...state, plot: this.renderer.plotCorners() });
  }

  /** Puts every sprite back where the save had it and hides the chrome. */
  reset(): void {
    this.renderer.resetPlacements();
    this.renderer.setPlannerVisuals(null);
  }
}
