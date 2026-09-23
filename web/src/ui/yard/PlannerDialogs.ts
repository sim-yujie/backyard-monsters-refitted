import type { Checklist } from "@/game/yard/planner/checklist";
import { Panel } from "@/ui/Panel";

/**
 * The planner's small overlays: the pre-Apply checklist, the shortcut sheet and
 * the banner that reports what a loaded layout could not place.
 *
 * All three are transient and none of them owns state, so they are plain
 * builders returning an element the scene docks and drops. The checklist is the
 * one that matters (design §3, F17): every failing row lists the buildings it
 * failed on, and clicking one selects it on the canvas.
 */

export interface ChecklistPanelOptions {
  checklist: Checklist;
  /** Selects the building and frames it. */
  onShow: (id: number) => void;
  onClose: () => void;
}

/** The pre-Apply checklist. Blocking rows disable Apply; there are no warnings yet. */
export const checklistPanel = (options: ChecklistPanelOptions): Panel => {
  const panel = new Panel({
    title: "Before applying",
    className: "map-panel planner-checklist",
    onClose: options.onClose,
  });

  const list = document.createElement("ul");
  list.className = "planner-checklist__rows";

  for (const row of options.checklist.rows) {
    const item = document.createElement("li");
    item.className = `planner-checklist__row planner-checklist__row--${row.ok ? "ok" : "bad"}`;

    const heading = document.createElement("p");
    heading.className = "planner-checklist__heading";
    // The mark is a shape as well as a colour, per §4.3.
    heading.textContent = `${row.ok ? "✓" : "✕"} ${row.label}`;
    item.append(heading);

    if (row.items.length > 0) {
      const faults = document.createElement("ul");
      faults.className = "planner-checklist__faults";
      for (const fault of row.items) {
        const entry = document.createElement("li");
        const link = document.createElement("button");
        link.type = "button";
        link.className = "btn btn--ghost planner-checklist__show";
        link.textContent = fault.label;
        link.title = "Select this building";
        link.addEventListener("click", () => options.onShow(fault.id));
        entry.append(link);
        faults.append(entry);
      }
      item.append(faults);
    }

    list.append(item);
  }

  const verdict = document.createElement("p");
  verdict.className = "u-muted";
  verdict.textContent = options.checklist.ok
    ? "Nothing is blocking Apply."
    : "Apply is blocked until these are fixed.";

  panel.setContent(list, verdict);
  return panel;
};

/** F13's shortcut sheet, listing only what phase 1 actually binds. */
export const shortcutsPanel = (onClose: () => void): Panel => {
  const panel = new Panel({
    title: "Keyboard shortcuts",
    className: "map-panel planner-shortcuts",
    onClose,
  });

  const rows: [string, string][] = [
    ["P", "Enter or leave the planner"],
    ["V", "Select tool"],
    ["B", "Box select"],
    ["Shift + drag", "Box select with the select tool"],
    ["Shift + click", "Add or remove one building"],
    ["Arrow keys", "Nudge the selection by one grid step"],
    ["Shift + arrows", "Nudge by ten steps"],
    ["Ctrl + Z", "Undo"],
    ["Ctrl + Shift + Z, Ctrl + Y", "Redo"],
    ["Ctrl + S", "Save to the current slot"],
    ["Escape", "Cancel a drag, or clear the selection"],
    ["Delete", "Nothing yet — storing arrives with the store tool"],
  ];

  const list = document.createElement("dl");
  list.className = "cell-facts";
  for (const [key, meaning] of rows) {
    const term = document.createElement("dt");
    term.textContent = key;
    const value = document.createElement("dd");
    value.textContent = meaning;
    list.append(term, value);
  }

  panel.setContent(list);
  return panel;
};

export interface BannerOptions {
  message: string;
  level?: "info" | "warning" | "error";
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}

/**
 * The strip that reports what a load could not place (design §8, Q8).
 *
 * It names the count and the expansion level the layout was designed for, and
 * it never offers to place anything automatically — Q4 forbids it, because a
 * building left where it is can be sitting on the cells the layout wants.
 */
export const banner = (options: BannerOptions): HTMLElement => {
  const element = document.createElement("div");
  element.className = `planner-banner planner-banner--${options.level ?? "warning"}`;
  element.setAttribute("role", "status");

  const text = document.createElement("span");
  text.textContent = options.message;
  element.append(text);

  if (options.actionLabel && options.onAction) {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "btn btn--ghost";
    action.textContent = options.actionLabel;
    action.addEventListener("click", options.onAction);
    element.append(action);
  }

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "btn btn--ghost btn--icon";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "×";
  dismiss.addEventListener("click", options.onDismiss);
  element.append(dismiss);

  return element;
};
