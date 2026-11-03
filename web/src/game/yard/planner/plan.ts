import { kindOf, maxLevel, type YardKind } from "../buildingCosts";
import { isStorageId } from "../decorStorage";
import { holdsWorker } from "../workers";
import { nearbyArea } from "../nearbyFootprints";
import { footprintOf, wildYardSize } from "../YardGrid";
import { TROJAN_HORSE_TYPE } from "@/game/trojan/trojanHorse";
import type { Yard } from "../yardModel";
import type { MoveEntry, StoreEntry } from "./commands";
import {
  inBounds,
  isDecoration,
  Occupancy,
  plotBounds,
  validateOffset,
  validatePlan,
  validateTargets,
  type PlacementIssue,
  type PlacementResult,
  type PlanNode,
  type PlotBounds,
  type Position,
  type YardArea,
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

/** Why a bare spot will not take a building. */
export const PlaceBlock = {
  /** Outside the plot for the expansion the account has now. */
  BOUNDS: "bounds",
  /** Held by a building. */
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
}

/**
 * Types that have no upgrade ladder, though the cost table gives some a row.
 *
 * The same three kinds the server refuses an upgrade on
 * (`server/src/services/yardplanner/validateLayout.ts`, `UNPLANNABLE_KINDS`).
 */
const UNPLANNABLE_KINDS: ReadonlySet<string> = new Set([
  "decoration",
  "mushroom",
  "placeholder",
]);

/** Whether a type has an upgrade ladder at all, on a yard of `kind` (`ladderFor`). */
export const plannableType = (type: number, kind: YardKind = "main"): boolean =>
  maxLevel(type, kind) > 0 && !UNPLANNABLE_KINDS.has(kindOf(type, kind));

export class Plan {
  readonly plot: PlotBounds;
  readonly expansion: number;
  /** The yard's kind: the Inferno's ladders and footprints differ. */
  readonly kind: YardKind;

  private readonly nodes = new Map<number, PlanNode>();
  /** Where each building sat when the planner opened, for the moved outline. */
  private readonly origin = new Map<number, readonly [number, number]>();
  private readonly occupancy = new Occupancy();

  /** The selection currently picked up, or null when nothing is being dragged. */
  private lifted: PlanNode[] | null = null;

  private constructor(expansion: number, kind: YardKind, wild = false) {
    this.expansion = expansion;
    this.kind = kind;
    // A wild monster camp (the tribe yard editor's) stands on the plot a camp grows to.
    const [width, height] = wild ? wildYardSize(expansion) : [0, 0];
    this.plot = wild ? { halfWidth: width / 2, halfHeight: height / 2 } : plotBounds(expansion);
  }

  /**
   * Snapshots a yard: every building becomes a movable node.
   *
   * Mushrooms are not in the plan (#263, owner decision 2026-10-04): they
   * never block a move, and Apply pops any mushroom a building lands on up
   * somewhere free (`server/src/services/yard/mushrooms.ts`).
   */
  static fromYard(yard: Yard): Plan {
    const plan = new Plan(yard.expansionLevel, yard.kind, yard.wild === true);
    for (const building of yard.buildings) plan.add(nodeOf(building));
    return plan;
  }

  /**
   * Every node standing on the plot, obstacles included.
   *
   * Stored buildings are left out: they hold no cells, so anything that walks
   * this to learn what is in the way — the load path's scratch grid above all
   * — would otherwise block cells nothing is standing on. {@link index} is the
   * one that still has them, because a name lookup wants every node.
   */
  all(): IterableIterator<PlanNode> {
    return placed(this.nodes.values());
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

  /**
   * Buildings standing on the plot: what a layout saves and what Apply moves.
   *
   * Stored buildings are not here. They are not in the yard as the plan has
   * it, so drawing them, framing them, searching them or writing them into a
   * layout would all be answering about a building that is nowhere.
   */
  buildings(): PlanNode[] {
    return [...this.nodes.values()].filter((node) => !node.fixed && !node.stored);
  }

  /* ── Storage ────────────────────────────────────────────────────────── */

  /** Buildings in the drawer, oldest id first. */
  storedNodes(): PlanNode[] {
    return [...this.nodes.values()]
      .filter((node) => node.stored)
      .sort((a, b) => a.id - b.id);
  }

  /** Their ids, which is what the bar counts. */
  storedIds(): number[] {
    return this.storedNodes().map((node) => node.id);
  }

  /**
   * The stored buildings Apply is blocked on: everything but decorations,
   * which Apply puts into storage instead (#128, `BasePlanner.as:113-122`).
   */
  unplacedIds(): number[] {
    return this.storedNodes()
      .filter((node) => !node.decoration)
      .map((node) => node.id);
  }

  /** Decorations lifted off the yard into the drawer: Apply puts them into storage (#128). */
  toStorageIds(): number[] {
    return this.storedNodes()
      .filter((node) => node.decoration && !node.fromStorage)
      .map((node) => node.id);
  }

  /** Decorations out of storage that stand on the plot: Apply takes them out (#128). */
  fromStorageNodes(): PlanNode[] {
    return this.buildings().filter((node) => node.fromStorage);
  }

  get storedCount(): number {
    let count = 0;
    for (const node of this.nodes.values()) if (node.stored) count++;
    return count;
  }

  /**
   * Lifts buildings off the plot and into the drawer.
   *
   * Anything fixed is skipped rather than refused: the store button acts on
   * a selection the player made with a marquee, and a marquee cannot help
   * catching an obstacle. A building already stored is
   * skipped too, so storing twice is not two undo entries.
   *
   * The returned entries carry the cells the building came off, which is what
   * lets undo put it back exactly there.
   */
  store(ids: Iterable<number>): StoreEntry[] {
    const entries: StoreEntry[] = [];
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (!node || node.fixed || node.stored) continue;
      entries.push({ id, x: node.x, y: node.y, store: true });
    }
    if (entries.length > 0) this.setStored(entries, false);
    return entries;
  }

  /**
   * Puts a stored building back on the plot at `(x, y)`, or refuses.
   *
   * Refusal is the same pair of tests a drop runs — inside its bounds, on
   * free cells — so a building placed from the drawer can never land
   * somewhere a dragged one could not.
   */
  place(id: number, x: number, y: number): StoreEntry | null {
    const node = this.nodes.get(id);
    if (!node || !node.stored) return null;
    if (!inBounds(node, x, y, this.plot)) return null;
    if (this.occupancy.blockedBy(node, x, y) !== null) return null;

    const entry: StoreEntry = { id, x, y, store: false };
    this.setStored([entry], false);
    return entry;
  }

  /**
   * Applies or reverses recorded storage changes. The undo stack's only writer
   * for the drawer, the counterpart of {@link move}.
   *
   * Every node is taken off the grid before any is put back on, for the same
   * reason `move` does it: a batch that stores one building and places another
   * on its cells would otherwise have the erase clear what the stamp had just
   * written.
   */
  setStored(entries: readonly StoreEntry[], reverse: boolean): void {
    const landing: PlanNode[] = [];

    for (const entry of entries) {
      const node = this.nodes.get(entry.id);
      // As `move`: the stack can outlive a rebase that dropped the building.
      if (!node || node.fixed) continue;
      if (!node.stored) this.occupancy.erase(node);

      if (reverse ? !entry.store : entry.store) {
        node.stored = true;
        continue;
      }
      node.stored = false;
      node.x = entry.x;
      node.y = entry.y;
      landing.push(node);
    }

    for (const node of landing) this.occupancy.stamp(node);
  }

  /** Whether a building is somewhere other than where the yard had it. */
  hasMoved(id: number): boolean {
    const node = this.nodes.get(id);
    const start = this.origin.get(id);
    // A stored building is not "moved": it is nowhere, which the drawer's own
    // count says, and outlining it as moved would outline nothing.
    if (!node || !start || node.stored) return false;
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
    return validatePlan(this.all(), this.plot, this.occupancy);
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
      // A stored building holds no cells and is drawn nowhere, so there is
      // nothing to pick up: it goes back on the plot through `place`.
      if (!node || node.fixed || node.stored) continue;
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
   * The buildings near the lifted selection shifted by `(dx, dy)`, for their
   * outlines (#231). Empty when nothing is lifted.
   *
   * The selection itself is never among them: `beginMove` took its cells out
   * of the grid this reads.
   */
  nearbyLifted(dx: number, dy: number): Set<number> {
    const lifted = this.lifted;
    if (!lifted || lifted.length === 0) return new Set();
    return this.nearby(
      lifted.map((node) => nearbyArea(node.x + dx, node.y + dy, node.width, node.height)),
    );
  }

  /**
   * The buildings near a footprint of `width` x `height` at `(x, y)` (#231):
   * every building, wall, trap and decoration with a cell in the areas round
   * it. Mushrooms are not in the plan (#263).
   */
  nearbySpot(x: number, y: number, width: number, height: number): Set<number> {
    return this.nearby([nearbyArea(x, y, width, height)]);
  }

  private nearby(areas: readonly YardArea[]): Set<number> {
    const ids = this.occupancy.occupantsIn(areas);
    for (const id of ids) if (this.nodes.get(id)?.fixed !== false) ids.delete(id);
    return ids;
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
   * Mushrooms are not in the plan (#263): they never block, and the yard
   * moves one a building lands on by itself.
   */
  absorb(yard: Yard): AbsorbResult {
    // A selection in hand has its cells out of the grid; putting it down first
    // means the adds and removes below see a grid that matches the nodes.
    this.cancelMove();

    const seen = new Set<number>();
    const added: number[] = [];
    const removed: number[] = [];
    const changed: number[] = [];

    for (const building of yard.buildings) {
      seen.add(building.id);
      const node = this.nodes.get(building.id);

      if (!node) {
        this.add(nodeOf(building));
        added.push(building.id);
        continue;
      }
      // A decoration still in storage is the player's to place: the rebase
      // leaves it where the plan has it.
      if (node.fromStorage) continue;

      if (node.level !== building.level || node.fort !== building.fortification) {
        node.level = building.level;
        node.fort = building.fortification;
        changed.push(node.id);
      }
      // Whether a building is on a job or wants repairing is the server's
      // answer too.
      node.busy = holdsWorker(building);
      node.damaged = building.hp !== null;
      // The save's spot is the one a decoration may keep outside the plot.
      if (node.decoration) node.home = { x: building.x, y: building.y };
    }

    for (const node of [...this.nodes.values()]) {
      if (node.fixed || seen.has(node.id)) continue;
      // A stored building holds no cells; erasing its old footprint would
      // punch a hole in whatever has since been put there.
      if (!node.stored) this.occupancy.erase(node);
      this.nodes.delete(node.id);
      this.origin.delete(node.id);
      removed.push(node.id);
    }

    return { added, removed, changed };
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
    const [width, height] = footprintOf(type, this.kind);
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
      stored: false,
      busy: false,
      damaged: false,
    };

    if (!inBounds(probe, x, y, this.plot)) {
      return { reason: PlaceBlock.BOUNDS, blockedBy: null };
    }
    const other = this.occupancy.blockedBy(probe, x, y);
    if (other !== null) return { reason: PlaceBlock.OCCUPIED, blockedBy: other };
    return FREE;
  }

  /** Puts a building at an absolute position. */
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
    // A stored node holds no cells.
    if (!node.stored) this.occupancy.stamp(node);
  }
}

/**
 * A yard building as a plan node. A decoration carries its saved spot as
 * `home`, where it may stay even outside the plot; one still in storage
 * (#128) starts in the drawer, with no home, since it has never stood
 * anywhere.
 */
const nodeOf = (building: Yard["buildings"][number]): PlanNode => {
  const [width, height] = building.footprint;
  const decoration = isDecoration(building.type);
  const fromStorage = isStorageId(building.id);
  return {
    id: building.id,
    type: building.type,
    x: building.x,
    y: building.y,
    width,
    height,
    level: building.level,
    fort: building.fortification,
    decoration,
    ...(decoration && !fromStorage ? { home: { x: building.x, y: building.y } } : {}),
    ...(fromStorage ? { fromStorage: true as const } : {}),
    // The Trojan Horse is not selectable or movable here (issue #327, design
    // §3): an obstacle for everything else to plan around, never a node a
    // move, a clear or Apply's layout may touch.
    fixed: building.type === TROJAN_HORSE_TYPE,
    stored: fromStorage,
    busy: holdsWorker(building),
    damaged: building.hp !== null,
  };
};

/** The nodes of `source` that are standing on the plot. */
function* placed(source: Iterable<PlanNode>): IterableIterator<PlanNode> {
  for (const node of source) if (!node.stored) yield node;
}
