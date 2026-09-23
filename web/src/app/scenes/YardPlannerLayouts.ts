import { ApiError, NetworkError } from "@/api/http";
import type { Layout } from "@/api/types";
import { deleteLayout, listLayouts, saveLayout } from "@/api/yardplanner";
import type { PlannerSession } from "@/game/yard/planner/PlannerSession";
import { LayoutsPanel } from "@/ui/yard/LayoutsPanel";

/**
 * The layout slots and the three calls that serve them.
 *
 * Opening the panel, listing, saving, deleting and Ctrl+S all live here, apart
 * from `YardPlanner` so that neither file has to hold both the checklist rules
 * and the slot plumbing. The panel is created on demand and destroyed with the
 * planner, so a closed panel costs nothing and a reopened one always shows what
 * the server has now rather than what it had when the planner opened.
 *
 * Loading a layout is *not* here: it changes the plan and needs the banner, so
 * it belongs with the rest of the planner's editing. This only hands the chosen
 * layout back through `onLoad` and `onPreview`.
 */

export interface LayoutsControllerOptions {
  session: PlannerSession;
  /** Where the panel docks. */
  dock: HTMLElement;
  /**
   * A read-only planner (design §8, Q5) has no slots at all: the panel never
   * opens and Ctrl+S is left to the browser, because saving a layout writes to
   * the signed-in player's own slots and this yard is not theirs to plan.
   */
  readOnly?: boolean;
  onLoad: (layout: Layout) => void;
  onPreview: (layout: Layout) => void;
  notify: (message: string, level: "info" | "error") => void;
}

export class YardPlannerLayouts {
  private readonly options: LayoutsControllerOptions;
  private panel: LayoutsPanel | null = null;

  constructor(options: LayoutsControllerOptions) {
    this.options = options;
    if (!options.readOnly) window.addEventListener("keydown", this.onKeyDown, true);
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown, true);
    this.panel?.close();
    this.panel = null;
  }

  /** Opens the panel, or closes it if it is already up. */
  async toggle(): Promise<void> {
    if (this.options.readOnly) return;
    if (this.panel) {
      this.panel.close();
      this.panel = null;
      return;
    }

    const panel = new LayoutsPanel({
      onLoad: (layout) => this.options.onLoad(layout),
      onPreview: (layout) => this.options.onPreview(layout),
      onSave: (slot, name) => void this.save(slot, name),
      onDelete: (slot) => void this.remove(slot),
      onClose: () => {
        this.panel = null;
      },
    }).mount(this.options.dock);
    this.panel = panel;
    panel.setCurrentSlot(this.options.session.state().slot);

    await this.refresh();
  }

  /** Re-reads the slots after any change to them. */
  async refresh(): Promise<void> {
    const panel = this.panel;
    if (!panel) return;
    try {
      const response = await listLayouts();
      // The panel may have been closed while the request was in flight.
      if (this.panel !== panel) return;
      panel.show(
        response.layouts,
        response.slots,
        response.layouts.length === 0
          ? "No saved layouts yet. Arrange your yard, then press Save."
          : undefined,
      );
      panel.setCurrentSlot(this.options.session.state().slot);
    } catch (caught) {
      panel.showError(describe(caught, "Could not list your layouts."));
    }
  }

  /** Tells the panel which slot the plan now belongs to. */
  setCurrentSlot(slot: number | null): void {
    this.panel?.setCurrentSlot(slot);
  }

  private async save(slot: number, name: string): Promise<void> {
    this.panel?.setBusy(true);
    try {
      const layout = await saveLayout(slot, name, this.options.session.payload());
      this.options.session.markSaved(layout.slot, layout.name);
      this.options.notify(`Saved to slot ${layout.slot + 1}.`, "info");
    } catch (caught) {
      this.options.notify(describe(caught, "Could not save the layout."), "error");
    } finally {
      this.panel?.setBusy(false);
      await this.refresh();
    }
  }

  private async remove(slot: number): Promise<void> {
    this.panel?.setBusy(true);
    try {
      await deleteLayout(slot);
    } catch (caught) {
      this.options.notify(describe(caught, "Could not delete the layout."), "error");
    } finally {
      this.panel?.setBusy(false);
      await this.refresh();
    }
  }

  /**
   * Ctrl+S: save to the slot the plan came from.
   *
   * With no slot loaded there is nothing to overwrite and no name to use, so
   * this opens the panel rather than inventing either. Guessing a free slot
   * would leave the player with layouts they did not mean to make.
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    event.stopPropagation();

    const state = this.options.session.state();
    if (state.slot !== null) {
      void this.save(state.slot, state.slotName || `Slot ${state.slot + 1}`);
      return;
    }
    void this.toggle().then(() => {
      this.options.notify("Pick a slot, name it, then press Save.", "info");
    });
  };
}

const describe = (caught: unknown, fallback: string): string => {
  if (caught instanceof NetworkError) return "Could not reach the server.";
  if (caught instanceof ApiError) return caught.message || fallback;
  return fallback;
};
