import type { Yard } from "../yardModel";
import type { MoveEntry } from "./commands";
import {
  isDecoration,
  Occupancy,
  plotBounds,
  validateOffset,
  validatePlan,
  type PlacementResult,
  type PlanNode,
  type PlotBounds,
} from "./placement";

/**
 * The editable copy of the yard.
 *
 * The planner mutates only this until Apply, exactly as the original did
 * (`BASE.applyTemplate` is the single writer, `BASE.as:5025-5041`). So the real
 * yard is never half-edited, undo is local and cheap, and leaving without
 * applying is a discard rather than a repair.
 *
 * The plan owns the occupancy grid because the grid and the positions have to
 * agree at all times: every path that changes a position goes through `move`,
 * and `beginMove` / `commitMove` are the only way the grid is opened up.
 */

/**
 * Mushroom ids start here so they cannot collide with a building id.
 *
 * The occupancy grid stores `id + 1` per cell and reads 0 as empty, so ids have
 * to be positive; mushrooms have their own id space in the save and nothing
 * stops it overlapping the buildings'.
 */
export const MUSHROOM_ID_BASE = 1_000_000;

/** Mushroom footprint, `client/scripts/BUILDING7.as:9-10`. */
const MUSHROOM_TYPE = 7;
const MUSHROOM_SIZE = 30;

export class Plan {
  readonly plot: PlotBounds;
  readonly expansion: number;

  private readonly nodes = new Map<number, PlanNode>();
  /** Where each building sat when the planner opened, for the moved outline. */
  private readonly origin = new Map<number, readonly [number, number]>();
  private readonly occupancy = new Occupancy();

  /** The selection currently picked up, or null when nothing is being dragged. */
  private lifted: PlanNode[] | null = null;

  private constructor(expansion: number) {
    this.expansion = expansion;
    this.plot = plotBounds(expansion);
  }

  /**
   * Snapshots a yard.
   *
   * Every building becomes a movable node and every mushroom a fixed one, so a
   * drag is blocked by a mushroom the same way it is blocked by a tower and the
   * validator needs no second rule for obstacles.
   */
  static fromYard(yard: Yard): Plan {
    const plan = new Plan(yard.expansionLevel);

    for (const building of yard.buildings) {
      const [width, height] = building.footprint;
      plan.add({
        id: building.id,
        type: building.type,
        x: building.x,
        y: building.y,
        width,
        height,
        level: building.level,
        fort: building.fortification,
        decoration: isDecoration(building.type),
        fixed: false,
      });
    }

    for (const mushroom of yard.mushrooms) {
      plan.add({
        id: MUSHROOM_ID_BASE + mushroom.id,
        type: MUSHROOM_TYPE,
        x: mushroom.x,
        y: mushroom.y,
        width: MUSHROOM_SIZE,
        height: MUSHROOM_SIZE,
        level: 1,
        fort: 0,
        decoration: false,
        fixed: true,
      });
    }

    return plan;
  }

  /** Every node, obstacles included. */
  all(): IterableIterator<PlanNode> {
    return this.nodes.values();
  }

  get size(): number {
    return this.nodes.size;
  }

  get(id: number): PlanNode | undefined {
    return this.nodes.get(id);
  }

  /** Every node by id, for lookups that would otherwise be a loop. */
  index(): ReadonlyMap<number, PlanNode> {
    return this.nodes;
  }

  /** Buildings only: what a layout saves and what Apply moves. */
  buildings(): PlanNode[] {
    return [...this.nodes.values()].filter((node) => !node.fixed);
  }

  /** Whether a building is somewhere other than where the yard had it. */
  hasMoved(id: number): boolean {
    const node = this.nodes.get(id);
    const start = this.origin.get(id);
    if (!node || !start) return false;
    return node.x !== start[0] || node.y !== start[1];
  }

  /** Every building that is not where it started. */
  movedIds(): number[] {
    const moved: number[] = [];
    for (const node of this.nodes.values()) {
      if (!node.fixed && this.hasMoved(node.id)) moved.push(node.id);
    }
    return moved;
  }

  /** Checks the whole plan: the pre-Apply checklist's overlap and bounds rows. */
  validate(): PlacementResult {
    // Re-stamping into the plan's own grid is what rebuilds it, so the check
    // and the repair are the same pass: whatever was lifted is put back down.
    this.lifted = null;
    return validatePlan(this.nodes.values(), this.plot, this.occupancy);
  }

  /* ── Moving ─────────────────────────────────────────────────────────── */

  /**
   * Picks a selection up: its cells come out of the grid so the drag can test
   * against everything else with a single array read per cell and no "is this
   * one of mine" check in the loop.
   */
  beginMove(ids: Iterable<number>): PlanNode[] {
    this.cancelMove();
    const lifted: PlanNode[] = [];
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (!node || node.fixed) continue;
      this.occupancy.erase(node);
      lifted.push(node);
    }
    this.lifted = lifted;
    return lifted;
  }

  /** Whether the lifted selection would be legal shifted by `(dx, dy)`. */
  testMove(dx: number, dy: number): PlacementResult {
    const lifted = this.lifted;
    if (!lifted || lifted.length === 0) return { valid: true, issues: [] };
    return validateOffset(lifted, dx, dy, this.occupancy, this.plot);
  }

  /**
   * Drops the lifted selection at `(dx, dy)`.
   *
   * Returns the before-and-after positions for the undo stack, or null when the
   * move was refused or changed nothing. Either way the grid is closed again,
   * so a refused drop leaves the plan exactly as it was.
   */
  commitMove(dx: number, dy: number): MoveEntry[] | null {
    const lifted = this.lifted;
    this.lifted = null;
    if (!lifted || lifted.length === 0) return null;

    const refused =
      (dx === 0 && dy === 0) || !validateOffset(lifted, dx, dy, this.occupancy, this.plot).valid;
    if (refused) {
      for (const node of lifted) this.occupancy.stamp(node);
      return null;
    }

    const entries: MoveEntry[] = lifted.map((node) => ({
      id: node.id,
      fromX: node.x,
      fromY: node.y,
      toX: node.x + dx,
      toY: node.y + dy,
    }));

    for (const node of lifted) {
      node.x += dx;
      node.y += dy;
      this.occupancy.stamp(node);
    }
    return entries;
  }

  /** Puts a lifted selection back without moving it. */
  cancelMove(): void {
    const lifted = this.lifted;
    if (!lifted) return;
    this.lifted = null;
    for (const node of lifted) this.occupancy.stamp(node);
  }

  /**
   * Applies or reverses a recorded move. The undo stack's only writer.
   *
   * Every node is erased before any is stamped: doing it one at a time would
   * have two buildings share a cell mid-batch and the second erase would clear
   * both, leaving a hole where a wall still stands.
   */
  move(entries: readonly MoveEntry[], reverse: boolean): void {
    const pairs: [PlanNode, MoveEntry][] = [];
    for (const entry of entries) {
      const node = this.nodes.get(entry.id);
      // A building the yard no longer has is skipped rather than faulted: the
      // stack can outlive a reload that changed the save.
      if (!node) continue;
      this.occupancy.erase(node);
      pairs.push([node, entry]);
    }
    for (const [node, entry] of pairs) {
      node.x = reverse ? entry.fromX : entry.toX;
      node.y = reverse ? entry.fromY : entry.toY;
    }
    for (const [node] of pairs) this.occupancy.stamp(node);
  }

  /** Puts a building at an absolute position. Used by the load path. */
  setPosition(id: number, x: number, y: number): void {
    const node = this.nodes.get(id);
    if (!node || node.fixed) return;
    this.occupancy.erase(node);
    node.x = x;
    node.y = y;
    this.occupancy.stamp(node);
  }

  private add(node: PlanNode): void {
    this.nodes.set(node.id, node);
    this.origin.set(node.id, [node.x, node.y]);
    this.occupancy.stamp(node);
  }
}
