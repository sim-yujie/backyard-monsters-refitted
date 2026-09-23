import type { BuildingDataMap, Layout } from "@/api/types";
import { ApiError, NetworkError } from "@/api/http";
import { applyConflictIds, applyLayout } from "@/api/yardplanner";
import type { Camera } from "@/game/Camera";
import { PlannerSession } from "@/game/yard/planner/PlannerSession";
import type { Yard } from "@/game/yard/yardModel";
import type { YardRenderer } from "@/game/yard/YardRenderer";
import type { Notices } from "@/ui/maproom/Notices";
import type { Panel } from "@/ui/Panel";
import { PlannerBar } from "@/ui/yard/PlannerBar";
import { banner, checklistPanel, shortcutsPanel } from "@/ui/yard/PlannerDialogs";
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
  /** Called after a successful apply, with the yard the server wrote. */
  onApplied: (buildingdata: BuildingDataMap, moved: number) => void;
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
  private notice: HTMLElement | null = null;
  private applying = false;

  constructor(options: YardPlannerOptions) {
    this.options = options;

    this.dock = document.createElement("div");
    this.dock.className = "planner-dock";
    options.overlay.append(this.dock);

    this.session = new PlannerSession({
      yard: options.yard,
      renderer: options.renderer,
      camera: options.camera,
      canvas: options.canvas,
      onChange: () => this.bar.update(this.session.state()),
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
      onUndo: () => this.session.undo(),
      onRedo: () => this.session.redo(),
      onLayouts: () => void this.layouts.toggle(),
      onChecklist: () => this.showChecklist(),
      onApply: () => void this.apply(),
      onHelp: () => this.openDialog(shortcutsPanel(() => this.closeDialog())),
      onExit: () => this.requestExit(),
    });
    this.bar.mount(options.overlay);

    this.session.attach();
    this.bar.update(this.session.state());
  }

  /** True when there are edits that have not been saved to a slot. */
  get hasUnsavedChanges(): boolean {
    return this.session.state().dirty;
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

  destroy(): void {
    this.closeDialog();
    this.layouts.destroy();
    this.session.detach();
    this.bar.destroy();
    this.dock.remove();
    this.options.notices.clear(NOTICE);
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

  /* ── Chrome ─────────────────────────────────────────────────────────── */

  /** Selects buildings and puts the camera on the first of them. */
  private selectAndFrame(ids: number[]): void {
    this.session.selectOnly(ids);
    const first = ids[0];
    if (first === undefined) return;
    const shape = this.options.renderer.shapeOf(first);
    if (!shape) return;
    this.options.camera.centreOn({
      x: shape.x + (shape.width - shape.height) / 2,
      y: shape.y + (shape.width + shape.height) / 4,
    });
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

const describe = (caught: unknown, fallback: string): string => {
  if (caught instanceof NetworkError) return "Could not reach the server.";
  if (caught instanceof ApiError) return caught.message || fallback;
  return fallback;
};
