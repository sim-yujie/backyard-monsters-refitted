import type { Layout, LayoutPayload } from "@/api/types";
import type { Camera } from "@/game/Camera";
import type { Point, Rect } from "../YardGrid";
import type { Yard } from "../yardModel";
import type { YardRenderer, YardView } from "../YardRenderer";
import { buildingName } from "../buildingArt";
import { buildChecklist, type Checklist } from "./checklist";
import {
  CommandStack,
  compositeCommand,
  moveCommand,
  planCommand,
  storeCommand,
  type MoveEntry,
  type PlanEntry,
  type StoreEntry,
} from "./commands";
import { groupTargets, GroupOp, GROUP_OPS } from "./groupTools";
import { planLoad, payloadFor, type LoadResult } from "./layout";
import { rectFromCorners } from "./marquee";
import { snap, type PlanNode } from "./placement";
import { Grab, PlannerInput } from "./PlannerInput";
import { PlannerView } from "./PlannerView";
import { Plan, type AbsorbResult } from "./plan";
import { plannerAction } from "./shortcuts";
import { previewApply, type ApplyPreview } from "./upgrades";

/**
 * Planner mode: the state a yard is in while it is being rearranged.
 *
 * Holds the plan, the selection, the tool, the undo stack and the live drag or
 * carry. `PlannerView` is the only thing here that touches the renderer, `Plan`
 * is the only thing that touches geometry, and `shortcuts.ts` is the only thing
 * that reads a key. What is left is the decisions: what a press means, when a
 * click becomes a carry, when an edit becomes a command, and when the plan is
 * dirty.
 *
 * A carried selection is a drag that outlives the button: the plan keeps it
 * lifted, every pointer move retests the drop, and a refused drop keeps it in
 * hand rather than snapping it back — the original's `stopDragBuilding`
 * behaviour, which is what makes walls quick to lay.
 *
 * The scene wires it up and the DOM panels read `state()`; neither knows how a
 * drag works and this knows nothing about either.
 */

export const PlannerTool = {
  SELECT: "select",
  BOX: "box",
} as const;
export type PlannerTool = (typeof PlannerTool)[keyof typeof PlannerTool];

/** What a preview has to put back when it is dismissed. */
interface PreviewState {
  readonly x: number;
  readonly y: number;
  readonly plan: PlanNode["plan"];
}

/** Why a group operation did nothing, or null when it did something. */
export const GroupRefusal = {
  /** The session may not be edited at all (§8, Q5). */
  READ_ONLY: "read-only",
  /** Fewer buildings selected than the operation needs.  */
  TOO_FEW: "too-few",
  /** The selection is already like that: a mirror of a symmetric row. */
  NO_CHANGE: "no-change",
  /** Somebody would have left the plot or landed on something. */
  BLOCKED: "blocked",
} as const;
export type GroupRefusal = (typeof GroupRefusal)[keyof typeof GroupRefusal];

/** What a mirror, align or distribute did, for the notice that reports it. */
export interface GroupOutcome {
  readonly op: GroupOp;
  readonly ok: boolean;
  /** How many buildings moved. Zero unless `ok`. */
  readonly moved: number;
  /** How many the refusal named, which are the ones outlined in red. */
  readonly blocked: number;
  readonly reason: GroupRefusal | null;
}

export interface PlannerState {
  readonly tool: PlannerTool;
  readonly selectionCount: number;
  readonly movedCount: number;
  /** How many buildings have a planned upgrade (`planner-upgrades.md` §2.3). */
  readonly plannedCount: number;
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  readonly slot: number | null;
  readonly slotName: string;
  /** True while a drag is over an illegal spot. */
  readonly dragInvalid: boolean;
  /** True while the selection follows the pointer, waiting for a click to drop. */
  readonly carrying: boolean;
  /** How many buildings are in the drawer rather than on the plot. */
  readonly storedCount: number;
  /**
   * True while a building out of the drawer follows the pointer.
   *
   * A kind of carry, and `carrying` is true with it, but the bar words it
   * differently: nothing is being moved, something is being put down for the
   * first time, and Escape returns it to the drawer rather than to the yard.
   */
  readonly placing: boolean;
  /** Which drawing of the yard is showing. */
  readonly view: YardView;
  /**
   * True whenever the plan is being looked at rather than edited: a layout
   * preview is up, or the whole session is read-only.
   *
   * One flag for both because everything that reads it — Apply's disabled
   * state, the slot label, the summary's last word — wants the same answer for
   * both causes. `readOnly` below says which cause it is, for the bar that has
   * to word it differently.
   */
  readonly previewing: boolean;
  /**
   * True when this session can never be edited (design §8, Q5: the yard is not
   * the player's own, or it is not loaded in build mode).
   *
   * Unlike a preview this cannot be dismissed, so the bar drops the edit
   * controls rather than disabling them one by one.
   */
  readonly readOnly: boolean;
}

/**
 * The undo tooltip for a plan edit: "Plan Cannon Tower to L5", "Clear plan",
 * "Plan 6 buildings to L5".
 *
 * Reads the target off the entries rather than taking it as an argument, so a
 * mixed batch — some set, some cleared, which `setPlanLevel` cannot produce
 * but a future caller might — still gets an honest label.
 */
const planLabel = (entries: readonly PlanEntry[], plan: Plan): string => {
  const target = entries[0]?.after;
  const many = entries.length > 1;
  const subject = many
    ? `${entries.length} buildings`
    : (buildingName(plan.get(entries[0]?.id ?? -1)?.type ?? -1) ?? "building");

  if (!target) return many ? `Clear ${entries.length} plans` : `Clear plan on ${subject}`;
  return `Plan ${subject} to L${target.level}`;
};

/**
 * The undo tooltip for a storage change: "Store · 12 buildings", "Place
 * Sniper Tower".
 *
 * One building is named, several are counted. A player undoing a store of
 * twelve wants to know it was twelve; a player undoing one wants to know which.
 */
const storeLabel = (verb: string, count: number, plan: Plan, id?: number): string => {
  if (count === 1) {
    const type = id === undefined ? -1 : (plan.get(id)?.type ?? -1);
    const name = buildingName(type);
    return name ? `${verb} ${name}` : `${verb} building`;
  }
  return `${verb} · ${count} buildings`;
};

export class PlannerSession {
  readonly plan: Plan;

  private readonly view: PlannerView;
  private readonly input: PlannerInput;
  private readonly stack: CommandStack;
  private readonly onChange: () => void;
  private readonly onViewToggle: () => void;
  private readonly onFind: (() => void) | undefined;
  private readonly onRanges: (() => void) | undefined;
  private readonly onGroup: ((outcome: GroupOutcome) => void) | undefined;
  /**
   * Set for the life of the session: this plan may be read, never changed.
   *
   * Enforced here rather than by the bar hiding buttons, because the keyboard
   * and the pointer reach the plan without going near the bar.
   */
  private readonly readOnly: boolean;

  private tool: PlannerTool = PlannerTool.SELECT;
  private selection = new Set<number>();
  private moved = new Set<number>();
  private faulted = new Set<number>();
  private marquee: Rect | null = null;
  private pressWorld: Point | null = null;
  private dragDelta = { dx: 0, dy: 0 };
  private dragInvalid = false;
  private slot: number | null = null;
  private slotName = "";
  /** Positions and plans to restore when a preview is dismissed. */
  private preview: Map<number, PreviewState> | null = null;
  /**
   * The building being carried out of the drawer, and the cells it is hovering
   * over, or null.
   *
   * It stays *stored* in the plan for the whole gesture: only the drop commits
   * it. That is what keeps every other path — validate, absorb, a checklist
   * opened mid-carry — looking at a plan where the building is simply in the
   * drawer, rather than at one where it is half on the plot.
   */
  private placing: { id: number; x: number; y: number; ok: boolean } | null = null;
  /**
   * The yard as the server last described it.
   *
   * Held because every answer about a planned upgrade — what a ladder costs,
   * what the plan adds up to, what Apply would start — is a question about the
   * plan *and* the yard, and the panels that ask have only the session.
   * Replaced wholesale by `rebase`.
   */
  private yard: Yard;

  constructor(options: {
    yard: Yard;
    renderer: YardRenderer;
    camera: Camera;
    canvas: HTMLCanvasElement;
    onChange: () => void;
    /** Tab was pressed: the scene owns the camera, so it does the switch. */
    onViewToggle: () => void;
    /**
     * F was pressed: the scene owns the panels, so it opens the search box.
     *
     * Optional so a harness — or a scene that has no search panel yet — can
     * leave it out; the key is still swallowed, because the alternative is the
     * browser's own find bar opening over the yard.
     */
    onFind?: () => void;
    /**
     * R was pressed: show or hide the tower range discs.
     *
     * The scene owns the overlays and remembers whether they are on, so the
     * session only forwards the key — the same arrangement Tab and F have.
     */
    onRanges?: () => void;
    /**
     * A mirror, align or distribute finished — or was refused.
     *
     * Reported through the session rather than returned to the caller because
     * `M` on the keyboard and the toolbar's menu are the same operation, and
     * only one of the two has anywhere to put the answer. The scene turns it
     * into a notice; the session has already put the red outlines on.
     */
    onGroup?: (outcome: GroupOutcome) => void;
    /**
     * Opens the plan for reading only (design §8, Q5).
     *
     * Selection, search, the two views and the cost cells all still work —
     * they answer questions about the yard and change nothing. What is refused
     * is every path that could move a building: a drag, a carry, a nudge, undo
     * and redo, and a layout load, which is downgraded to a preview.
     */
    readOnly?: boolean;
  }) {
    this.onChange = options.onChange;
    this.onViewToggle = options.onViewToggle;
    this.onFind = options.onFind;
    this.onRanges = options.onRanges;
    this.onGroup = options.onGroup;
    this.readOnly = options.readOnly ?? false;
    this.yard = options.yard;
    this.plan = Plan.fromYard(options.yard);
    this.view = new PlannerView({ renderer: options.renderer, plan: this.plan });

    this.stack = new CommandStack({ onChange: () => this.onChange() });
    this.input = new PlannerInput({
      camera: options.camera,
      canvas: options.canvas,
      handlers: {
        claim: (world, shift) => this.claim(world, shift),
        wouldClaim: (world, shift) => this.wouldClaim(world, shift),
        tap: (world, shift) => this.tap(world, shift),
        move: (world, grab) => this.onMove(world, grab),
        release: (world, grab, travelled) => this.onRelease(world, grab, travelled),
        clickEmpty: (shift) => {
          if (!shift) this.clearSelection();
        },
        cancel: () => this.cancel(),
        grabChanged: () => this.refresh(),
        key: (event) => this.onKey(event),
      },
    });
  }

  attach(): void {
    this.input.attach();
    this.view.resort();
    this.refresh();
  }

  /** Leaves planner mode, putting every sprite back where the save had it. */
  detach(): void {
    this.input.detach();
    this.plan.cancelMove();
    this.view.reset();
  }

  state(): PlannerState {
    return {
      tool: this.tool,
      selectionCount: this.selection.size,
      movedCount: this.moved.size,
      plannedCount: this.plan.plannedCount,
      dirty: !this.stack.isClean,
      canUndo: this.stack.canUndo,
      canRedo: this.stack.canRedo,
      undoLabel: this.stack.undoLabel,
      redoLabel: this.stack.redoLabel,
      slot: this.slot,
      slotName: this.slotName,
      dragInvalid: this.dragInvalid,
      carrying: this.input.isCarrying,
      storedCount: this.plan.storedCount,
      placing: this.placing !== null,
      previewing: this.preview !== null || this.readOnly,
      readOnly: this.readOnly,
      view: this.view.view,
    };
  }

  /* ── Tools and selection ────────────────────────────────────────────── */

  setTool(tool: PlannerTool): void {
    if (this.tool === tool) return;
    // Choosing a tool is one of the ways out of a run of placements (#57):
    // the building in hand goes back to the drawer before the tool changes.
    if (this.placing) this.abandonPlacement();
    this.tool = tool;
    this.refresh();
  }

  selectOnly(ids: Iterable<number>): void {
    this.selection = new Set([...ids].filter((id) => this.plan.get(id)?.fixed === false));
    this.refresh();
  }

  clearSelection(): void {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.faulted.clear();
    this.refresh();
  }

  /** The current selection, for the inspector and the tests. */
  selectedIds(): number[] {
    return [...this.selection];
  }

  /**
   * The selected buildings themselves, for the cost summary and the batch
   * panels.
   *
   * An id with no node is dropped rather than reported: `rebase` can remove a
   * building the server no longer has while it is still selected, and a caller
   * adding up costs wants the buildings, not the gaps.
   */
  selectedNodes(): PlanNode[] {
    const nodes: PlanNode[] = [];
    for (const id of this.selection) {
      const node = this.plan.get(id);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  /**
   * The one selected building, or null when the selection is empty or plural.
   *
   * What the inspector opens on (`planner-upgrades.md` §5.2): one building
   * gets the ladder, a multi-selection gets the cost table instead.
   */
  selectedNode(): PlanNode | null {
    if (this.selection.size !== 1) return null;
    const [id] = this.selection;
    return (id === undefined ? undefined : this.plan.get(id)) ?? null;
  }

  /* ── Planned upgrades ───────────────────────────────────────────────── */

  /**
   * Plans an upgrade on every named building, or clears it with `null`.
   *
   * One command however many buildings it touches, so planning a marquee of
   * ten towers is one Ctrl+Z. Buildings the plan refuses — busy, damaged,
   * already there, past the top of the ladder — are simply not in the command;
   * the return value is how many actually changed, which is what a caller
   * needs to decide whether to say anything.
   *
   * Refused outright in a read-only session: the ladder is readable there and
   * nothing else (design §8, Q5).
   */
  setPlanLevel(ids: Iterable<number>, level: number | null): number {
    if (this.readOnly) return 0;

    const entries: PlanEntry[] = [];
    for (const id of ids) {
      const entry = this.plan.setPlan(id, level);
      if (entry) entries.push(entry);
    }
    if (entries.length === 0) return 0;

    this.stack.pushApplied(
      planCommand(entries, (batch, reverse) => this.plan.setPlans(batch, reverse), planLabel(entries, this.plan)),
    );
    this.refresh();
    return entries.length;
  }

  /** Every building with a plan, in the order Apply will walk them. */
  plannedNodes(): PlanNode[] {
    return this.plan.plannedNodes();
  }

  /** Planned target level by id, for the canvas badge and the blueprint tiles. */
  plannedLevels(): ReadonlyMap<number, number> {
    return this.plan.plannedLevels();
  }

  /** The yard the plan is measured against. */
  yardModel(): Yard {
    return this.yard;
  }

  /**
   * What Apply would do with the plan as it stands, in the server's own
   * report shapes.
   *
   * Recomputed on demand rather than cached: it is a walk over the planned
   * buildings, which is a handful even in a 575-building yard, and a cache
   * would have to be invalidated by every plan edit, every rebase and every
   * undo.
   */
  applyPreview(): ApplyPreview {
    return previewApply(this.plan.plannedNodes(), this.yard);
  }

  /* ── Storage ────────────────────────────────────────────────────────── */

  /** Buildings in the drawer, for the inventory panel. */
  storedNodes(): PlanNode[] {
    return this.plan.storedNodes();
  }

  /**
   * Lifts the selection off the yard and into the drawer (issue #50).
   *
   * One command however many buildings it takes, so storing a marquee of
   * twelve towers is one Ctrl+Z. Mushrooms and anything else fixed are left
   * where they are rather than refusing the whole action: a marquee cannot
   * help catching one, and refusing would make the tool useless in exactly the
   * yards it is for.
   *
   * Returns how many were stored, which is what the caller needs to decide
   * whether to say anything.
   */
  store(ids: Iterable<number> = this.selection): number {
    if (this.readOnly) return 0;
    // Copied before anything else: the default is the live selection, and the
    // gesture this is about to drop can empty it.
    const targets = [...ids];
    if (this.input.isGrabbing) this.cancel();

    const entries = this.plan.store(targets);
    if (entries.length === 0) return 0;
    this.recordStore(
      entries,
      storeLabel("Store", entries.length, this.plan, entries[0]?.id),
    );
    return entries.length;
  }

  /**
   * Clears the yard: everything not fixed goes into the drawer.
   *
   * One command, like any other store, so a 575-building clear is one Ctrl+Z
   * rather than 575. The confirmation belongs to the caller: this is the edit,
   * not the question.
   */
  clearYard(): number {
    if (this.readOnly) return 0;
    return this.store(this.plan.buildings().map((node) => node.id));
  }

  /**
   * The stack the building in hand came off, or null when nothing is being
   * placed.
   *
   * The drawer marks that row as armed and turns a second click on it into a
   * stop (#57). Type and level, not an id: the id in hand changes with every
   * drop while the row stays the same.
   */
  armedStack(): { type: number; level: number } | null {
    const node = this.placing ? this.plan.get(this.placing.id) : undefined;
    return node ? { type: node.type, level: node.level } : null;
  }

  /**
   * Takes a building out of the drawer and puts it in the player's hand.
   *
   * The same carry a click on a placed building starts, with one difference:
   * the building is nowhere, so it follows the pointer by its own centre
   * rather than by the offset a press gave it. Nothing is committed until the
   * drop, and a refused drop keeps it in hand exactly as a refused move does.
   *
   * The row stays armed after the drop (#57): while the drawer holds another
   * building of the same type and level, the next one is in hand at once, so
   * a run of walls is one click per wall rather than two. See
   * {@link dropPlacement} for how the run ends.
   *
   * Returns false when there is nothing to place: a read-only session, or an
   * id the drawer does not hold.
   */
  startPlacing(id: number): boolean {
    if (this.readOnly) return false;
    const node = this.plan.get(id);
    if (!node || !node.stored) return false;

    if (this.input.isGrabbing) this.cancel();
    this.selection = new Set([id]);
    this.moveGhost(node, node.x, node.y);
    this.input.beginCarry();
    this.refresh();
    return true;
  }

  /** Where the pointer would put the building in hand, and whether it fits. */
  private moveGhost(node: PlanNode, x: number, y: number): void {
    const check = this.plan.canPlace(node.type, x, y);
    this.placing = { id: node.id, x, y, ok: check.reason === null };
    this.dragInvalid = check.reason !== null;
    this.faulted =
      check.blockedBy === null || check.blockedBy === 0
        ? new Set<number>()
        : new Set<number>([check.blockedBy]);
    this.view.ghost(node.id, x, y);
  }

  /** Follows the pointer with a building out of the drawer. */
  private dragPlacement(world: Point): void {
    const placing = this.placing;
    const node = placing ? this.plan.get(placing.id) : undefined;
    if (!placing || !node) {
      this.placing = null;
      return;
    }

    const yard = this.view.worldToYard(world.x, world.y);
    // By its centre, not its origin: a building picked out of a list was never
    // grabbed anywhere, so the only spot the pointer can mean is the middle.
    const x = snap(yard.x - node.width / 2);
    const y = snap(yard.y - node.height / 2);
    if (x === placing.x && y === placing.y) return;

    this.moveGhost(node, x, y);
    this.refresh();
  }

  /**
   * Puts the carried building down, then either takes the next one off the
   * same stack or lets go.
   *
   * Returning `"carry"` is how a refused drop says "still in hand", the same
   * answer `onRelease` gives a refused move — and, since #57, how an accepted
   * drop says "and the next one is in hand now". One undo entry per building
   * either way: a run of ten walls is ten Ctrl+Z, each putting one back, which
   * is what a player who overshot by one wants.
   *
   * The run ends when the stack is empty (the drop lands and nothing follows),
   * or from outside: Escape, the secondary button or the Put back chip
   * (`abandonPlacement`), another tool (`setTool`), or the drawer row clicked
   * again (the scene calls `putBack`).
   */
  private dropPlacement(world: Point): "carry" | void {
    // Touch sends no move before a press, so the ghost may still be wherever
    // the last move left it: walk it under this press before dropping.
    this.dragPlacement(world);

    const placing = this.placing;
    if (!placing) return;

    const entry = placing.ok ? this.plan.place(placing.id, placing.x, placing.y) : null;
    if (!entry) return "carry";

    const next = this.nextInStack(placing.id);
    this.placing = null;
    this.dragInvalid = false;
    this.faulted.clear();
    this.recordStore([entry], storeLabel("Place", 1, this.plan, entry.id));
    if (!next) return;

    // After `recordStore`, not before: it re-hides everything stored, which
    // would include the ghost. The ghost starts under the pointer, on the
    // cells just filled — so it reads as blocked until the pointer moves,
    // which is the truth, and a second click on the same spot is refused
    // rather than stacking two walls on one square.
    this.selection = new Set([next.id]);
    this.moveGhost(next, placing.x, placing.y);
    this.refresh();
    return "carry";
  }

  /** The lowest-id stored building of the same type and level, or null. */
  private nextInStack(placedId: number): PlanNode | null {
    const placed = this.plan.get(placedId);
    if (!placed) return null;
    // `storedNodes` is ascending by id, the order the drawer's rows hand them
    // out in, so a run comes out in the order it went in.
    return (
      this.plan
        .storedNodes()
        .find(
          (node) =>
            node.id !== placedId && node.type === placed.type && node.level === placed.level,
        ) ?? null
    );
  }

  /** Escape, the secondary button or the Put back chip: back to the drawer. */
  private abandonPlacement(): void {
    const placing = this.placing;
    this.placing = null;
    this.input.cancel();
    this.dragInvalid = false;
    this.faulted.clear();
    if (placing) {
      // Back to where the plan still says it is, then out of sight again.
      this.view.sync(placing.id);
      this.view.syncStored();
      // A building in the drawer is not on the yard, so it cannot stay
      // selected: the bar would say "1 selected" of something drawn nowhere.
      this.selection.delete(placing.id);
    }
    this.refresh();
  }

  /** Pushes an already-applied storage change and redraws what it changed. */
  private recordStore(entries: readonly StoreEntry[], label: string): void {
    this.stack.pushApplied(
      storeCommand(entries, (batch, reverse) => this.plan.setStored(batch, reverse), label),
    );
    for (const entry of entries) {
      if (!entry.store) continue;
      this.selection.delete(entry.id);
      this.faulted.delete(entry.id);
    }
    this.view.syncStored();
    this.view.syncSome(entries.filter((entry) => !entry.store).map((entry) => entry.id));
    this.view.resort();
    this.afterEdit();
  }

  /* ── Editing ────────────────────────────────────────────────────────── */

  /** Arrow keys: one grid step, or ten with Shift. */
  nudge(dx: number, dy: number): void {
    if (this.readOnly) return;
    if (this.selection.size === 0) return;
    if (this.input.isGrabbing) this.cancel();
    this.plan.beginMove(this.selection);
    const entries = this.plan.commitMove(dx, dy);
    if (entries) this.record(entries);
    else this.plan.cancelMove();
    this.view.syncSome(this.selection);
    this.view.resort();
    this.afterEdit();
  }

  /**
   * Mirror, align or distribute the selection (design §3, F7).
   *
   * One command per press, whatever it moves, so a mirror of four hundred walls
   * is one Ctrl+Z and not four hundred. It goes through the same validation a
   * drag does — `beginMove`, test, `commitTargets` — so an operation that would
   * put anything outside the plot or on top of something is refused whole, with
   * the offenders outlined in red, rather than applied to whichever half of the
   * selection happened to fit.
   */
  groupTool(op: GroupOp): GroupOutcome {
    const refuse = (reason: GroupRefusal, blocked = 0): GroupOutcome => {
      const outcome: GroupOutcome = { op, ok: false, moved: 0, blocked, reason };
      this.onGroup?.(outcome);
      return outcome;
    };

    if (this.readOnly) return refuse(GroupRefusal.READ_ONLY);
    if (this.input.isGrabbing) this.cancel();

    const nodes = this.selectedNodes().filter((node) => !node.fixed);
    if (nodes.length < GROUP_OPS[op].minimum) return refuse(GroupRefusal.TOO_FEW);

    const targets = groupTargets(op, nodes);
    if (targets.size === 0) return refuse(GroupRefusal.NO_CHANGE);

    this.plan.beginMove(nodes.map((node) => node.id));
    const { entries, issues } = this.plan.commitTargets(targets);

    if (!entries) {
      this.faulted = new Set<number>();
      for (const issue of issues) {
        this.faulted.add(issue.id);
        if (issue.otherId !== undefined) this.faulted.add(issue.otherId);
      }
      this.refresh();
      return refuse(GroupRefusal.BLOCKED, this.faulted.size);
    }

    this.record(
      entries,
      `${GROUP_OPS[op].label} · ${entries.length} ${entries.length === 1 ? "building" : "buildings"}`,
    );
    this.faulted.clear();
    this.view.syncSome(this.selection);
    this.view.resort();
    this.afterEdit();

    const outcome: GroupOutcome = { op, ok: true, moved: entries.length, blocked: 0, reason: null };
    this.onGroup?.(outcome);
    return outcome;
  }

  undo(): void {
    if (this.readOnly) return;
    if (this.input.isGrabbing) this.cancel();
    if (this.stack.undo()) this.afterHistory();
  }

  redo(): void {
    if (this.readOnly) return;
    if (this.input.isGrabbing) this.cancel();
    if (this.stack.redo()) this.afterHistory();
  }

  /**
   * Called by the scene after it has switched the renderer's view.
   *
   * A drag or a carry is anchored to a world point in the view it started in,
   * and the two views put the same building in completely different places, so
   * a gesture cannot survive the switch — the next pointer move would read the
   * new position against the old anchor and jump. `cancel` puts it back;
   * guarding on `isGrabbing` keeps its other branch, which clears the
   * selection, out of an ordinary view switch.
   */
  viewChanged(): void {
    if (this.input.isGrabbing) this.cancel();
    this.refresh();
  }

  /* ── Taking the server's word for it ─────────────────────────────────── */

  /**
   * Re-reads a yard a batch action has changed under the plan.
   *
   * A wall upgrade or a trap re-arm is a server-side write that lands while the
   * planner is open, and the planner is not closed for it: the player is in the
   * middle of a layout and expects to carry on. So the plan absorbs the new
   * levels, the new traps and anything that has gone (`Plan.absorb`), the
   * selection drops whatever no longer exists, and every sprite is put back
   * where the plan — not the save — says it belongs.
   *
   * The undo stack is untouched on purpose. The moves it holds are still the
   * player's moves, and a wall that is now level 5 is the same wall at the same
   * place. A stack entry naming a building the re-read removed is skipped by
   * `Plan.move`, which already tolerates exactly this.
   *
   * The caller must have rebuilt the renderer's sprites from the new yard
   * first; this puts them in the right places, it does not create them.
   */
  rebase(yard: Yard): AbsorbResult {
    if (this.input.isGrabbing) this.cancel();

    this.yard = yard;
    // The caller has rebuilt the renderer's sprites, so everything is drawn
    // again: what the drawer holds has to be hidden a second time.
    this.view.forgetStored();
    const result = this.plan.absorb(yard);
    for (const id of result.removed) {
      this.selection.delete(id);
      this.faulted.delete(id);
    }

    this.afterHistory();
    return result;
  }

  /* ── Layouts ────────────────────────────────────────────────────────── */

  /** The `data` field for a save or an apply. */
  payload(): LayoutPayload {
    return payloadFor(this.plan);
  }

  /**
   * Loads a layout into the plan.
   *
   * A preview is the same load with the positions remembered, so leaving it
   * puts the plan back without going through the undo stack and without ever
   * marking the plan dirty (design §8, Q6).
   *
   * A read-only session has no other kind: an editing load would put the plan
   * somewhere Apply could never take the yard, so it is downgraded rather than
   * refused, and the player still gets to look at the layout.
   */
  load(layout: Layout, options: { preview?: boolean } = {}): LoadResult {
    this.dismissPreview();
    const result = planLoad(this.plan, layout);

    if (options.preview || this.readOnly) {
      this.preview = new Map();
      for (const node of this.plan.buildings()) {
        this.preview.set(node.id, { x: node.x, y: node.y, plan: node.plan });
      }
      this.plan.move(result.entries, false);
      this.plan.setPlans(result.plans, false);
    } else {
      // One command for both halves of a load: the positions and the upgrades
      // the layout was saved with are one gesture and have to be one undo.
      const label = `Load “${layout.name}”`;
      const move = moveCommand(
        result.entries,
        (batch, reverse) => this.plan.move(batch, reverse),
        label,
      );
      this.stack.push(
        result.plans.length === 0
          ? move
          : compositeCommand(label, [
              move,
              planCommand(
                result.plans,
                (batch, reverse) => this.plan.setPlans(batch, reverse),
                label,
              ),
            ]),
      );
      this.slot = layout.slot;
      this.slotName = layout.name;
    }

    this.afterHistory();
    return result;
  }

  /** Ends a read-only preview, restoring what was there before it. */
  dismissPreview(): void {
    const preview = this.preview;
    if (!preview) return;
    this.preview = null;
    const plans: PlanEntry[] = [];
    for (const [id, was] of preview) {
      this.plan.setPosition(id, was.x, was.y);
      plans.push({ id, before: was.plan, after: was.plan });
    }
    // `before` and `after` are the same value here: the preview is being
    // rolled back, so both directions of the stack want what was there first.
    this.plan.setPlans(plans, true);
    this.afterHistory();
  }

  /**
   * Records that the plan now matches a saved slot.
   *
   * The stack remembers the position rather than a flag being cleared, so
   * undoing back to here reads clean again and redoing forward reads dirty.
   */
  markSaved(slot: number, name: string): void {
    this.slot = slot;
    this.slotName = name;
    this.stack.markClean();
    this.refresh();
  }

  /**
   * The checks Apply runs before it calls the server: three blocking rows
   * about placement, and — when anything is planned — three warning rows about
   * what the upgrade walk will not manage.
   */
  checklist(): Checklist {
    const planned = this.plan.plannedCount > 0 ? this.applyPreview() : null;
    const checklist = buildChecklist(
      this.plan.index(),
      this.plan.validate(),
      this.plan.storedIds(),
      planned,
    );
    this.faulted = checklist.faulted;
    this.refresh();
    return checklist;
  }

  /** Puts the red outline on ids the server named. */
  faultIds(ids: Iterable<number>): void {
    this.faulted = new Set(ids);
    this.refresh();
  }

  /* ── Pointer ────────────────────────────────────────────────────────── */

  /**
   * What a press at `world` would start, without starting it (F14).
   *
   * `claim` cannot answer this, because answering is how it selects and lifts:
   * touch needs to know whether there is anything under the finger *before*
   * anything moves, since until the long press fires that finger still belongs
   * to the camera. Kept beside `claim` so the two cannot drift.
   */
  private wouldClaim(world: Point, shift: boolean): Grab | null {
    if (this.tool === PlannerTool.BOX) return Grab.MARQUEE;
    const id = this.view.pick(world.x, world.y);
    if (id === null) return shift ? Grab.MARQUEE : null;
    return Grab.DRAG;
  }

  /**
   * A tap, which is touch's click (F14).
   *
   * It selects and stops there. On a mouse a click on an already-selected
   * building picks it up, but touch spells that as the long press, and a tap
   * that could also carry would turn every scroll past a building into a
   * gamble on how still the finger was.
   */
  private tap(world: Point, shift: boolean): void {
    const id = this.view.pick(world.x, world.y);
    if (id === null) {
      if (!shift) this.clearSelection();
      return;
    }

    if (!shift) this.selection = new Set([id]);
    else if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.refresh();
  }

  private claim(world: Point, shift: boolean): Grab | null {
    if (this.tool === PlannerTool.BOX) return this.startMarquee(world);

    const id = this.view.pick(world.x, world.y);
    // A press on bare ground is the camera's, unless Shift asks for a marquee.
    if (id === null) return shift ? this.startMarquee(world) : null;

    if (shift) {
      if (this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    } else if (!this.selection.has(id)) {
      this.selection = new Set([id]);
    }
    this.refresh();

    // Shift-clicking a building *out* of the selection still belongs to the
    // planner — it must not also pan the view — but there is nothing to drag.
    if (!this.selection.has(id)) return Grab.DRAG;

    // Read-only: the press is still the planner's, so it selects and does not
    // pan out from under the player, but no move is begun. With `pressWorld`
    // left null every later step — `onMove`, the carry test in `onRelease`,
    // `commitMove` — falls through to doing nothing, so there is one guard
    // here rather than four downstream.
    if (this.readOnly) return Grab.DRAG;

    this.pressWorld = world;
    this.dragDelta = { dx: 0, dy: 0 };
    this.dragInvalid = false;
    this.plan.beginMove(this.selection);
    return Grab.DRAG;
  }

  private startMarquee(world: Point): Grab {
    this.pressWorld = world;
    this.marquee = rectFromCorners(world.x, world.y, world.x, world.y);
    return Grab.MARQUEE;
  }

  private onMove(world: Point, grab: Grab): void {
    // A building out of the drawer has no press to measure from: it follows
    // the pointer absolutely.
    if (this.placing) {
      if (grab === Grab.CARRY) this.dragPlacement(world);
      return;
    }

    const press = this.pressWorld;
    if (!press) return;

    if (grab === Grab.MARQUEE) {
      this.marquee = rectFromCorners(press.x, press.y, world.x, world.y);
      this.selection = this.view.inMarquee(this.marquee);
      this.refresh();
      return;
    }

    const { dx, dy } = this.view.dragToYard(world.x - press.x, world.y - press.y);
    if (dx === this.dragDelta.dx && dy === this.dragDelta.dy) return;
    this.dragDelta = { dx, dy };

    const result = this.plan.testMove(dx, dy);
    this.dragInvalid = !result.valid;
    this.faulted = new Set<number>();
    for (const issue of result.issues) {
      this.faulted.add(issue.id);
      if (issue.otherId !== undefined) this.faulted.add(issue.otherId);
    }

    this.view.syncSome(this.selection, dx, dy);
    this.refresh();
  }

  private onRelease(world: Point, grab: Grab, travelled: boolean): "carry" | void {
    if (this.placing) return this.dropPlacement(world);

    const press = this.pressWorld;

    if (grab === Grab.MARQUEE) {
      this.pressWorld = null;
      if (press) {
        this.selection = this.view.inMarquee(rectFromCorners(press.x, press.y, world.x, world.y));
      }
      this.marquee = null;
      this.refresh();
      return;
    }

    // A click on a selected building picks it up. `press` is null when the
    // press was a Shift toggle, which selects but never carries.
    if (grab === Grab.DRAG && !travelled && press && this.selection.size > 0) {
      this.dragDelta = { dx: 0, dy: 0 };
      this.dragInvalid = false;
      this.faulted.clear();
      this.view.syncSome(this.selection);
      this.refresh();
      return "carry";
    }

    const { dx, dy } = this.dragDelta;
    const entries = press ? this.plan.commitMove(dx, dy) : null;

    // A carried selection that cannot be dropped stays in hand: the grid is
    // reopened and the pointer keeps testing, exactly as before the click.
    if (grab === Grab.CARRY && !entries && (dx !== 0 || dy !== 0)) {
      this.plan.beginMove(this.selection);
      this.refresh();
      return "carry";
    }

    this.pressWorld = null;
    this.dragDelta = { dx: 0, dy: 0 };
    this.dragInvalid = false;
    this.faulted.clear();

    if (entries) this.record(entries);
    else this.plan.cancelMove();

    // Either way the sprites go to where the plan now says they are: forward
    // for an accepted drop, back to the start for a refused one.
    this.view.syncSome(this.selection);
    this.view.resort();
    this.afterEdit();
  }

  /**
   * Puts a carried selection back where it came from (F14).
   *
   * The touch spelling of the secondary button: a finger has none, so the bar
   * grows a "Put back" chip while something is in hand and it lands here. Same
   * path as Escape, and a no-op when nothing is in hand — the chip is hidden
   * then, and clearing the selection would be a surprising answer to a button
   * that says "put back".
   */
  putBack(): void {
    if (this.input.isGrabbing) this.cancel();
  }

  /** Cancels a live gesture; Escape with nothing in hand clears instead. */
  private cancel(): void {
    if (this.placing) {
      this.abandonPlacement();
      return;
    }
    if (!this.input.isGrabbing) {
      this.clearSelection();
      return;
    }
    this.input.cancel();
    this.plan.cancelMove();
    this.marquee = null;
    this.pressWorld = null;
    this.dragDelta = { dx: 0, dy: 0 };
    this.dragInvalid = false;
    this.faulted.clear();
    this.view.syncSome(this.selection);
    this.refresh();
  }

  private onKey(event: KeyboardEvent): boolean {
    const action = plannerAction(event);
    if (!action) return false;

    switch (action.kind) {
      case "tool":
        this.setTool(action.tool === "box" ? PlannerTool.BOX : PlannerTool.SELECT);
        return true;
      case "nudge":
        this.nudge(action.dx, action.dy);
        return true;
      case "undo":
        this.undo();
        return true;
      case "redo":
        this.redo();
        return true;
      case "cancel":
        this.cancel();
        return true;
      case "view":
        this.onViewToggle();
        return true;
      case "find":
        // Deliberately does not touch the tool: the player is still selecting,
        // they are only choosing what with.
        this.onFind?.();
        return true;
      case "ranges":
        // The scene owns what is drawn over the yard, the same way it owns the
        // view switch: the session knows nothing about the overlays.
        this.onRanges?.();
        return true;
      case "mirror":
        this.groupTool(action.axis === "x" ? GroupOp.MIRROR_X : GroupOp.MIRROR_Y);
        return true;
      case "store":
        this.store();
        return true;
    }
  }

  /* ── Bookkeeping ────────────────────────────────────────────────────── */

  /** Pushes an already-applied move. A label names it in the undo tooltip. */
  private record(entries: readonly MoveEntry[], label?: string): void {
    const move = (batch: readonly MoveEntry[], reverse: boolean): void =>
      this.plan.move(batch, reverse);
    this.stack.pushApplied(
      label === undefined ? moveCommand(entries, move) : moveCommand(entries, move, label),
    );
  }

  /** After an edit: the moved set may have changed and the plan is dirty. */
  private afterEdit(): void {
    this.moved = new Set(this.plan.movedIds());
    this.refresh();
  }

  /** After undo, redo or a load: every building may have moved. */
  private afterHistory(): void {
    // Before the sync, not after: a building undo has just taken out of the
    // drawer needs its sprite shown again before it is put back in place.
    this.view.syncStored();
    this.view.syncAll();
    this.view.resort();
    this.moved = new Set(this.plan.movedIds());
    this.refresh();
  }

  private refresh(): void {
    this.view.draw({
      selected: this.selection,
      moved: this.moved,
      invalid: this.faulted,
      // Rebuilt rather than cached: a plan edit, an undo, a load and a rebase
      // can all change it, and it is one pass over the nodes — the same order
      // as `movedIds`, which this method already pays for.
      planned: this.plan.plannedLevels(),
      marquee: this.marquee,
    });
    this.onChange();
  }
}
