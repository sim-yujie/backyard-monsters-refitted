import type {
  BatchCost,
  BuildingDataMap,
  FiredTrap,
  Layout,
  Resources,
  TrapPlacement,
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
import { PlannerSession } from "@/game/yard/planner/PlannerSession";
import { summariseSelection } from "@/game/yard/planner/summary";
import { footprintCentre, footprintOf } from "@/game/yard/YardGrid";
import type { Yard } from "@/game/yard/yardModel";
import { YardView, type YardRenderer } from "@/game/yard/YardRenderer";
import { formatAmount } from "@/ui/format";
import type { Notices } from "@/ui/maproom/Notices";
import type { Panel } from "@/ui/Panel";
import { PlannerBar } from "@/ui/yard/PlannerBar";
import { banner, checklistPanel, rearmPanel, shortcutsPanel } from "@/ui/yard/PlannerDialogs";
import { SearchPanel } from "@/ui/yard/SearchPanel";
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
   * Traps the attack save recorded as fired, from the load response.
   *
   * One of the two sources the re-arm button counts; the other is whatever a
   * loaded layout named that this yard no longer has (plan §3.4).
   */
  firedtraps?: readonly FiredTrap[];
  /** Called after a successful apply, with the yard the server wrote. */
  onApplied: (buildingdata: BuildingDataMap, moved: number) => void;
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

  private openPanel: Panel | null = null;
  private search: SearchPanel | null = null;
  private notice: HTMLElement | null = null;
  private applying = false;
  private batching = false;

  /** The yard as the server last told us it is. Replaced by `rebase`. */
  private yard: Yard;
  /** Fired traps from the load response, struck off as they are put back. */
  private fired: readonly FiredTrap[];
  /** Trap positions a loaded layout named that this yard has no building for. */
  private missingTraps: readonly TrapPlacement[] = [];

  constructor(options: YardPlannerOptions) {
    this.options = options;
    this.yard = options.yard;
    this.fired = options.firedtraps ?? [];

    this.dock = document.createElement("div");
    this.dock.className = "planner-dock";
    options.overlay.append(this.dock);

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
    });

    this.layouts = new YardPlannerLayouts({
      session: this.session,
      dock: this.dock,
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
      onUndo: () => this.session.undo(),
      onRedo: () => this.session.redo(),
      onFind: () => this.toggleSearch(),
      onLayouts: () => void this.layouts.toggle(),
      onChecklist: () => this.showChecklist(),
      onUpgradeWalls: () => this.showWallUpgrade(),
      onRearmTraps: () => this.showRearm(),
      onApply: () => void this.apply(),
      onHelp: () => this.openDialog(shortcutsPanel(() => this.closeDialog())),
      onExit: () => this.requestExit(),
    });
    this.bar.mount(options.overlay);
    this.reportPlannerInset();

    this.session.attach();
    this.refreshBar();
    this.bar.setRearmCount(this.rearmTargets().length);
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

  destroy(): void {
    this.closeDialog();
    this.search?.close();
    this.search = null;
    this.layouts.destroy();
    this.session.detach();
    this.bar.destroy();
    this.dock.remove();
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

    if (preview) {
      this.showBanner(`Previewing “${layout.name}”. Nothing has been changed.`, "info", {
        label: "Close preview",
        run: () => {
          this.session.dismissPreview();
          this.clearBanner();
        },
      });
      return;
    }

    const problems: string[] = [];
    const missed = result.didNotFit.length;
    if (missed > 0) {
      problems.push(
        `${missed} ${plural(missed, "building")} did not fit and ${missed === 1 ? "was" : "were"} left where ${missed === 1 ? "it" : "they"} stood`,
      );
    }
    if (result.missing.length > 0) {
      problems.push(
        `${result.missing.length} saved ${plural(result.missing.length, "building")} no longer in this yard`,
      );
    }

    // A saved node with no building is the second source of fired-trap
    // positions: a trap that exploded is deleted from the save, so a layout
    // that still names it is the only record of where it stood.
    this.missingTraps = result.missing
      .filter((entry) => TRAP_TYPES.includes(entry.t))
      .map((entry) => ({ t: entry.t, x: entry.x, y: entry.y }));
    this.bar.setRearmCount(this.rearmTargets().length);

    if (problems.length === 0) {
      this.clearBanner();
      return;
    }
    this.showBanner(
      `“${layout.name}” was designed for expansion ${result.expansion}: ${problems.join("; ")}. Nothing was placed for you — move or remove them yourself.`,
      "warning",
      missed > 0
        ? { label: "Show me", run: () => this.selectAndFrame(result.didNotFit.map((m) => m.id)) }
        : undefined,
    );
  }

  /* ── Checklist and Apply ────────────────────────────────────────────── */

  private showChecklist(): void {
    const checklist = this.session.checklist();
    this.bar.setBlocking(checklist.rows.filter((row) => !row.ok).length);
    this.openDialog(
      checklistPanel({
        checklist,
        onShow: (id) => this.selectAndFrame([id]),
        onClose: () => this.closeDialog(),
      }),
    );
  }

  private async apply(): Promise<void> {
    if (this.applying) return;

    const checklist = this.session.checklist();
    this.bar.setBlocking(checklist.rows.filter((row) => !row.ok).length);
    if (!checklist.ok) {
      this.showChecklist();
      this.options.notices.show(NOTICE, "Apply is blocked. See the checklist.", {
        level: "warning",
      });
      return;
    }

    this.applying = true;
    try {
      const response = await applyLayout(this.session.payload());
      this.options.notices.show(
        NOTICE,
        `Moved ${response.moved} ${plural(response.moved, "building")}.`,
        { level: "info", timeoutMs: 5000 },
      );
      this.options.onApplied(response.buildingdata, response.moved);
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
    if (this.batching) return;
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
    if (this.batching) return;
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

  /** Rewrites the bar from the session's state and the selection's cost. */
  private refreshBar(): void {
    this.options.onPlanChanged?.();
    this.bar.update(this.session.state());
    const nodes = this.session.selectedNodes();
    this.bar.setSummary(summariseSelection(nodes, this.yard));
    this.bar.setWallCount(nodes.filter((node) => WALL_TYPES.includes(node.type)).length);
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
    action?: { label: string; run: () => void },
  ): void {
    this.clearBanner();
    this.notice = banner({
      message,
      level,
      ...(action ? { actionLabel: action.label, onAction: action.run } : {}),
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

/** "280.0M twigs and 284.0M pebbles", leaving out whatever cost nothing. */
const describeCost = (cost: BatchCost): string => {
  const parts = [
    cost.r1 > 0 ? `${formatAmount(cost.r1)} twigs` : "",
    cost.r2 > 0 ? `${formatAmount(cost.r2)} pebbles` : "",
    cost.r3 > 0 ? `${formatAmount(cost.r3)} putty` : "",
    cost.r4 > 0 ? `${formatAmount(cost.r4)} goo` : "",
  ].filter(Boolean);

  if (parts.length === 0) return "nothing";
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
};

const describe = (caught: unknown, fallback: string): string => {
  if (caught instanceof NetworkError) return "Could not reach the server.";
  if (caught instanceof ApiError) return caught.message || fallback;
  return fallback;
};
