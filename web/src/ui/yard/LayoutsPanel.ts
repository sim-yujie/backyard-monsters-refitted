import type { Layout } from "@/api/types";
import { MAX_LAYOUT_NAME_LENGTH } from "@/api/yardplanner";
import { layoutMeta } from "@/game/yard/planner/layout";
import { TOOL_NEEDS_PLANNER } from "@/game/yard/planner/access";
import { lockArt } from "@/ui/lockArt";
import { Panel } from "@/ui/Panel";
import { setControlLocked } from "./plannerLock";

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
 *
 * Without a built Yard Planner in the yard only slot 1 is usable (owner, beta
 * 8). The other slots stay listed as compact locked rows — a save already in
 * one keeps its name in full — under one line saying what unlocks them, and
 * Compare is locked on slot 1 (astra, direction B). A press on any of them
 * says why; nothing in a locked slot is loaded, previewed, written or deleted.
 */

export interface LayoutsPanelActions {
  onLoad: (layout: Layout) => void;
  onPreview: (layout: Layout) => void;
  /** Compare the plan with this slot (#9). Absent, the rows have no Compare. */
  onCompare?: (layout: Layout) => void;
  onSave: (slot: number, name: string) => void;
  onDelete: (slot: number) => void;
  onClose: () => void;
  /** A locked slot or a locked Compare was pressed: says why. */
  onLocked?: () => void;
}

/** Which slots a yard may use, and why the rest are locked (owner, beta 8). */
export interface LayoutsGate {
  /** Slots from slot 1 up that work as before. */
  readonly usable: number;
  /** Why the rest and Compare are locked, or null when nothing is. */
  readonly locked: string | null;
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
  private usable = 10;
  private locked: string | null = null;
  private readonly gateNote: HTMLElement;

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

    this.gateNote = document.createElement("div");
    this.gateNote.className = "planner-layouts__gate";
    this.gateNote.hidden = true;

    this.panel.setContent(this.status, this.gateNote, this.list);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  close(): void {
    this.panel.close();
  }

  /** Replaces the list with what the server returned. */
  show(layouts: readonly Layout[], slots: number, note?: string, gate?: LayoutsGate): void {
    this.slots = Math.max(slots, 1);
    this.usable = Math.max(1, Math.min(gate?.usable ?? this.slots, this.slots));
    this.locked = gate?.locked ?? null;
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
    this.renderGate();
    const rows: HTMLElement[] = [];
    for (let slot = 0; slot < this.slots; slot++) {
      const layout = this.layouts.get(slot);
      rows.push(slot < this.usable ? this.renderRow(slot, layout) : this.renderLocked(slot, layout));
    }
    this.list.replaceChildren(...rows);
  }

  /** Why the slots past the usable ones are locked: one line, over the list. */
  private renderGate(): void {
    const lockedSlots = this.slots - this.usable;
    this.gateNote.hidden = lockedSlots <= 0;
    if (lockedSlots <= 0) {
      this.gateNote.replaceChildren();
      return;
    }
    const reason = this.locked ?? TOOL_NEEDS_PLANNER;
    const line = document.createElement("p");
    line.className = "planner-layouts__gate-line";
    const words = document.createElement("span");
    words.textContent = `${reason} for ${this.slots} slots`;
    line.append(lockArt(18, "planner-lock__art"), words);
    const kept = [...this.layouts.keys()].some((slot) => slot >= this.usable);
    const parts: HTMLElement[] = [line];
    if (kept) {
      const keep = document.createElement("p");
      keep.className = "planner-layouts__gate-kept u-muted";
      keep.textContent = "Existing saves are kept";
      parts.push(keep);
    }
    this.gateNote.replaceChildren(...parts);
  }

  /**
   * A slot past the usable ones: its name (a save's in full, else "Slot N"),
   * one short line and a padlock, all one button that says why.
   */
  private renderLocked(slot: number, layout: Layout | undefined): HTMLElement {
    const row = document.createElement("li");
    row.className = "planner-layouts__row planner-layouts__row--locked";
    const press = document.createElement("button");
    press.type = "button";
    press.className = "btn btn--ghost planner-layouts__locked";
    press.setAttribute("aria-disabled", "true");
    const reason = this.locked ?? TOOL_NEEDS_PLANNER;
    press.title = reason;
    press.setAttribute(
      "aria-label",
      `Slot ${slot + 1}${layout ? `, ${layout.name}` : ", empty"}, locked. ${reason}`,
    );
    const text = document.createElement("span");
    text.className = "planner-layouts__locked-text";
    const name = document.createElement("span");
    name.className = "planner-layouts__locked-name";
    name.textContent = layout?.name || `Slot ${slot + 1}`;
    const meta = document.createElement("span");
    meta.className = "planner-layouts__meta u-muted";
    meta.textContent = layout ? "Saved · Locked" : "Empty";
    text.append(name, meta);
    press.append(text, lockArt(18, "planner-lock__art"));
    press.addEventListener("click", () => this.actions.onLocked?.());
    row.append(press);
    return row;
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
    meta.textContent = layout ? layoutMeta(layout) : "Empty";

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
    const onCompare = this.actions.onCompare;
    const compare = onCompare
      ? action("Compare", () => {
          if (this.locked !== null) this.actions.onLocked?.();
          else if (layout) onCompare(layout);
        })
      : null;
    if (compare) {
      compare.title = "See this layout beside your plan, with the two compared";
      // Locked, it stays pressable and says why (owner, beta 8).
      compare.disabled = this.locked === null && (!layout || this.busy);
      setControlLocked(compare, this.locked, "lead", 12);
    }

    const controls = document.createElement("div");
    controls.className = "planner-layouts__controls";
    controls.append(save, load, preview, ...(compare ? [compare] : []), this.deleteControl(slot, layout));

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
