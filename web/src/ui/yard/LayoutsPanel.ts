import type { Layout } from "@/api/types";
import { MAX_LAYOUT_NAME_LENGTH } from "@/api/yardplanner";
import { layoutDate } from "@/game/yard/planner/layout";
import { Panel } from "@/ui/Panel";

/**
 * The ten saved-layout slots (design §3, F18 and §8, Q2 and Q6).
 *
 * A row list, not a card grid, and no thumbnails: Q6 settled that. Each slot
 * shows what it is worth showing — name, building count, the expansion level it
 * was designed for and when it was last saved — plus Load, Preview, Save and
 * Delete. Preview is the read-only one; it opens the layout on the canvas
 * without marking the plan dirty, which is what replaces the thumbnail.
 *
 * Delete asks first, in the row itself rather than in a second dialog, so the
 * confirmation sits where the mistake would happen.
 */

export interface LayoutsPanelActions {
  onLoad: (layout: Layout) => void;
  onPreview: (layout: Layout) => void;
  onSave: (slot: number, name: string) => void;
  onDelete: (slot: number) => void;
  onClose: () => void;
}

export class LayoutsPanel {
  readonly element: HTMLElement;

  private readonly panel: Panel;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private readonly actions: LayoutsPanelActions;

  private slots = 10;
  private layouts = new Map<number, Layout>();
  private currentSlot: number | null = null;
  private confirmingDelete: number | null = null;
  private busy = false;

  constructor(actions: LayoutsPanelActions) {
    this.actions = actions;
    this.panel = new Panel({
      title: "Layouts",
      className: "map-panel planner-layouts",
      onClose: actions.onClose,
    });
    this.element = this.panel.element;

    this.status = document.createElement("p");
    this.status.className = "u-muted";
    this.status.textContent = "Loading…";

    this.list = document.createElement("ul");
    this.list.className = "planner-layouts__list";

    this.panel.setContent(this.status, this.list);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  close(): void {
    this.panel.close();
  }

  /** Replaces the list with what the server returned. */
  show(layouts: readonly Layout[], slots: number, note?: string): void {
    this.slots = Math.max(slots, 1);
    this.layouts = new Map(layouts.map((layout) => [layout.slot, layout]));
    this.status.textContent = note ?? "";
    this.status.hidden = !note;
    this.render();
  }

  /** Says what went wrong instead of an empty list. */
  showError(message: string): void {
    this.status.hidden = false;
    this.status.textContent = message;
    this.list.replaceChildren();
  }

  /** Marks which slot the plan came from, so "Save" defaults to it. */
  setCurrentSlot(slot: number | null): void {
    this.currentSlot = slot;
    this.render();
  }

  /** Greys the buttons while a request is in flight. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.render();
  }

  private render(): void {
    const rows: HTMLElement[] = [];
    for (let slot = 0; slot < this.slots; slot++) {
      rows.push(this.renderRow(slot, this.layouts.get(slot)));
    }
    this.list.replaceChildren(...rows);
  }

  private renderRow(slot: number, layout: Layout | undefined): HTMLElement {
    const row = document.createElement("li");
    row.className = "planner-layouts__row";
    if (slot === this.currentSlot) row.classList.add("planner-layouts__row--current");

    const name = document.createElement("input");
    name.type = "text";
    name.className = "field__input planner-layouts__name";
    name.maxLength = MAX_LAYOUT_NAME_LENGTH;
    name.value = layout?.name ?? "";
    name.placeholder = `Slot ${slot + 1}`;
    name.setAttribute("aria-label", `Name for slot ${slot + 1}`);

    const meta = document.createElement("span");
    meta.className = "planner-layouts__meta u-muted";
    meta.textContent = layout
      ? `${layout.nodes.length} buildings · expansion ${layout.expansion} · ${layoutDate(layout.updatedAt)}`
      : "Empty";

    const save = action("Save", () => {
      const typed = name.value.trim() || `Slot ${slot + 1}`;
      this.actions.onSave(slot, typed);
    });
    save.classList.add("planner-layouts__save");

    const load = action("Load", () => layout && this.actions.onLoad(layout));
    const preview = action("Preview", () => layout && this.actions.onPreview(layout));
    load.disabled = !layout || this.busy;
    preview.disabled = !layout || this.busy;
    save.disabled = this.busy;

    const controls = document.createElement("div");
    controls.className = "planner-layouts__controls";
    controls.append(save, load, preview, this.deleteControl(slot, layout));

    const head = document.createElement("div");
    head.className = "planner-layouts__head";
    head.append(name, meta);

    row.append(head, controls);
    return row;
  }

  /**
   * Delete, then the same button asking again.
   *
   * Two clicks on one control rather than a modal: the second click is the
   * confirmation the design asks for, and it cannot be dismissed by accident
   * onto the wrong slot because the question is attached to that row.
   */
  private deleteControl(slot: number, layout: Layout | undefined): HTMLButtonElement {
    const confirming = this.confirmingDelete === slot;
    const remove = action(confirming ? "Really delete?" : "Delete", () => {
      if (confirming) {
        this.confirmingDelete = null;
        this.actions.onDelete(slot);
      } else {
        this.confirmingDelete = slot;
        this.render();
      }
    });
    remove.disabled = !layout || this.busy;
    if (confirming) remove.classList.add("planner-layouts__confirm");
    return remove;
  }
}

const action = (label: string, onClick: () => void): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn--ghost";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
};
