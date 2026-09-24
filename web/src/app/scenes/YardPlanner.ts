import type {
  BuildingDataMap,
  FiredTrap,
  Layout,
  Resources,
  TrapPlacement,
  UpgradeReport,
} from "@/api/types";
import { ApiError, NetworkError } from "@/api/http";
import {
  applyConflictIds,
  applyLayout,
  rearmTraps as postTrapRearm,
  upgradeWalls as postWallUpgrade,
} from "@/api/yardplanner";
import type { Camera } from "@/game/Camera";
import { TRAP_TYPES, WALL_TYPES } from "@/game/yard/buildingCosts";
import { blueprintToWorld } from "@/game/yard/planner/blueprint";
import { GROUP_OPS } from "@/game/yard/planner/groupTools";
import type { Checklist } from "@/game/yard/planner/checklist";
import type { LoadMiss } from "@/game/yard/planner/layout";
import type { PlanNode } from "@/game/yard/planner/placement";
import { GroupRefusal, PlannerSession, type GroupOutcome } from "@/game/yard/planner/PlannerSession";
import { summariseSelection } from "@/game/yard/planner/summary";
import { planTotals } from "@/game/yard/planner/upgrades";
import { footprintCentre, footprintOf } from "@/game/yard/YardGrid";
import { freeWorkers } from "@/game/yard/workers";
import type { Yard } from "@/game/yard/yardModel";
import { YardView, type YardRenderer } from "@/game/yard/YardRenderer";
import type { Notices } from "@/ui/maproom/Notices";
import type { Panel } from "@/ui/Panel";
import { InspectorPanel } from "@/ui/yard/InspectorPanel";
import { PlannerBar } from "@/ui/yard/PlannerBar";
import { InventoryPanel } from "@/ui/yard/InventoryPanel";
import {
  applyPanel,
  banner,
  checklistPanel,
  confirmPanel,
  describeLoadProblems,
  didNotFitPanel,
  rearmPanel,
  type BannerAction,
} from "@/ui/yard/PlannerDialogs";
import {
  hasSeenPlannerHint,
  markPlannerHintSeen,
  plannerHelpPanel,
  type HelpTab,
} from "@/ui/yard/PlannerHelp";
import { SearchPanel } from "@/ui/yard/SearchPanel";
import { describeCost } from "@/ui/yard/upgradeText";
import { wallUpgradePanel } from "@/ui/yard/WallUpgradePanel";
import { YardPlannerLayouts } from "./YardPlannerLayouts";

/**
 * Planner mode, from the scene's side.
 *
 * `YardScene` owns the yard and the camera and knows nothing about plans;
 * `PlannerSession` owns the plan and knows nothing about the network;
 * `YardPlannerLayouts` owns the slots. This is the seam between them, and it
 * holds the rules that are neither geometry nor transport: Apply is blocked by
 * the local checklist before the server ever sees it (design §3, F17 and §8,
 * Q4), a load reports what would not fit without placing it (§8, Q8), and
 * leaving with unsaved changes asks first.
 */

const NOTICE = "yard-planner";

export interface YardPlannerOptions {
  yard: Yard;
  renderer: YardRenderer;
  camera: Camera;
  canvas: HTMLCanvasElement;
  /** Where the bars and panels are docked. */
  overlay: HTMLElement;
  notices: Notices;
  /**
   * The read-only mode's own top toolbar (the Plan button and status line),
   * which stays mounted under the planner's bars and is measured again once
   * they are gone (see `onInset`).
   */
  readOnlyToolbar: HTMLElement;
  /**
   * Opens the planner for reading only (design §8, Q5): the yard is not the
   * player's own, or it is not loaded in build mode.
   *
   * The session refuses every edit and the bar drops the controls that would
   * write to the yard; Apply, the batch actions and the layout slots are never
   * reachable, so the three network calls below cannot fire.
   */
  readOnly?: boolean;
  /**
   * Traps the attack save recorded as fired, from the load response.
   *
   * One of the two sources the re-arm button counts; the other is whatever a
   * loaded layout named that this yard no longer has (plan §3.4).
   */
  firedtraps?: readonly FiredTrap[];
  /**
   * Called after a successful apply, with the yard the server wrote.
   *
   * `resources` and `upgrades` arrive whenever Apply was asked to start the
   * planned upgrades (`docs/design/planner-upgrades.md` §5.5): the pool has
   * been charged server-side, so the HUD re-reads it rather than subtracting,
   * and the report is raised as a notice by the scene — the planner closes on
   * Apply (§8, Q4) and takes its own notices with it.
   */
  onApplied: (
    buildingdata: BuildingDataMap,
    moved: number,
    resources: Resources | undefined,
    upgrades: UpgradeReport | null,
  ) => void;
  /**
   * Called after a batch action the server completed, with the save as it now
   * holds it.
   *
   * Unlike `onApplied` this does **not** close the planner: the player is in
   * the middle of a layout and a wall upgrade is not the end of it. The scene
   * rebuilds its yard and must then call `rebase` so the plan keeps its
   * positions and its undo stack over the new levels.
   */
  onYardChanged: (buildingdata: BuildingDataMap, resources: Resources) => void;
  /** Switches the renderer's view and re-bounds the camera to match. */
  onView: (view: YardView) => void;
  /**
   * Called whenever the chrome overlaying the canvas changes height, in CSS
   * px from the viewport's top and bottom edges, so the scene can keep the
   * fit-to-plot floor out from under the bars.
   */
  onInset: (inset: { top: number; bottom: number }) => void;
  /**
   * Called whenever the plan changes — a drag step, a drop, an undo, a load, a
   * rebase — so the scene can refresh anything drawn from the buildings'
   * current positions, the minimap above all.
   *
   * A bare signal rather than the plan itself, and optional, so the session
   * still knows nothing about what is listening. Fires once per pointer move
   * during a drag, which is exactly the rate a live minimap wants.
   */
  onPlanChanged?: () => void;
  /** Called when the planner closes itself. */
  onExit: () => void;
}

export class YardPlanner {
  private readonly options: YardPlannerOptions;
  private readonly session: PlannerSession;
  private readonly layouts: YardPlannerLayouts;
  private readonly bar: PlannerBar;
  private readonly dock: HTMLElement;
  /**
   * The inspector's own dock, on the other side of the canvas.
   *
   * Design §4.1 puts the inspector opposite the stack of transient panels, and
   * they cannot share a column: the inspector is up for as long as anything is
   * selected, so a checklist or a search box docked above it would push it
   * around on every click.
   */
  private readonly inspectorDock: HTMLElement;
  /**
   * Where the help card sits: centred over the canvas rather than in the left
   * column with the checklist and the search box.
   *
   * It is the one panel here that is not a reply to something the player just
   * did — the first opening puts it up unasked — so it has to be where they
   * are already looking, and it has to be obvious enough that dismissing it is
   * a decision rather than an accident.
   */
  private readonly helpDock: HTMLElement;

  private openPanel: Panel | null = null;
  private helpPanel: Panel | null = null;
  private inspector: InspectorPanel | null = null;
  private search: SearchPanel | null = null;
  private inventory: InventoryPanel | null = null;
  /** The drawer count the docked panels were last drawn from. */
  private storedShown = 0;
  private notice: HTMLElement | null = null;
  private applying = false;
  private batching = false;

  /** The yard as the server last told us it is. Replaced by `rebase`. */
  private yard: Yard;
  /** Fired traps from the load response, struck off as they are put back. */
  private fired: readonly FiredTrap[];
  /** Trap positions a loaded layout named that this yard has no building for. */
  private missingTraps: readonly TrapPlacement[] = [];

  /** True when nothing in this session may change the yard (§8, Q5). */
  private readonly readOnly: boolean;

  constructor(options: YardPlannerOptions) {
    this.options = options;
    this.yard = options.yard;
    this.fired = options.firedtraps ?? [];
    this.readOnly = options.readOnly ?? false;

    this.dock = document.createElement("div");
    this.dock.className = "planner-dock";
    options.overlay.append(this.dock);

    this.inspectorDock = document.createElement("div");
    this.inspectorDock.className = "planner-dock planner-dock--right";
    options.overlay.append(this.inspectorDock);

    this.helpDock = document.createElement("div");
    this.helpDock.className = "planner-help-dock";
    options.overlay.append(this.helpDock);

    this.session = new PlannerSession({
      yard: options.yard,
      renderer: options.renderer,
      camera: options.camera,
      canvas: options.canvas,
      onChange: () => this.refreshBar(),
      onViewToggle: () => {
        this.setView(
          this.session.state().view === YardView.ISO ? YardView.BLUEPRINT : YardView.ISO,
        );
      },
      onFind: () => this.openSearch(),
      onGroup: (outcome) => this.reportGroupTool(outcome),
      readOnly: this.readOnly,
    });

    this.layouts = new YardPlannerLayouts({
      session: this.session,
      dock: this.dock,
      readOnly: this.readOnly,
      onLoad: (layout) => this.loadLayout(layout, false),
      onPreview: (layout) => this.loadLayout(layout, true),
      notify: (message, level) =>
        options.notices.show(NOTICE, message, {
          level,
          ...(level === "info" ? { timeoutMs: 4000 } : {}),
        }),
    });

    this.bar = new PlannerBar({
      onTool: (tool) => this.session.setTool(tool),
      onView: (view) => this.setView(view),
      onGroupTool: (op) => {
        this.session.groupTool(op);
      },
      onUndo: () => this.session.undo(),
      onRedo: () => this.session.redo(),
      onFind: () => this.toggleSearch(),
      onLayouts: () => void this.layouts.toggle(),
      onChecklist: () => this.showChecklist(),
      onUpgradeWalls: () => this.showWallUpgrade(),
      onRearmTraps: () => this.showRearm(),
      onApply: () => this.apply(),
      onPutBack: () => this.session.putBack(),
      onStore: () => this.storeSelection(),
      onClearYard: () => this.confirmClearYard(),
      onInventory: () => this.toggleInventory(),
      onHelp: () => this.openHelp("basics", false),
      onExit: () => this.requestExit(),
    }, { readOnly: this.readOnly });
    this.bar.mount(options.overlay);
    this.reportPlannerInset();

    this.session.attach();
    this.refreshBar();
    this.bar.setRearmCount(this.rearmTargets().length);

    // First opening only. The flag is per browser rather than per account: it
    // is about whether this person has seen the card, and the client has no
    // per-player settings to hang it on.
    if (!hasSeenPlannerHint()) this.openHelp("basics", true);
  }

  /** True when there are edits that have not been saved to a slot. */
  get hasUnsavedChanges(): boolean {
    return this.session.state().dirty;
  }

  /** Shows the yard flat or isometric. The plan is untouched either way. */
  setView(view: YardView): void {
    if (this.session.state().view === view) return;
    this.options.onView(view);
    this.session.viewChanged();
  }

  /** Asks before discarding, then closes. */
  requestExit(): void {
    if (
      this.hasUnsavedChanges &&
      !window.confirm("Leave the planner and discard the changes you have not saved?")
    ) {
      return;
    }
    this.options.onExit();
  }

  /**
   * Re-reads a yard a batch action changed, without closing the planner.
   *
   * The scene has already rebuilt its sprites from the new `buildingdata`; this
   * puts them back where the *plan* has them and takes the server's word for
   * the levels, the new traps and anything that has gone.
   */
  rebase(yard: Yard): void {
    this.yard = yard;
    this.session.rebase(yard);
    this.refreshBar();
    this.search?.setNodes(this.session.plan.buildings());
  }

  /* ── Storing (issue #50) ────────────────────────────────────────────── */

  /**
   * Store, from the bar button, the selection chip or Delete.
   *
   * The session drops mushrooms and anything else fixed out of the selection
   * silently, so a marquee that caught one still stores the rest; a press that
   * stored nothing at all is the one case worth a word, because the player
   * pressed a button and watched the yard not change.
   */
  private storeSelection(): void {
    if (this.readOnly) return;
    const stored = this.session.store();
    if (stored === 0) {
      this.options.notices.show(
        NOTICE,
        this.session.state().selectionCount === 0
          ? "Select some buildings first, then press Store."
          : "Nothing there can be stored: mushrooms stay where they are.",
        { level: "warning", timeoutMs: 4000 },
      );
      return;
    }
    this.openInventory();
    this.options.notices.show(
      NOTICE,
      `Stored ${stored} ${plural(stored, "building")}. Ctrl+Z puts ${stored === 1 ? "it" : "them"} back.`,
      { level: "info", timeoutMs: 4000 },
    );
  }

  /**
   * Clear yard: everything not fixed into the drawer, after asking.
   *
   * Asked about rather than simply done, although it is one Ctrl+Z away: a
   * player who mis-clicks watches their whole yard disappear, and undo is not
   * the first thing anyone thinks of in that second.
   */
  private confirmClearYard(): void {
    if (this.readOnly) return;
    const count = this.session.plan.buildings().length;
    if (count === 0) {
      this.options.notices.show(NOTICE, "The yard is already empty.", {
        level: "info",
        timeoutMs: 4000,
      });
      return;
    }

    this.openDialog(
      confirmPanel({
        title: "Clear the yard?",
        message: `Store all ${count} ${plural(count, "building")}?`,
        note: "Nothing changes in your yard until you press Apply, and Ctrl+Z puts them all back.",
        confirmLabel: "Clear yard",
        onConfirm: () => {
          this.closeDialog();
          const stored = this.session.clearYard();
          this.openInventory();
          this.options.notices.show(
            NOTICE,
            `Stored ${stored} ${plural(stored, "building")}. Ctrl+Z puts them all back.`,
            { level: "info", timeoutMs: 6000 },
          );
        },
        onClose: () => this.closeDialog(),
      }),
    );
  }

  /** Opens the drawer, or brings its contents up to date if it is already up. */
  private openInventory(): void {
    if (this.readOnly) return;
    const panel =
      this.inventory ??
      new InventoryPanel({
        onPlace: (id) => this.session.startPlacing(id),
        onClose: () => {
          this.inventory = null;
        },
      }).mount(this.dock);
    this.inventory = panel;
    panel.setNodes(this.session.storedNodes());
  }

  private toggleInventory(): void {
    if (this.inventory) {
      this.inventory.close();
      this.inventory = null;
      return;
    }
    this.openInventory();
  }

  destroy(): void {
    this.closeDialog();
    this.helpPanel?.close();
    this.helpPanel = null;
    this.inspector?.close();
    this.inspector = null;
    this.search?.close();
    this.search = null;
    this.inventory?.close();
    this.inventory = null;
    this.layouts.destroy();
    this.session.detach();
    this.bar.destroy();
    this.dock.remove();
    this.inspectorDock.remove();
    this.helpDock.remove();
    this.options.notices.clear(NOTICE);
    this.reportReadOnlyInset();
  }

  /* ── Loading a slot ─────────────────────────────────────────────────── */

  /**
   * Loads a slot, or opens it read-only.
   *
   * Whatever the layout could not place stays exactly where it stood and is
   * named in the banner. §8, Q4 forbids auto-placing it: a building left in the
   * yard can be sitting on the cells the layout wants, so guessing would hide a
   * collision rather than resolve one.
   */
  private loadLayout(layout: Layout, preview: boolean): void {
    const result = this.session.load(layout, { preview });
    this.layouts.setCurrentSlot(this.session.state().slot);

    const missed = result.didNotFit.length;
    const message = describeLoadProblems({
      name: layout.name,
      layoutExpansion: result.expansion,
      yardExpansion: this.session.plan.expansion,
      didNotFit: missed,
      missing: result.missing.length,
      plansDropped: result.plansDropped,
    });

    // A preview reports exactly what a load does. It changes nothing, but what
    // it could not place is the whole reason to look at a layout before
    // committing to it — and a read-only session has no other kind of load
    // (issue #17), so returning early here silenced the report for every
    // planner opened on somebody else's yard.
    const actions: BannerAction[] =
      missed > 0
        ? [{ label: "Show me", run: () => this.showDidNotFit(result.didNotFit, result.expansion) }]
        : [];

    if (preview) {
      const head = `Previewing “${layout.name}”. Nothing has been changed.`;
      // Both buttons, not one: a preview that also left something behind has
      // two things to offer, and dropping either strands the player with a
      // preview they cannot close or a list they cannot reach.
      actions.push({
        label: "Close preview",
        run: () => {
          this.session.dismissPreview();
          this.clearBanner();
        },
      });
      this.showBanner(
        message === null ? head : `${head} ${message}`,
        message === null ? "info" : "warning",
        actions,
      );
      return;
    }

    // A saved node with no building is the second source of fired-trap
    // positions: a trap that exploded is deleted from the save, so a layout
    // that still names it is the only record of where it stood.
    this.missingTraps = result.missing
      .filter((entry) => TRAP_TYPES.includes(entry.t))
      .map((entry) => ({ t: entry.t, x: entry.x, y: entry.y }));
    this.bar.setRearmCount(this.rearmTargets().length);

    if (message === null) {
      this.clearBanner();
      return;
    }
    this.showBanner(message, "warning", actions);
  }

  /** The per-building list behind the banner's "Show me" (issue #17). */
  private showDidNotFit(misses: readonly LoadMiss[], expansion: number): void {
    this.selectAndFrame(misses.map((miss) => miss.id));
    this.openDialog(
      didNotFitPanel({
        misses,
        layoutExpansion: expansion,
        yardExpansion: this.session.plan.expansion,
        onShow: (id) => this.selectAndFrame([id]),
        onClose: () => this.closeDialog(),
      }),
    );
  }

  /* ── Mirror, align and distribute ───────────────────────────────────── */

  /**
   * Says what a group operation did, or why it did nothing (design §3, F7).
   *
   * Refusals matter more than successes here: a mirror moves everything at
   * once, so a player who is told only "nothing happened" has no way to guess
   * which of forty walls was the problem. The session has already outlined the
   * offenders in red, and this names the count and the reason so the two read
   * as one answer.
   *
   * A read-only session cannot reach the operation at all, so that refusal is
   * only ever a programming error and is left silent.
   */
  private reportGroupTool(outcome: GroupOutcome): void {
    const name = GROUP_OPS[outcome.op].label;

    if (outcome.ok) {
      this.options.notices.show(
        NOTICE,
        `${name}: moved ${outcome.moved} ${plural(outcome.moved, "building")}. Ctrl+Z puts them back.`,
        { level: "info", timeoutMs: 4000 },
      );
      return;
    }

    switch (outcome.reason) {
      case GroupRefusal.READ_ONLY:
        return;
      case GroupRefusal.TOO_FEW:
        this.options.notices.show(NOTICE, `${name} needs a bigger selection.`, {
          level: "warning",
          timeoutMs: 4000,
        });
        return;
      case GroupRefusal.NO_CHANGE:
        this.options.notices.show(NOTICE, `${name}: the selection is already like that.`, {
          level: "info",
          timeoutMs: 4000,
        });
        return;
      default:
        this.options.notices.show(
          NOTICE,
          `Cannot ${name.toLowerCase()} here: ${outcome.blocked} ${plural(outcome.blocked, "building")} would overlap or leave the plot. Nothing moved.`,
          { level: "warning" },
        );
    }
  }

  /* ── Checklist and Apply ────────────────────────────────────────────── */

  private showChecklist(): void {
    const checklist = this.session.checklist();
    this.bar.setBlocking(blockingCount(checklist));
    this.openDialog(
      checklistPanel({
        checklist,
        onShow: (id) => this.selectAndFrame([id]),
        ...(this.readOnly ? {} : { onOpenInventory: () => this.openInventory() }),
        onClose: () => this.closeDialog(),
      }),
    );
  }

  /**
   * Apply: check locally, then show what the click is about to do.
   *
   * The blocking checklist still comes first and still refuses outright (§8,
   * Q4). Past it the dialog is not a confirmation so much as a statement of
   * what Apply will *partly* do: the upgrade walk is partial by design (§3.2),
   * so the itemised preview is the only place the player is told which of
   * their six towers is the one that waits.
   */
  private apply(): void {
    if (this.readOnly || this.applying) return;

    const checklist = this.session.checklist();
    this.bar.setBlocking(blockingCount(checklist));
    if (!checklist.ok) {
      this.showChecklist();
      this.options.notices.show(NOTICE, "Apply is blocked. See the checklist.", {
        level: "warning",
      });
      return;
    }

    const state = this.session.state();
    this.openDialog(
      applyPanel({
        moved: this.session.plan.movedIds().length,
        preview: this.session.applyPreview(),
        slotName: state.slot === null ? null : state.slotName || `Slot ${state.slot + 1}`,
        dirty: state.dirty,
        onSaveAs: () => {
          this.closeDialog();
          void this.layouts.toggle();
        },
        onConfirm: (choice) => {
          this.closeDialog();
          void this.runApply(choice);
        },
        onClose: () => this.closeDialog(),
      }),
    );
  }

  /**
   * Sends the layout, optionally saving it to its slot first.
   *
   * The save is awaited rather than fired alongside: Apply closes the planner
   * and the upgrades it could not start live in the saved layout and nowhere
   * else (§5.5). A failed save is reported and the apply is abandoned, because
   * applying after a failed save is exactly the case the checkbox exists to
   * prevent.
   */
  private async runApply(choice: {
    startUpgrades: boolean;
    saveFirst: boolean;
  }): Promise<void> {
    if (this.readOnly || this.applying) return;
    this.applying = true;
    try {
      const state = this.session.state();
      if (choice.saveFirst && state.slot !== null) {
        await this.layouts.saveTo(state.slot, state.slotName || `Slot ${state.slot + 1}`);
        if (this.session.state().dirty) {
          this.options.notices.show(
            NOTICE,
            "The layout could not be saved, so nothing was applied. Try again, or untick “save first”.",
            { level: "error" },
          );
          return;
        }
      }

      const response = await applyLayout(this.session.payload(), {
        startUpgrades: choice.startUpgrades,
      });
      this.options.onApplied(
        response.buildingdata,
        response.moved,
        response.resources,
        response.upgrades ?? null,
      );
    } catch (caught) {
      const ids = applyConflictIds(caught);
      if (ids.length > 0) this.session.faultIds(ids);
      this.options.notices.show(NOTICE, describe(caught, "The server refused the layout."), {
        level: "error",
      });
    } finally {
      this.applying = false;
    }
  }

  /* ── Batch wall upgrade ─────────────────────────────────────────────── */

  private showWallUpgrade(): void {
    this.openDialog(
      wallUpgradePanel({
        nodes: this.session.selectedNodes(),
        yard: this.yard,
        onConfirm: (ids, level) => {
          this.closeDialog();
          void this.runWallUpgrade(ids, level);
        },
        onClose: () => this.closeDialog(),
      }),
    );
  }

  private async runWallUpgrade(ids: number[], level: number): Promise<void> {
    if (this.readOnly || this.batching) return;
    this.batching = true;
    try {
      const response = await postWallUpgrade(ids, level);
      this.options.notices.show(
        NOTICE,
        `Upgraded ${response.upgraded} ${plural(response.upgraded, "wall")} to level ${response.level} for ${describeCost(response.cost)}.`,
        { level: "info", timeoutMs: 6000 },
      );
      this.options.onYardChanged(response.buildingdata, response.resources);
    } catch (caught) {
      this.reportBatchFailure(caught, "The server refused the upgrade.");
    } finally {
      this.batching = false;
    }
  }

  /* ── Trap re-arm ────────────────────────────────────────────────────── */

  /**
   * Every fired trap the planner knows a position for.
   *
   * The two sources — the save's own `firedtraps` and whatever a loaded layout
   * named that this yard has lost — can report the same spot, so they are
   * de-duplicated by type and position. A trap that fired twice at one spot is
   * still one trap to put back.
   */
  private rearmTargets(): TrapPlacement[] {
    const seen = new Set<string>();
    const targets: TrapPlacement[] = [];

    const consider = (trap: TrapPlacement): void => {
      if (!TRAP_TYPES.includes(trap.t)) return;
      const key = `${trap.t}:${trap.x}:${trap.y}`;
      if (seen.has(key)) return;
      seen.add(key);
      targets.push(trap);
    };

    for (const entry of this.fired) consider({ t: entry.t, x: entry.X, y: entry.Y });
    for (const entry of this.missingTraps) consider(entry);
    return targets;
  }

  private showRearm(): void {
    const traps = this.rearmTargets();
    this.openDialog(
      rearmPanel({
        traps,
        yard: this.yard,
        canPlace: (type, x, y) => this.session.plan.canPlace(type, x, y),
        onShow: (trap) => this.frameSpot(trap),
        onConfirm: (chosen) => {
          this.closeDialog();
          void this.runRearm(chosen);
        },
        onClose: () => this.closeDialog(),
      }),
    );
  }

  private async runRearm(traps: TrapPlacement[]): Promise<void> {
    if (this.readOnly || this.batching) return;
    this.batching = true;
    try {
      const response = await postTrapRearm(traps);

      // The server's list is authoritative for what is still outstanding; the
      // layout-derived half is local, so the placed spots are struck off here.
      this.fired = response.firedtraps ?? [];
      const placed = new Set(traps.map((trap) => `${trap.t}:${trap.x}:${trap.y}`));
      this.missingTraps = this.missingTraps.filter(
        (trap) => !placed.has(`${trap.t}:${trap.x}:${trap.y}`),
      );

      this.options.notices.show(
        NOTICE,
        `Re-armed ${response.placed} ${plural(response.placed, "trap")} for ${describeCost(response.cost)}.`,
        { level: "info", timeoutMs: 6000 },
      );
      this.options.onYardChanged(response.buildingdata, response.resources);
      this.bar.setRearmCount(this.rearmTargets().length);
    } catch (caught) {
      this.reportBatchFailure(caught, "The server refused the re-arm.");
    } finally {
      this.batching = false;
    }
  }

  private reportBatchFailure(caught: unknown, fallback: string): void {
    const ids = applyConflictIds(caught);
    if (ids.length > 0) this.session.faultIds(ids);
    this.options.notices.show(NOTICE, describe(caught, fallback), { level: "error" });
  }

  /* ── Find ───────────────────────────────────────────────────────────── */

  /**
   * F: open the search box, or put the caret back in it.
   *
   * The key is "find", not "toggle find": a player who presses it while the
   * box is already open wants to search again, not to lose it. The toolbar
   * button is the one that closes it.
   */
  private openSearch(): void {
    if (this.search) {
      this.search.focus();
      return;
    }
    const panel = new SearchPanel({
      onSelect: (ids) => this.selectAndFrame(ids),
      onClose: () => {
        this.search = null;
      },
    }).mount(this.dock);
    this.search = panel;
    panel.setNodes(this.session.plan.buildings());
    panel.focus();
  }

  private toggleSearch(): void {
    if (this.search) {
      this.search.close();
      this.search = null;
      return;
    }
    this.openSearch();
  }

  /* ── Chrome ─────────────────────────────────────────────────────────── */

  /**
   * Rewrites the bar and the inspector from the session's state.
   *
   * The cost cells read **the plan** once anything is planned and fall back to
   * the selection when nothing is (§5.3). Both answers are wanted, but not at
   * once: a player who has planned six towers wants the bar to say what Apply
   * is about to charge, and a player who has planned nothing wants to know what
   * the buildings they have just clicked would cost.
   */
  private refreshBar(): void {
    this.options.onPlanChanged?.();
    const state = this.session.state();
    this.bar.update(state);

    const nodes = this.session.selectedNodes();
    if (state.plannedCount > 0) {
      this.bar.setPlanSummary(
        planTotals(this.session.plannedNodes(), this.yard),
        freeWorkers(this.yard),
      );
      this.bar.setWorkers(this.yard.workers, this.session.applyPreview());
    } else {
      this.bar.setSummary(summariseSelection(nodes, this.yard));
      this.bar.setWorkers(this.yard.workers, null);
    }
    this.bar.setWallCount(nodes.filter((node) => WALL_TYPES.includes(node.type)).length);

    // The drawer and the Find list are views over the plan, so they follow
    // every store and every placement. Only then, though: this runs once per
    // pointer move during a drag, and regrouping 575 buildings into stacks at
    // that rate would cost more than the drag does. Every edit that moves a
    // building between the yard and the drawer changes the count, and every
    // edit refreshes, so the count is a complete signal here.
    if (state.storedCount !== this.storedShown) {
      this.storedShown = state.storedCount;
      this.inventory?.setNodes(this.session.storedNodes());
      this.search?.setNodes(this.session.plan.buildings());
    }

    this.refreshInspector(nodes);
  }

  /**
   * Opens, redraws or closes the inspector for the current selection.
   *
   * One panel for both shapes rather than two that swap: a click that grows a
   * selection from one building to two changes what the panel says, not which
   * panel it is, and a panel that is destroyed and rebuilt on every such click
   * loses the scroll position and flickers.
   */
  private refreshInspector(nodes: readonly PlanNode[]): void {
    if (nodes.length === 0) {
      this.inspector?.close();
      this.inspector = null;
      return;
    }

    const panel =
      this.inspector ??
      new InspectorPanel({
        onPlan: (ids, level) => this.plan(ids, level),
        onUpgradeWalls: () => this.showWallUpgrade(),
        readOnly: this.readOnly,
        onClose: () => {
          this.inspector = null;
        },
      }).mount(this.inspectorDock);
    this.inspector = panel;
    panel.show(nodes, this.yard);
  }

  /**
   * Plans a target on the named buildings, or clears it, and says so.
   *
   * The session refuses what F1 rule 3 refuses — a busy or damaged building, a
   * level the yard has already passed — silently, by leaving it out of the
   * command. The count it returns is how many actually changed, so a click that
   * did nothing is the one case worth a word.
   */
  private plan(ids: readonly number[], level: number | null): void {
    const changed = this.session.setPlanLevel(ids, level);
    if (changed > 0 || ids.length === 0) return;
    this.options.notices.show(
      NOTICE,
      level === null
        ? "Nothing to clear there."
        : "That upgrade cannot be planned: the building is on a job, damaged, or already there.",
      { level: "warning", timeoutMs: 4000 },
    );
  }

  /**
   * Puts the camera on a bare spot, which is what "show me" means for a trap
   * that is not there any more.
   *
   * `renderer.centreOf` only answers for a building that exists, so the point
   * is worked out from the position itself, in whichever projection is showing.
   */
  private frameSpot(trap: TrapPlacement): void {
    const [width, height] = footprintOf(trap.t);
    const centre =
      this.session.state().view === YardView.BLUEPRINT
        ? blueprintToWorld(trap.x + width / 2, trap.y + height / 2)
        : footprintCentre(this.yard.bounds, trap.t, trap.x, trap.y);
    this.options.camera.centreOn(centre);
    this.options.camera.dirty = true;
  }

  /** Reports how far the planner's own top and bottom bars cut into the canvas. */
  private reportPlannerInset(): void {
    const top = this.bar.toolbar.getBoundingClientRect().bottom;
    const bottom = window.innerHeight - this.bar.actionBar.getBoundingClientRect().top;
    this.options.onInset({ top, bottom });
  }

  /** Reports the read-only toolbar's inset, once the planner's own bars are gone. */
  private reportReadOnlyInset(): void {
    const top = this.options.readOnlyToolbar.getBoundingClientRect().bottom;
    this.options.onInset({ top, bottom: 0 });
  }

  /** Selects buildings and puts the camera on the first of them. */
  private selectAndFrame(ids: number[]): void {
    this.session.selectOnly(ids);
    const first = ids[0];
    if (first === undefined) return;
    const centre = this.options.renderer.centreOf(first);
    if (!centre) return;
    this.options.camera.centreOn(centre);
    this.options.camera.dirty = true;
  }

  /**
   * Opens the help card, on the tab asked for.
   *
   * Closing it in any way sets the "seen" flag, not just the "Got it" button.
   * A player who shuts a card with its cross has read as much of it as they
   * mean to, and showing it to them again every time they open the planner
   * would be the worst kind of help — the `?` button is right there, and it
   * brings the same card back.
   */
  private openHelp(tab: HelpTab, firstOpen: boolean): void {
    this.helpPanel?.close();
    this.helpPanel = plannerHelpPanel({
      tab,
      firstOpen,
      onClose: () => {
        this.helpPanel = null;
        markPlannerHintSeen();
      },
    }).mount(this.helpDock);
  }

  private openDialog(panel: Panel): void {
    this.closeDialog();
    this.openPanel = panel.mount(this.dock);
  }

  private closeDialog(): void {
    this.openPanel?.close();
    this.openPanel = null;
  }

  private showBanner(
    message: string,
    level: "info" | "warning" | "error",
    actions: readonly BannerAction[] = [],
  ): void {
    this.clearBanner();
    this.notice = banner({
      message,
      level,
      ...(actions.length > 0 ? { actions } : {}),
      onDismiss: () => this.clearBanner(),
    });
    this.dock.prepend(this.notice);
  }

  private clearBanner(): void {
    this.notice?.remove();
    this.notice = null;
  }
}

const plural = (count: number, word: string): string => (count === 1 ? word : `${word}s`);

/**
 * How many checklist rows actually stop Apply.
 *
 * Warning rows are left out: a planned upgrade with no free worker is started
 * on the next Apply, not a reason to refuse this one
 * (`docs/design/planner-upgrades.md` §5.5), so counting it on the Checklist
 * button would put a red badge on a plan that is perfectly fine.
 */
const blockingCount = (checklist: Checklist): number =>
  checklist.rows.filter((row) => !row.ok && !row.warning).length;

const describe = (caught: unknown, fallback: string): string => {
  if (caught instanceof NetworkError) return "Could not reach the server.";
  if (caught instanceof ApiError) return caught.message || fallback;
  return fallback;
};
