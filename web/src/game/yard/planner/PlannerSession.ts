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
  type MoveEntry,
  type PlanEntry,
} from "./commands";
import { groupTargets, GroupOp, GROUP_OPS } from "./groupTools";
import { planLoad, payloadFor, type LoadResult } from "./layout";
import { rectFromCorners } from "./marquee";
import type { PlanNode } from "./placement";
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

export class PlannerSession {
  readonly plan: Plan;

  private readonly view: PlannerView;
  private readonly input: PlannerInput;
  private readonly stack: CommandStack;
  private readonly onChange: () => void;
  private readonly onViewToggle: () => void;
  private readonly onFind: (() => void) | undefined;
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
      previewing: this.preview !== null || this.readOnly,
      readOnly: this.readOnly,
      view: this.view.view,
    };
  }

  /* ── Tools and selection ────────────────────────────────────────────── */

  setTool(tool: PlannerTool): void {
    if (this.tool === tool) return;
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
    const checklist = buildChecklist(this.plan.index(), this.plan.validate(), [], planned);
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

  /** Cancels a live gesture; Escape with nothing in hand clears instead. */
  private cancel(): void {
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
      case "mirror":
        this.groupTool(action.axis === "x" ? GroupOp.MIRROR_X : GroupOp.MIRROR_Y);
        return true;
      case "ignore":
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
      marquee: this.marquee,
    });
    this.onChange();
  }
}
