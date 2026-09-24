import { kindOf, maxLevel } from "../buildingCosts";
import { holdsWorker } from "../workers";
import { footprintOf } from "../YardGrid";
import type { Yard } from "../yardModel";
import type { MoveEntry, PlanEntry } from "./commands";
import {
  inBounds,
  isDecoration,
  Occupancy,
  plotBounds,
  validateOffset,
  validatePlan,
  validateTargets,
  type NodePlan,
  type PlacementIssue,
  type PlacementResult,
  type PlanNode,
  type PlotBounds,
  type Position,
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

/** Why a bare spot will not take a building. */
export const PlaceBlock = {
  /** Outside the plot for the expansion the account has now. */
  BOUNDS: "bounds",
  /** Held by a building or a mushroom. */
  OCCUPIED: "occupied",
} as const;
export type PlaceBlock = (typeof PlaceBlock)[keyof typeof PlaceBlock];

/** The answer to "could a building of this type go here". */
export interface PlaceCheck {
  /** Null when the spot is free. */
  readonly reason: PlaceBlock | null;
  /** The node already on those cells, when the reason is `occupied`. */
  readonly blockedBy: number | null;
}

const FREE: PlaceCheck = { reason: null, blockedBy: null };

/**
 * What `commitTargets` did.
 *
 * `entries` is null whenever nothing moved, and `issues` then says whether that
 * was because the operation was refused or because it had nothing to do.
 */
export interface TargetCommit {
  readonly entries: MoveEntry[] | null;
  readonly issues: readonly PlacementIssue[];
}

/** What `absorb` changed, for the notice and the tests. */
export interface AbsorbResult {
  /** Buildings the yard has that the plan did not. */
  readonly added: number[];
  /** Buildings the plan had that the yard no longer does. */
  readonly removed: number[];
  /** Buildings whose level or fortification moved. */
  readonly changed: number[];
  /**
   * Buildings whose planned upgrade the yard caught up with, and which
   * therefore no longer have one.
   *
   * Reported rather than silently dropped because the batch wall upgrade
   * raises four hundred walls at once and a bar that quietly loses four
   * hundred plans looks like a bug (`docs/design/planner-upgrades.md` §2.3).
   */
  readonly plansDropped: number[];
}

/**
 * Types that have no ladder to plan an upgrade along.
 *
 * The same three kinds the server refuses a plan on
 * (`server/src/services/yardplanner/validateLayout.ts`,
 * `UNPLANNABLE_KINDS`), so a level this accepts is never a level Apply
 * answers with a 400.
 */
const UNPLANNABLE_KINDS: ReadonlySet<string> = new Set([
  "decoration",
  "mushroom",
  "placeholder",
]);

/** Whether a type can be planned an upgrade at all. */
export const plannableType = (type: number): boolean =>
  maxLevel(type) > 0 && !UNPLANNABLE_KINDS.has(kindOf(type));

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
        plan: null,
        busy: holdsWorker(building),
        damaged: building.hp !== null,
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
        plan: null,
        busy: false,
        damaged: false,
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

  /* ── Planned upgrades ───────────────────────────────────────────────── */

  /**
   * Every building with a planned upgrade, in the order Apply will walk them:
   * ascending `plan.order`, ties broken by id.
   *
   * The same sort the server's walk uses
   * (`server/src/services/yardplanner/startUpgrades.ts`), so the preview and
   * the walk agree on which job runs out of workers.
   */
  plannedNodes(): PlanNode[] {
    return [...this.nodes.values()]
      .filter((node) => node.plan !== null)
      .sort((a, b) => a.plan!.order - b.plan!.order || a.id - b.id);
  }

  /** How many buildings have a plan. */
  get plannedCount(): number {
    let count = 0;
    for (const node of this.nodes.values()) if (node.plan) count++;
    return count;
  }

  /** Planned target level by building id, for the canvas badge and the tiles. */
  plannedLevels(): ReadonlyMap<number, number> {
    const levels = new Map<number, number>();
    for (const node of this.nodes.values()) {
      if (node.plan) levels.set(node.id, node.plan.level);
    }
    return levels;
  }

  /**
   * Plans an upgrade on one building, or clears the plan with `null`.
   *
   * Returns what changed so the caller can push it onto the undo stack, or
   * null when nothing did — which is also how a refusal reads, because every
   * refusal here is a thing the player cannot be shown a button for anyway:
   *
   * - a mushroom or anything else fixed, and any type with no ladder;
   * - a **busy** or **damaged** building, which is F1 rule 3 (design
   *   `yard-planner-redesign.md:131-134`) and which Apply would skip;
   * - a level at or below the one the building already has, or past the top of
   *   its ladder, which is the shape fault the server answers with a 400.
   *
   * A **gated** level is not refused. A player raising their Town Hall in the
   * same plan wants the tower behind it queued too; Apply reports what it
   * could not start (§8, Q5).
   *
   * `order` is kept when only the level changes, so re-aiming a plan does not
   * send it to the back of the queue, and is `max(order) + 1` for a new one.
   */
  setPlan(id: number, level: number | null): PlanEntry | null {
    const node = this.nodes.get(id);
    if (!node || node.fixed) return null;

    const before = node.plan;

    if (level === null) {
      if (!before) return null;
      node.plan = null;
      return { id, before, after: null };
    }

    if (node.busy || node.damaged) return null;
    if (!plannableType(node.type)) return null;
    if (level <= node.level || level > maxLevel(node.type)) return null;
    if (before && before.level === level) return null;

    const after: NodePlan = { level, order: before ? before.order : this.nextOrder() };
    node.plan = after;
    return { id, before, after };
  }

  /**
   * Applies or reverses recorded plan changes. The undo stack's only writer
   * for plans, the counterpart of {@link move}.
   */
  setPlans(entries: readonly PlanEntry[], reverse: boolean): void {
    for (const entry of entries) {
      const node = this.nodes.get(entry.id);
      // As `move`: the stack can outlive a rebase that dropped the building.
      if (!node) continue;
      node.plan = reverse ? entry.before : entry.after;
    }
  }

  /** The order a plan made now would take: one past the last one planned. */
  private nextOrder(): number {
    let highest = -1;
    for (const node of this.nodes.values()) {
      if (node.plan && node.plan.order > highest) highest = node.plan.order;
    }
    return highest + 1;
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

  /**
   * Drops the lifted selection at one position each: mirror, align, distribute.
   *
   * The counterpart of `commitMove` for the operations that move every
   * building by a different amount. It is all-or-nothing by design (F7): if any
   * one of them would leave the plot or land on something, nothing moves at
   * all, and the issues come back so the caller can outline the buildings that
   * caused it. A building the map does not name stays where it is and is still
   * tested, because its neighbour may have been sent on top of it.
   *
   * Either way the grid is closed again before this returns.
   */
  commitTargets(targets: ReadonlyMap<number, Position>): TargetCommit {
    const lifted = this.lifted;
    this.lifted = null;
    if (!lifted || lifted.length === 0) return { entries: null, issues: [] };

    const moving: [PlanNode, Position][] = [];
    for (const node of lifted) {
      const to = targets.get(node.id);
      if (to && (to.x !== node.x || to.y !== node.y)) moving.push([node, to]);
    }

    const result =
      moving.length === 0
        ? { valid: false, issues: [] }
        : validateTargets(lifted, targets, this.occupancy, this.plot);

    if (!result.valid) {
      for (const node of lifted) this.occupancy.stamp(node);
      return { entries: null, issues: result.issues };
    }

    const entries: MoveEntry[] = moving.map(([node, to]) => ({
      id: node.id,
      fromX: node.x,
      fromY: node.y,
      toX: to.x,
      toY: to.y,
    }));

    for (const [node, to] of moving) {
      node.x = to.x;
      node.y = to.y;
    }
    // Every lifted node, not just the moved ones: the ones that stayed put had
    // their cells taken out of the grid by `beginMove` and need them back.
    for (const node of lifted) this.occupancy.stamp(node);
    return { entries, issues: [] };
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

  /* ── Taking the server's word for it ────────────────────────────────── */

  /**
   * Brings the plan up to date with a yard the server has changed under it.
   *
   * A batch wall upgrade or a trap re-arm rewrites `buildingdata` while the
   * planner is open. Rebuilding the plan from the new yard would be simpler and
   * would throw away every drag the player has made, so instead the plan keeps
   * its positions, its origins and its undo stack, and only the facts the
   * server owns are taken from the yard:
   *
   * - **levels and fortification** are copied onto the nodes that already exist;
   * - **buildings the yard has gained** — the re-armed traps, with fresh ids —
   *   are added where the yard puts them, which becomes their origin, so they
   *   do not immediately read as moved;
   * - **buildings the yard has lost** are removed and their cells freed.
   *
   * Positions are *not* copied back: the plan is the edit in progress and the
   * yard is where the buildings stood at the last save. Overwriting one with the
   * other is exactly what Apply is for.
   *
   * Mushrooms are left alone. They are obstacles rather than buildings, the yard
   * reseeds them on its own, and nothing a batch action does can move one.
   */
  absorb(yard: Yard): AbsorbResult {
    // A selection in hand has its cells out of the grid; putting it down first
    // means the adds and removes below see a grid that matches the nodes.
    this.cancelMove();

    const seen = new Set<number>();
    const added: number[] = [];
    const removed: number[] = [];
    const changed: number[] = [];
    const plansDropped: number[] = [];

    for (const building of yard.buildings) {
      seen.add(building.id);
      const node = this.nodes.get(building.id);

      if (!node) {
        const [width, height] = building.footprint;
        this.add({
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
          plan: null,
          busy: holdsWorker(building),
          damaged: building.hp !== null,
        });
        added.push(building.id);
        continue;
      }

      if (node.level !== building.level || node.fort !== building.fortification) {
        node.level = building.level;
        node.fort = building.fortification;
        changed.push(node.id);
      }
      // Whether a building is on a job or wants repairing is the server's
      // answer too, and both decide whether its plan can still start.
      node.busy = holdsWorker(building);
      node.damaged = building.hp !== null;

      // A plan the yard has reached is finished, not pending: a batch wall
      // upgrade that raised four hundred blocks to level 5 has done exactly
      // what four hundred plans asked for, and leaving them set would have the
      // bar charge for them again and Apply skip them as `caughtUp`.
      if (node.plan && building.level >= node.plan.level) {
        node.plan = null;
        plansDropped.push(node.id);
      }
    }

    for (const node of [...this.nodes.values()]) {
      if (node.fixed || seen.has(node.id)) continue;
      this.occupancy.erase(node);
      this.nodes.delete(node.id);
      this.origin.delete(node.id);
      removed.push(node.id);
    }

    return { added, removed, changed, plansDropped };
  }

  /**
   * Whether a building of `type` could stand at `(x, y)`, and what stops it.
   *
   * Read-only: nothing is stamped, nothing is added, and the caller is expected
   * to be a panel rather than a drag — the re-arm confirmation asks this of
   * every fired trap's old spot so the player is told which ones are now under
   * a wall *before* the server refuses the whole batch (plan §3.4).
   *
   * It is the same pair of tests `planLoad` runs (`layout.ts:125-134`), against
   * the plan's live grid rather than a scratch one, so it answers for the yard
   * as the player has arranged it and not as the save has it. A selection in
   * hand has its cells lifted out of that grid; `Plan.cancelMove` puts them
   * back, and every caller of this is a click on a panel, which cannot happen
   * mid-drag.
   */
  canPlace(type: number, x: number, y: number): PlaceCheck {
    const [width, height] = footprintOf(type);
    const probe: PlanNode = {
      // Negative, so it can never collide with a real id if it were stamped.
      id: -1,
      type,
      x,
      y,
      width,
      height,
      level: 1,
      fort: 0,
      decoration: isDecoration(type),
      fixed: false,
      plan: null,
      busy: false,
      damaged: false,
    };

    if (!inBounds(probe, x, y, this.plot)) {
      return { reason: PlaceBlock.BOUNDS, blockedBy: null };
    }
    const other = this.occupancy.blockedBy(probe, x, y);
    if (other) return { reason: PlaceBlock.OCCUPIED, blockedBy: other };
    return FREE;
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
