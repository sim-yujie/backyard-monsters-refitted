import { PlannerTool, type PlannerState } from "@/game/yard/planner/PlannerSession";

/**
 * The planner's two bars: tools across the top, the plan summary and the
 * actions along the bottom (design §4.1).
 *
 * HTML rather than canvas, as §4 asks, so the buttons get real focus, real
 * tooltips and real keyboard behaviour for nothing. Every control carries its
 * shortcut in the tooltip, because that is the only place a player will look
 * for it.
 *
 * The bar is stateless: `update` is handed the session's state and rewrites the
 * bits that changed. Nothing here calls back into the plan.
 */

export interface PlannerBarActions {
  onTool: (tool: PlannerTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onLayouts: () => void;
  onChecklist: () => void;
  onApply: () => void;
  onHelp: () => void;
  onExit: () => void;
}

const button = (label: string, title: string, className = "btn btn--ghost"): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.title = title;
  return element;
};

export class PlannerBar {
  readonly toolbar: HTMLElement;
  readonly actionBar: HTMLElement;

  private readonly tools = new Map<PlannerTool, HTMLButtonElement>();
  private readonly undo: HTMLButtonElement;
  private readonly redo: HTMLButtonElement;
  private readonly apply: HTMLButtonElement;
  private readonly checklist: HTMLButtonElement;
  private readonly summary: HTMLElement;
  private readonly slotLabel: HTMLElement;

  constructor(actions: PlannerBarActions) {
    this.toolbar = document.createElement("div");
    this.toolbar.className = "planner-bar planner-bar--top";
    this.toolbar.setAttribute("aria-label", "Planner tools");

    const title = document.createElement("span");
    title.className = "planner-bar__title";
    title.textContent = "Yard Planner";

    this.slotLabel = document.createElement("span");
    this.slotLabel.className = "planner-bar__slot u-muted";

    const select = button("Select", "Select tool (V)");
    select.addEventListener("click", () => actions.onTool(PlannerTool.SELECT));
    const box = button("Box", "Box select (B)");
    box.addEventListener("click", () => actions.onTool(PlannerTool.BOX));
    this.tools.set(PlannerTool.SELECT, select);
    this.tools.set(PlannerTool.BOX, box);

    this.undo = button("Undo", "Undo (Ctrl+Z)");
    this.undo.addEventListener("click", actions.onUndo);
    this.redo = button("Redo", "Redo (Ctrl+Shift+Z or Ctrl+Y)");
    this.redo.addEventListener("click", actions.onRedo);

    const help = button("?", "Keyboard shortcuts", "btn btn--ghost btn--icon");
    help.addEventListener("click", actions.onHelp);

    const exit = button("Leave planner", "Leave planner (P)");
    exit.addEventListener("click", actions.onExit);

    this.toolbar.append(
      title,
      this.slotLabel,
      group(select, box),
      group(this.undo, this.redo),
      spacer(),
      help,
      exit,
    );

    /* ── Bottom bar ─────────────────────────────────────────────────── */

    this.actionBar = document.createElement("div");
    this.actionBar.className = "planner-bar planner-bar--bottom";
    this.actionBar.setAttribute("aria-label", "Plan summary and actions");

    this.summary = document.createElement("span");
    this.summary.className = "planner-bar__summary";
    this.summary.setAttribute("role", "status");

    const layouts = button("Layouts", "Saved layouts (Ctrl+S saves to the current slot)");
    layouts.addEventListener("click", actions.onLayouts);

    this.checklist = button("Checklist", "What is blocking Apply");
    this.checklist.addEventListener("click", actions.onChecklist);

    this.apply = button("Apply", "Write this layout to your yard", "btn btn--primary");
    this.apply.addEventListener("click", actions.onApply);

    this.actionBar.append(this.summary, spacer(), this.checklist, layouts, this.apply);
  }

  mount(container: HTMLElement): this {
    container.append(this.toolbar, this.actionBar);
    return this;
  }

  /** Redraws from the session's state. */
  update(state: PlannerState): void {
    for (const [tool, element] of this.tools) {
      element.setAttribute("aria-pressed", String(state.tool === tool));
    }

    this.undo.disabled = !state.canUndo;
    this.undo.title = state.canUndo ? `Undo ${state.undoLabel} (Ctrl+Z)` : "Nothing to undo";
    this.redo.disabled = !state.canRedo;
    this.redo.title = state.canRedo
      ? `Redo ${state.redoLabel} (Ctrl+Shift+Z)`
      : "Nothing to redo";

    this.slotLabel.textContent = state.previewing
      ? `Previewing “${state.slotName}”`
      : state.slotName
        ? `${state.slotName}${state.dirty ? " · unsaved" : ""}`
        : state.dirty
          ? "Unsaved changes"
          : "No layout loaded";

    this.summary.textContent = summarise(state);
    this.apply.disabled = state.previewing;
    this.apply.title = state.previewing
      ? "Close the preview before applying"
      : "Write this layout to your yard";
  }

  /** Shows the count of blocking problems on the checklist button. */
  setBlocking(count: number): void {
    this.checklist.textContent = count > 0 ? `Checklist · ${count}` : "Checklist";
    this.checklist.classList.toggle("planner-bar__checklist--bad", count > 0);
  }

  destroy(): void {
    this.toolbar.remove();
    this.actionBar.remove();
  }
}

const summarise = (state: PlannerState): string => {
  const parts: string[] = [];
  parts.push(
    state.selectionCount === 0
      ? "Nothing selected"
      : state.selectionCount === 1
        ? "1 selected"
        : `${state.selectionCount} selected`,
  );
  parts.push(state.movedCount === 1 ? "1 moved" : `${state.movedCount} moved`);
  if (state.dragInvalid) parts.push("cannot drop here");
  else if (state.previewing) parts.push("read-only preview");
  return parts.join(" · ");
};

const group = (...children: HTMLElement[]): HTMLElement => {
  const element = document.createElement("div");
  element.className = "planner-bar__group";
  element.append(...children);
  return element;
};

const spacer = (): HTMLElement => {
  const element = document.createElement("div");
  element.className = "planner-bar__spacer";
  return element;
};
