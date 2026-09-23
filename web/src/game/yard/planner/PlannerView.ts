import { toIso, type Rect } from "../YardGrid";
import type { Yard, YardBuilding } from "../yardModel";
import type { YardRenderer } from "../YardRenderer";
import { diamondIntersectsRect } from "./marquee";
import type { Plan } from "./plan";

/**
 * Everything the planner asks of the renderer.
 *
 * The session owns the plan, the selection and the history; this owns the one
 * question that needs both the plan and the screen — where should each
 * building's sprites be drawn — and the two that need only the screen: which
 * footprints a marquee touches, and what chrome to draw.
 *
 * Keeping it apart is what stops the session growing a second job. It is also
 * the only place a world pixel and a yard unit meet, so a drift between the
 * plan and what is on screen can come from exactly one function.
 */

export class PlannerView {
  private readonly renderer: YardRenderer;
  private readonly plan: Plan;
  private readonly byId = new Map<number, YardBuilding>();
  private readonly plot: readonly { x: number; y: number }[];

  constructor(options: { yard: Yard; renderer: YardRenderer; plan: Plan }) {
    this.renderer = options.renderer;
    this.plan = options.plan;
    this.plot = options.yard.bounds.corners;
    for (const building of options.yard.buildings) this.byId.set(building.id, building);
  }

  /** Every building id the yard has, in draw order. */
  ids(): IterableIterator<number> {
    return this.byId.keys();
  }

  /**
   * Draws a building where the plan says it is, plus an optional drag offset.
   *
   * The offset is recomputed from the plan against the saved position every
   * time rather than accumulated, so a long session of drags, undos and loads
   * cannot walk a sprite away from its building.
   */
  sync(id: number, dx = 0, dy = 0): void {
    const node = this.plan.get(id);
    const building = this.byId.get(id);
    if (!node || !building) return;
    const from = toIso(building.x, building.y);
    const to = toIso(node.x + dx, node.y + dy);
    this.renderer.offsetBuilding(id, to.x - from.x, to.y - from.y);
  }

  /** Redraws a set of buildings, shifted by a live drag. */
  syncSome(ids: Iterable<number>, dx = 0, dy = 0): void {
    for (const id of ids) this.sync(id, dx, dy);
  }

  /** Redraws the whole yard: what undo, redo and a load need. */
  syncAll(): void {
    for (const id of this.byId.keys()) this.sync(id);
  }

  /** Re-stacks the draw list. Worth doing on a commit, not on a drag. */
  resort(): void {
    this.renderer.resortByDepth();
  }

  /** The building under a world point, or null. */
  pick(worldX: number, worldY: number): number | null {
    return this.renderer.pick(worldX, worldY)?.id ?? null;
  }

  /** Every building whose footprint the rectangle touches. */
  inMarquee(rect: Rect): Set<number> {
    const hit = new Set<number>();
    for (const id of this.byId.keys()) {
      const shape = this.renderer.shapeOf(id);
      if (shape && diamondIntersectsRect(shape, rect)) hit.add(id);
    }
    return hit;
  }

  /** Updates the selection, moved and invalid chrome and the marquee. */
  draw(state: {
    selected: ReadonlySet<number>;
    moved: ReadonlySet<number>;
    invalid: ReadonlySet<number>;
    marquee: Rect | null;
  }): void {
    this.renderer.setPlannerVisuals({ ...state, plot: this.plot });
  }

  /** Puts every sprite back where the save had it and hides the chrome. */
  reset(): void {
    for (const id of this.byId.keys()) this.renderer.offsetBuilding(id, 0, 0);
    this.renderer.resortByDepth();
    this.renderer.setPlannerVisuals(null);
  }
}
