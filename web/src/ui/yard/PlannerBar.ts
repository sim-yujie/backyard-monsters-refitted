import type { SelectionSummary } from "@/game/yard/planner/summary";
import { PlannerTool, type PlannerState } from "@/game/yard/planner/PlannerSession";
import { YardView } from "@/game/yard/YardRenderer";
import { formatAmount, formatCountdown } from "@/ui/format";

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
 *
 * ## The cost cells
 *
 * The left of the bottom bar is F3: four resource cells reading "needed /
 * held", a worker time and a shiny price, then the selection sentence. "Needed"
 * is what it would cost to take everything selected one level up — phase 1 has
 * no planned upgrades to add up, so the selection is the plan (plan §6, Q5).
 * A cell whose need is past what the yard holds carries `--short`, which is a
 * colour *and* a word in the tooltip, per §4.3.
 *
 * Shiny is shown and never purchasable (§6, Q6), so it is a readout like the
 * rest and not a button.
 *
 * ## Read-only
 *
 * A read-only session (design §8, Q5) gets the same bars minus everything that
 * would change the yard: no undo or redo, no Layouts, no Checklist, no batch
 * actions and no Apply, and a "Read-only" chip where the slot name goes. The
 * controls are left out rather than disabled, because a row of six dead
 * buttons reads as a broken planner and a player cannot tell which of them
 * they are meant to wait for. What stays is what answers questions: the two
 * selection tools, Find, the view switch and the cost cells.
 */

export interface PlannerBarActions {
  onTool: (tool: PlannerTool) => void;
  onView: (view: YardView) => void;
  onUndo: () => void;
  onRedo: () => void;
  onFind: () => void;
  onLayouts: () => void;
  onChecklist: () => void;
  onUpgradeWalls: () => void;
  onRearmTraps: () => void;
  onApply: () => void;
  onHelp: () => void;
  onExit: () => void;
}

/** `r1`..`r4` as the spec names them (docs/specs/base-building.md:573). */
const RESOURCE_LABELS: readonly (readonly [keyof SelectionSummary["needed"], string])[] = [
  ["r1", "Twigs"],
  ["r2", "Pebbles"],
  ["r3", "Putty"],
  ["r4", "Goo"],
];

const ZERO = { r1: 0, r2: 0, r3: 0, r4: 0 } as const;

const EMPTY_SUMMARY: SelectionSummary = {
  needed: ZERO,
  held: ZERO,
  shortfall: ZERO,
  seconds: 0,
  shiny: 0,
  byType: [],
  maxed: 0,
};

const button = (label: string, title: string, className = "btn btn--ghost"): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.title = title;
  return element;
};

/** One "needed / held" readout, with its own label and its own tooltip. */
class CostCell {
  readonly element: HTMLElement;

  private readonly value: HTMLElement;

  constructor(label: string, className = "planner-cost__cell") {
    this.element = document.createElement("span");
    this.element.className = className;

    const name = document.createElement("span");
    name.className = "planner-cost__label";
    name.textContent = label;

    this.value = document.createElement("span");
    this.value.className = "planner-cost__value";
    this.value.textContent = "—";

    this.element.append(name, this.value);
  }

  set(text: string, title: string, short = false): void {
    this.value.textContent = text;
    this.element.title = title;
    this.element.classList.toggle("planner-cost__cell--short", short);
  }
}

export class PlannerBar {
  readonly toolbar: HTMLElement;
  readonly actionBar: HTMLElement;

  private readonly tools = new Map<PlannerTool, HTMLButtonElement>();
  private readonly views = new Map<YardView, HTMLButtonElement>();
  private readonly undo: HTMLButtonElement;
  private readonly redo: HTMLButtonElement;
  private readonly apply: HTMLButtonElement;
  private readonly checklist: HTMLButtonElement;
  private readonly upgradeWalls: HTMLButtonElement;
  private readonly rearm: HTMLButtonElement;
  private readonly rearmBadge: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly slotLabel: HTMLElement;
  private readonly resourceCells = new Map<string, CostCell>();
  private readonly timeCell: CostCell;
  private readonly shinyCell: CostCell;
  private readonly readOnly: boolean;

  constructor(actions: PlannerBarActions, options: { readOnly?: boolean } = {}) {
    this.readOnly = options.readOnly ?? false;

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

    const find = button("Find", "Find buildings by name or type (F)");
    find.addEventListener("click", actions.onFind);

    const iso = button("3D", "The yard as it looks (Tab switches)");
    iso.addEventListener("click", () => actions.onView(YardView.ISO));
    const blueprint = button("Blueprint", "Flat top-down view for planning (Tab switches)");
    blueprint.addEventListener("click", () => actions.onView(YardView.BLUEPRINT));
    this.views.set(YardView.ISO, iso);
    this.views.set(YardView.BLUEPRINT, blueprint);

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
      group(select, box, find),
      group(iso, blueprint),
      ...(this.readOnly ? [] : [group(this.undo, this.redo)]),
      spacer(),
      help,
      exit,
    );

    /* ── Bottom bar ─────────────────────────────────────────────────── */

    this.actionBar = document.createElement("div");
    this.actionBar.className = "planner-bar planner-bar--bottom";
    this.actionBar.setAttribute("aria-label", "Plan summary and actions");

    const costs = document.createElement("div");
    costs.className = "planner-cost";
    costs.setAttribute("role", "group");
    costs.setAttribute("aria-label", "What the selection would cost");

    for (const [key, label] of RESOURCE_LABELS) {
      const cell = new CostCell(label);
      this.resourceCells.set(key, cell);
      costs.append(cell.element);
    }

    this.timeCell = new CostCell("Time", "planner-cost__cell planner-cost__cell--time");
    this.shinyCell = new CostCell("Shiny", "planner-cost__cell planner-cost__cell--shiny");
    costs.append(this.timeCell.element, this.shinyCell.element);

    this.summary = document.createElement("span");
    this.summary.className = "planner-bar__summary";
    this.summary.setAttribute("role", "status");

    const layouts = button("Layouts", "Saved layouts (Ctrl+S saves to the current slot)");
    layouts.addEventListener("click", actions.onLayouts);

    this.checklist = button("Checklist", "What is blocking Apply");
    this.checklist.addEventListener("click", actions.onChecklist);

    this.upgradeWalls = button("Upgrade walls", "Select some walls first");
    this.upgradeWalls.className = "btn btn--ghost planner-bar__walls";
    this.upgradeWalls.disabled = true;
    this.upgradeWalls.addEventListener("click", actions.onUpgradeWalls);

    // The label and the badge are separate children so the count can be
    // rewritten without the label being rebuilt around it.
    this.rearm = button("", "No fired traps to put back", "btn btn--ghost planner-bar__rearm");
    const rearmLabel = document.createElement("span");
    rearmLabel.textContent = "Re-arm traps";
    this.rearmBadge = document.createElement("span");
    this.rearmBadge.className = "planner-bar__badge";
    this.rearmBadge.hidden = true;
    this.rearm.append(rearmLabel, this.rearmBadge);
    this.rearm.disabled = true;
    this.rearm.addEventListener("click", actions.onRearmTraps);

    this.apply = button("Apply", "Write this layout to your yard", "btn btn--primary");
    this.apply.addEventListener("click", actions.onApply);

    if (this.readOnly) {
      // Every action below writes to the yard, so none of them is mounted.
      // `disabled` is set as well as the button being left out, so a caller
      // that reaches one through the actions object still finds it inert.
      for (const control of [this.upgradeWalls, this.rearm, this.checklist, layouts, this.apply]) {
        control.disabled = true;
      }
      this.actionBar.append(costs, this.summary, spacer());
    } else {
      this.actionBar.append(
        costs,
        this.summary,
        spacer(),
        this.upgradeWalls,
        this.rearm,
        this.checklist,
        layouts,
        this.apply,
      );
    }

    this.setSummary(EMPTY_SUMMARY);
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
    for (const [view, element] of this.views) {
      element.setAttribute("aria-pressed", String(state.view === view));
    }

    this.undo.disabled = !state.canUndo;
    this.undo.title = state.canUndo ? `Undo ${state.undoLabel} (Ctrl+Z)` : "Nothing to undo";
    this.redo.disabled = !state.canRedo;
    this.redo.title = state.canRedo
      ? `Redo ${state.redoLabel} (Ctrl+Shift+Z)`
      : "Nothing to redo";

    this.slotLabel.textContent = state.readOnly
      ? "Read-only"
      : state.previewing
        ? `Previewing “${state.slotName}”`
        : state.slotName
          ? `${state.slotName}${state.dirty ? " · unsaved" : ""}`
          : state.dirty
            ? "Unsaved changes"
            : "No layout loaded";
    this.slotLabel.title = state.readOnly
      ? "This yard can be looked at but not rearranged. Open your own yard in build mode to edit."
      : "";
    this.slotLabel.classList.toggle("planner-bar__slot--read-only", state.readOnly);

    this.summary.textContent = summarise(state);
    if (this.readOnly) return;

    this.apply.disabled = state.previewing;
    this.apply.title = state.previewing
      ? "Close the preview before applying"
      : "Write this layout to your yard";
  }

  /**
   * Rewrites the six cost cells from a selection summary.
   *
   * The breakdown by type goes into every needed cell's tooltip rather than
   * into a popover: it is a list of at most a handful of rows, it is wanted
   * while the pointer is already over the number, and a popover here would sit
   * under the bar it belongs to.
   */
  setSummary(summary: SelectionSummary): void {
    const breakdown = describeBreakdown(summary);

    for (const [key, label] of RESOURCE_LABELS) {
      const cell = this.resourceCells.get(key);
      if (!cell) continue;
      const needed = summary.needed[key];
      const held = summary.held[key];
      const short = summary.shortfall[key];
      cell.set(
        `${formatAmount(needed)} / ${formatAmount(held)}`,
        short > 0
          ? `${label}: ${needed.toLocaleString()} needed, ${held.toLocaleString()} held — ${short.toLocaleString()} short.\n${breakdown}`
          : `${label}: ${needed.toLocaleString()} needed, ${held.toLocaleString()} held.\n${breakdown}`,
        short > 0,
      );
    }

    this.timeCell.set(
      summary.seconds === 0 ? "—" : formatCountdown(summary.seconds),
      summary.seconds === 0
        ? "No worker time: nothing selected has a next level."
        : `${summary.seconds.toLocaleString()} worker seconds for the next level of everything selected.`,
    );

    this.shinyCell.set(
      summary.shiny === 0 ? "—" : formatAmount(summary.shiny),
      "What it would cost in shiny to buy every step outright. Not for sale in the planner yet.",
    );
  }

  /** Shows the count of blocking problems on the checklist button. */
  setBlocking(count: number): void {
    if (this.readOnly) return;
    this.checklist.textContent = count > 0 ? `Checklist · ${count}` : "Checklist";
    this.checklist.classList.toggle("planner-bar__checklist--bad", count > 0);
  }

  /** How many walls the selection holds, which is what Upgrade walls acts on. */
  setWallCount(count: number): void {
    if (this.readOnly) return;
    this.upgradeWalls.disabled = count === 0;
    this.upgradeWalls.title =
      count === 0
        ? "Select some walls first"
        : `Raise ${count} selected ${count === 1 ? "wall" : "walls"} to a higher level`;
  }

  /** How many fired traps are waiting to be put back. Zero disables the button. */
  setRearmCount(count: number): void {
    if (this.readOnly) return;
    this.rearmBadge.hidden = count === 0;
    this.rearmBadge.textContent = String(count);
    this.rearm.disabled = count === 0;
    this.rearm.title =
      count === 0
        ? "No fired traps to put back"
        : `Put ${count} fired ${count === 1 ? "trap" : "traps"} back where ${count === 1 ? "it" : "they"} stood`;
  }

  destroy(): void {
    this.toolbar.remove();
    this.actionBar.remove();
  }
}

/**
 * The breakdown line under every needed cell's tooltip.
 *
 * Named types rather than ids, because the player selected pictures and not
 * numbers, and the maxed count last so a selection that costs nothing still
 * says why.
 */
const describeBreakdown = (summary: SelectionSummary): string => {
  const lines = summary.byType.map(
    (row) =>
      `${row.count} × ${row.name}: ${[
        row.needed.r1 > 0 ? `${row.needed.r1.toLocaleString()} twigs` : "",
        row.needed.r2 > 0 ? `${row.needed.r2.toLocaleString()} pebbles` : "",
        row.needed.r3 > 0 ? `${row.needed.r3.toLocaleString()} putty` : "",
        row.needed.r4 > 0 ? `${row.needed.r4.toLocaleString()} goo` : "",
      ]
        .filter(Boolean)
        .join(", ") || "free"}`,
  );
  if (summary.maxed > 0) {
    lines.push(`${summary.maxed} already at the top of ${summary.maxed === 1 ? "its" : "their"} ladder`);
  }
  return lines.length > 0 ? lines.join("\n") : "Nothing selected has a next level.";
};

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
  else if (state.carrying) parts.push("in hand · click to drop, right-click to put back");
  else if (state.readOnly) parts.push("read-only · nothing here can be moved");
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
