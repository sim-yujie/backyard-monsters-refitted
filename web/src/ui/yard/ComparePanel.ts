import type { LayoutDiff, StatRow } from "@/game/yard/planner/compare";
import { STACK_BELOW } from "@/game/yard/CompareView";
import { percentText } from "@/game/yard/planner/coverage";
import { formatCompact, formatCountdown } from "@/ui/format";
import { Panel } from "@/ui/Panel";

/**
 * The compare panel (issue #9, design F12): the plan against one saved
 * layout, figure by figure, with the better one in green and a ▲, the
 * differences counted, and the two ways out.
 *
 * Read-only: the panel changes nothing. Close goes back to the plan as it
 * was; Load this layout hands the slot to the planner's own Load, which is
 * one undoable step like any other load.
 */

/** Where the panes stack (`CompareView.STACK_BELOW`) and the card folds its figures. */
const narrow = (): boolean =>
  typeof window !== "undefined" && window.matchMedia?.(`(width < ${STACK_BELOW}px)`).matches === true;

export interface ComparePanelOptions {
  /** "Slot 3: Ring of snipers". */
  readonly slotName: string;
  readonly rows: readonly StatRow[];
  readonly diff: LayoutDiff;
  readonly onLoad: () => void;
  readonly onClose: () => void;
}

/** A row's figure as the table prints it. */
export const statText = (key: string, value: number): string => {
  switch (key) {
    case "land":
    case "air":
      return percentText(value);
    case "cost":
      return value === 0 ? "—" : formatCompact(value);
    case "seconds":
      return value === 0 ? "—" : formatCountdown(value);
    default:
      return String(value);
  }
};

/** "3 moved · 2 only in your plan · 1 only in the layout". */
export const diffText = (diff: LayoutDiff): string => {
  const parts = [`${diff.moved.size} moved`];
  if (diff.onlyPlan.size > 0) parts.push(`${diff.onlyPlan.size} only in your plan`);
  if (diff.onlySlot.size > 0) parts.push(`${diff.onlySlot.size} only in the layout`);
  return parts.join(" · ");
};

export class ComparePanel {
  readonly element: HTMLElement;

  private readonly panel: Panel;
  /** Folds the figures when the window narrows to a stacked split, and back. */
  private readonly media: MediaQueryList | null;
  private readonly onMedia: () => void;

  constructor(options: ComparePanelOptions) {
    this.panel = new Panel({
      title: `Compare with ${options.slotName}`,
      className: "map-panel planner-compare",
      onClose: options.onClose,
    });
    this.element = this.panel.element;
    this.element.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      options.onClose();
    });

    const table = document.createElement("table");
    table.className = "planner-compare__table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const text of ["", "Your plan", "Layout"]) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = text;
      headRow.append(cell);
    }
    head.append(headRow);
    const body = document.createElement("tbody");
    for (const row of options.rows) {
      const line = document.createElement("tr");
      line.dataset["row"] = row.key;
      const name = document.createElement("th");
      name.scope = "row";
      name.textContent = row.label;
      line.append(name, this.figure(row, "plan"), this.figure(row, "slot"));
      body.append(line);
    }
    table.append(head, body);

    const diff = document.createElement("p");
    diff.className = "planner-compare__diff";
    const moved = document.createElement("span");
    moved.className = "planner-compare__key planner-compare__key--moved";
    const only = document.createElement("span");
    only.className = "planner-compare__key planner-compare__key--only";
    diff.append(diffText(options.diff));
    const legend = document.createElement("p");
    legend.className = "planner-compare__legend u-muted";
    legend.append(moved, " moved", only, " on one side only");

    const actions = document.createElement("div");
    actions.className = "planner-compare__actions";
    const load = document.createElement("button");
    load.type = "button";
    load.className = "btn btn--primary planner-compare__load";
    load.textContent = "Load this layout";
    load.title = "Put your yard in this layout's arrangement. Ctrl+Z undoes it; nothing is saved until Apply.";
    load.addEventListener("click", options.onLoad);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn btn--ghost planner-compare__close";
    close.textContent = "Close";
    close.addEventListener("click", options.onClose);
    actions.append(load, close);

    // On a phone the two panes are stacked and the card covers the lower
    // one, so the figures start folded and the panes stay in view.
    const figures = document.createElement("details");
    figures.className = "planner-compare__figures";
    figures.open = !narrow();
    const summary = document.createElement("summary");
    summary.textContent = "Figures";
    figures.append(summary, table);
    this.media =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia(`(width < ${STACK_BELOW}px)`)
        : null;
    this.onMedia = () => {
      figures.open = !narrow();
    };
    this.media?.addEventListener("change", this.onMedia);

    this.panel.setContent(figures, diff, legend, actions);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  focus(): void {
    this.element.querySelector<HTMLElement>(".planner-compare__close")?.focus();
  }

  destroy(): void {
    this.media?.removeEventListener("change", this.onMedia);
    this.element.remove();
  }

  /** One side's figure; the better side's in green with a ▲ (colour is never the only mark). */
  private figure(row: StatRow, side: "plan" | "slot"): HTMLElement {
    const cell = document.createElement("td");
    cell.className = "planner-compare__figure";
    const text = statText(row.key, row[side]);
    if (row.better === side) {
      cell.classList.add("planner-compare__figure--better");
      const mark = document.createElement("span");
      mark.className = "planner-compare__mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = "▲";
      const words = document.createElement("span");
      words.className = "u-visually-hidden";
      words.textContent = " (better)";
      cell.append(mark, " ", text, words);
    } else {
      cell.textContent = text;
    }
    return cell;
  }
}
