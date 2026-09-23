import type { Layout, LayoutPayload } from "@/api/types";
import type { Camera } from "@/game/Camera";
import type { Point, Rect } from "../YardGrid";
import type { Yard } from "../yardModel";
import type { YardRenderer, YardView } from "../YardRenderer";
import { buildChecklist, type Checklist } from "./checklist";
import { CommandStack, moveCommand, type MoveEntry } from "./commands";
import { planLoad, payloadFor, type LoadResult } from "./layout";
import { rectFromCorners } from "./marquee";
import type { PlanNode } from "./placement";
import { Grab, PlannerInput } from "./PlannerInput";
import { PlannerView } from "./PlannerView";
import { Plan, type AbsorbResult } from "./plan";
import { plannerAction } from "./shortcuts";

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

export interface PlannerState {
  readonly tool: PlannerTool;
  readonly selectionCount: number;
  readonly movedCount: number;
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

export class PlannerSession {
  readonly plan: Plan;

  private readonly view: PlannerView;
  private readonly input: PlannerInput;
  private readonly stack: CommandStack;
  private readonly onChange: () => void;
  private readonly onViewToggle: () => void;
  private readonly onFind: (() => void) | undefined;
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
  /** Positions to restore when a preview is dismissed. */
  private preview: Map<number, readonly [number, number]> | null = null;

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
    this.readOnly = options.readOnly ?? false;
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
      for (const node of this.plan.buildings()) this.preview.set(node.id, [node.x, node.y]);
      this.plan.move(result.entries, false);
    } else {
      this.stack.push(
        moveCommand(
          result.entries,
          (batch, reverse) => this.plan.move(batch, reverse),
          `Load “${layout.name}”`,
        ),
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
    for (const [id, [x, y]] of preview) this.plan.setPosition(id, x, y);
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

  /** The three blocking checks Apply runs before it calls the server. */
  checklist(): Checklist {
    const checklist = buildChecklist(this.plan.index(), this.plan.validate());
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
      case "ignore":
        return true;
    }
  }

  /* ── Bookkeeping ────────────────────────────────────────────────────── */

  private record(entries: readonly MoveEntry[]): void {
    this.stack.pushApplied(moveCommand(entries, (batch, reverse) => this.plan.move(batch, reverse)));
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
