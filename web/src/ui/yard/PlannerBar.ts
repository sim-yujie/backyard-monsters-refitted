import type { SelectionSummary, SelectionTypeCost } from "@/game/yard/planner/summary";
import { GroupOp, GROUP_OPS } from "@/game/yard/planner/groupTools";
import { PlannerTool, type PlannerState } from "@/game/yard/planner/PlannerSession";
import {
  wallClockSeconds,
  type ApplyPreview,
  type PlanTotals,
} from "@/game/yard/planner/upgrades";
import type { YardWorkers } from "@/game/yard/yardModel";
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
 * held", a worker time, a shiny price, a free-worker count and an unplaced
 * count, then the selection sentence. A cell whose need is past what the yard
 * holds carries `--short`, which is a colour *and* a word in the tooltip, per
 * §4.3.
 *
 * "Needed" means **the plan** once anything is planned
 * (`docs/design/planner-upgrades.md` §5.3): every step from each planned
 * building's current level to its target, which is what Apply is about to
 * charge for. With nothing planned there is no plan to add up, so the cells
 * fall back to the selection's next level — the phase 1 reading, and still the
 * useful answer to "what would one more level of these cost".
 *
 * The workers cell is a readout in both modes, because "how many jobs can I
 * even start" is a question about the yard rather than about the plan. The
 * unplaced cell is hidden at zero, which is always, until a store tool can
 * take a building out of the yard.
 *
 * Shiny is shown and never purchasable (§6, Q6), so it is a readout like the
 * rest and not a button.
 *
 * ## Read-only
 *
 * A read-only session (design §8, Q5) gets the same bars minus everything that
 * would change the yard: no undo or redo, no group operations, no Layouts, no
 * Checklist, no batch actions and no Apply, and a "Read-only" chip where the
 * slot name goes. The
 * controls are left out rather than disabled, because a row of six dead
 * buttons reads as a broken planner and a player cannot tell which of them
 * they are meant to wait for. What stays is what answers questions: the two
 * selection tools, Find, the view switch and the cost cells.
 */

export interface PlannerBarActions {
  onTool: (tool: PlannerTool) => void;
  onView: (view: YardView) => void;
  /** Mirror, align or distribute the selection (F7). */
  onGroupTool: (op: GroupOp) => void;
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

/** One row in a toolbar menu. */
interface MenuRow {
  readonly label: string;
  readonly title: string;
  readonly run: () => void;
}

/**
 * A toolbar button that drops a short list of actions under it.
 *
 * Align has six members and Distribute two, and putting eight more buttons in
 * a row that already holds nine would push the undo pair off the end of a
 * laptop screen. Written by hand rather than with `<select>` or `<details>`
 * because both of those carry a meaning this does not have: a select holds a
 * value, and a details discloses content rather than firing an action.
 *
 * It closes on a choice, on Escape and on a press anywhere else, which are the
 * three ways anyone tries to dismiss a menu. Disabling the trigger closes it
 * too: a selection can shrink below two while the list is open, and a menu of
 * dead rows is worse than no menu.
 */
class Menu {
  readonly element: HTMLElement;

  private readonly trigger: HTMLButtonElement;
  private readonly list: HTMLElement;
  private readonly dismiss: (event: Event) => void;

  constructor(label: string, title: string, rows: readonly MenuRow[]) {
    this.element = document.createElement("div");
    this.element.className = "planner-menu";

    this.trigger = button(`${label} ▾`, title);
    this.trigger.classList.add("planner-menu__trigger");
    this.trigger.setAttribute("aria-haspopup", "true");
    this.trigger.setAttribute("aria-expanded", "false");
    this.trigger.addEventListener("click", () => {
      this.toggle(this.list.hidden);
    });

    this.list = document.createElement("div");
    this.list.className = "planner-menu__list";
    this.list.setAttribute("role", "menu");
    this.list.setAttribute("aria-label", title);
    this.list.hidden = true;

    for (const row of rows) {
      const item = button(row.label, row.title, "btn btn--ghost planner-menu__item");
      item.setAttribute("role", "menuitem");
      item.addEventListener("click", () => {
        this.toggle(false);
        row.run();
      });
      this.list.append(item);
    }

    this.element.append(this.trigger, this.list);

    this.dismiss = (event: Event): void => {
      if (this.list.hidden) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        this.toggle(false);
        this.trigger.focus();
        return;
      }
      if (event.target instanceof Node && this.element.contains(event.target)) return;
      this.toggle(false);
    };
    document.addEventListener("pointerdown", this.dismiss, true);
    document.addEventListener("keydown", this.dismiss, true);
  }

  /** Whether the list can be opened at all, and why not when it cannot. */
  setEnabled(enabled: boolean, title: string): void {
    this.trigger.disabled = !enabled;
    this.trigger.title = title;
    if (!enabled) this.toggle(false);
  }

  get open(): boolean {
    return !this.list.hidden;
  }

  destroy(): void {
    document.removeEventListener("pointerdown", this.dismiss, true);
    document.removeEventListener("keydown", this.dismiss, true);
    this.element.remove();
  }

  private toggle(open: boolean): void {
    this.list.hidden = !open;
    this.trigger.setAttribute("aria-expanded", String(open));
  }
}

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
  private readonly mirrors: HTMLButtonElement[] = [];
  private readonly align: Menu;
  private readonly distribute: Menu;
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
  private readonly workersCell: CostCell;
  private readonly unplacedCell: CostCell;
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

    /* ── F7: mirror, align and distribute ───────────────────────────── */

    const groupButton = (op: GroupOp): HTMLButtonElement => {
      const info = GROUP_OPS[op];
      const element = button(info.menu, info.hint);
      element.disabled = true;
      element.addEventListener("click", () => actions.onGroupTool(op));
      return element;
    };

    const groupRow = (op: GroupOp): MenuRow => ({
      label: GROUP_OPS[op].menu,
      title: GROUP_OPS[op].hint,
      run: () => actions.onGroupTool(op),
    });

    this.mirrors.push(groupButton(GroupOp.MIRROR_X), groupButton(GroupOp.MIRROR_Y));

    this.align = new Menu("Align", "Align the selection's edges or centres", [
      groupRow(GroupOp.ALIGN_LEFT),
      groupRow(GroupOp.ALIGN_RIGHT),
      groupRow(GroupOp.ALIGN_TOP),
      groupRow(GroupOp.ALIGN_BOTTOM),
      groupRow(GroupOp.ALIGN_CENTRE_X),
      groupRow(GroupOp.ALIGN_CENTRE_Y),
    ]);
    this.distribute = new Menu("Distribute", "Space the selection evenly", [
      groupRow(GroupOp.DISTRIBUTE_X),
      groupRow(GroupOp.DISTRIBUTE_Y),
    ]);
    this.setGroupEnabled(0);

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
      // Every one of these moves buildings, so a read-only session gets none
      // of them, the same way it gets no undo and no Apply.
      ...(this.readOnly
        ? []
        : [
            group(...this.mirrors, this.align.element, this.distribute.element),
            group(this.undo, this.redo),
          ]),
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
    this.workersCell = new CostCell("Workers", "planner-cost__cell planner-cost__cell--workers");
    // Nothing can be unplaced yet (phase 1 §1.3), so the cell starts hidden and
    // the store tool turns it on rather than adding it.
    this.unplacedCell = new CostCell(
      "Unplaced",
      "planner-cost__cell planner-cost__cell--unplaced",
    );
    this.unplacedCell.element.hidden = true;
    costs.append(
      this.timeCell.element,
      this.shinyCell.element,
      this.workersCell.element,
      this.unplacedCell.element,
    );

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

    this.setGroupEnabled(state.selectionCount);

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
    const breakdown = describeBreakdown(summary.byType, summary.maxed);
    this.setResourceCells(summary.needed, summary.held, summary.shortfall, breakdown);

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

  /**
   * The same six cells, read from the plan rather than from the selection
   * (§5.3).
   *
   * `free` is what the wall-clock lower bound is divided by, and it comes from
   * the yard rather than from the totals because the plan does not know how
   * many workers are already on a job.
   */
  setPlanSummary(totals: PlanTotals, free: number): void {
    const breakdown = describeBreakdown(totals.byType, 0);
    this.setResourceCells(totals.needed, totals.held, totals.shortfall, breakdown);

    const clock = wallClockSeconds(totals, free);
    this.timeCell.set(
      totals.seconds === 0 ? "—" : formatCountdown(totals.seconds),
      totals.seconds === 0
        ? "No worker time: nothing is planned."
        : `${totals.seconds.toLocaleString()} worker seconds over ${totals.steps} ${totals.steps === 1 ? "step" : "steps"}.\nAt least ${formatCountdown(clock)} of real time with ${free} free ${free === 1 ? "worker" : "workers"} — a lower bound, because jobs do not parallelise perfectly and one building takes one step at a time.`,
    );

    this.shinyCell.set(
      totals.shiny === 0 ? "—" : formatAmount(totals.shiny),
      "What it would cost in shiny to buy every planned step outright. Not for sale in the planner yet.",
    );
  }

  /**
   * The free-worker readout, and what Apply would do with them.
   *
   * The preview is the same walk Apply runs (§5.5), so the tooltip promises
   * what the dialog will itemise and the server will then report.
   */
  setWorkers(workers: YardWorkers, preview: ApplyPreview | null): void {
    const free = Math.max(0, workers.total - workers.busy);
    const tail = preview
      ? `\n${preview.started.length} would start on Apply, ${preview.waiting.length} would wait for a worker, ${preview.finished.length} would finish instantly.`
      : "";
    this.workersCell.set(
      `${free} free / ${workers.total}`,
      `${workers.busy} of ${workers.total} ${workers.total === 1 ? "worker is" : "workers are"} already on a job.${tail}`,
      preview !== null && preview.waiting.length > 0,
    );
  }

  /**
   * How many buildings are in the plan but nowhere on the plot.
   *
   * Zero today and hidden at zero, because nothing can be taken out of the
   * yard yet; Apply is hard-blocked while it is not zero (§8, Q4), so the cell
   * exists to say *why* the moment a store tool can make it happen.
   */
  setUnplaced(count: number): void {
    this.unplacedCell.element.hidden = count === 0;
    this.unplacedCell.set(
      String(count),
      count === 0
        ? "Every building has a place."
        : `${count} ${count === 1 ? "building has" : "buildings have"} nowhere to go. Apply is blocked until ${count === 1 ? "it does" : "they do"}.`,
      count > 0,
    );
  }

  /** The four resource cells, from whichever reading of "needed" is current. */
  private setResourceCells(
    needed: SelectionSummary["needed"],
    held: SelectionSummary["held"],
    shortfall: SelectionSummary["shortfall"],
    breakdown: string,
  ): void {
    for (const [key, label] of RESOURCE_LABELS) {
      const cell = this.resourceCells.get(key);
      if (!cell) continue;
      const short = shortfall[key];
      cell.set(
        `${formatAmount(needed[key])} / ${formatAmount(held[key])}`,
        short > 0
          ? `${label}: ${needed[key].toLocaleString()} needed, ${held[key].toLocaleString()} held — ${short.toLocaleString()} short.\n${breakdown}`
          : `${label}: ${needed[key].toLocaleString()} needed, ${held[key].toLocaleString()} held.\n${breakdown}`,
        short > 0,
      );
    }
  }

  /**
   * Lights the group operations up for a selection of `count` buildings.
   *
   * Each control asks for the minimum its own geometry needs rather than one
   * number for all of them: mirroring or aligning one building about its own
   * centre is the identity, and distributing holds the outermost two still, so
   * it has nothing to space until there is a third between them. A button that
   * is off says what would turn it on, because that is the question a player
   * with one tower selected is actually asking.
   */
  setGroupEnabled(selected: number): void {
    // A read-only session never mounts these, and they stay inert as well as
    // absent so a caller holding one cannot fire it (§8, Q5).
    const count = this.readOnly ? 0 : selected;

    for (const element of this.mirrors) {
      element.disabled = count < 2;
      if (count < 2) element.title = "Select two or more buildings to mirror";
    }
    if (count >= 2) {
      const [horizontal, vertical] = this.mirrors;
      if (horizontal) horizontal.title = GROUP_OPS[GroupOp.MIRROR_X].hint;
      if (vertical) vertical.title = GROUP_OPS[GroupOp.MIRROR_Y].hint;
    }

    this.align.setEnabled(
      count >= 2,
      count >= 2
        ? "Align the selection's edges or centres"
        : "Select two or more buildings to align",
    );
    this.distribute.setEnabled(
      count >= 3,
      count >= 3
        ? "Space the selection evenly"
        : "Select three or more buildings to space out evenly",
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
    // The menus listen on the document, so dropping the bar is not enough.
    this.align.destroy();
    this.distribute.destroy();
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
const describeBreakdown = (
  byType: readonly SelectionTypeCost[],
  maxed: number,
): string => {
  const lines = byType.map(
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
  if (maxed > 0) {
    lines.push(`${maxed} already at the top of ${maxed === 1 ? "its" : "their"} ladder`);
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
  // Left out at zero: an untouched plan should not carry a count of nothing.
  if (state.plannedCount > 0) parts.push(`${state.plannedCount} planned`);
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
