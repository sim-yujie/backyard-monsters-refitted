import type { PlanNode } from "@/game/yard/planner/placement";
import { countByKind, searchNodes, OTHER_KIND, type SearchGroup } from "@/game/yard/planner/search";
import { Panel } from "@/ui/Panel";

/**
 * F16: search over the buildings standing in the yard.
 *
 * This finds rather than stocks. What the store tool has lifted off the yard
 * is in the drawer next door (`InventoryPanel.ts`), which stacks its rows with
 * the same {@link searchNodes}; this panel lists only what is placed, because
 * a row here selects buildings and frames the camera on them, and neither
 * means anything for a building that is nowhere.
 *
 * It is still the thing the feature was for: picking the 400 walls out of 575
 * buildings without hunting for them, which is exactly what the batch wall
 * upgrade needs to select against.
 *
 * ## Rows are stacks
 *
 * One row per type *and level*, carrying every id: "Block L1 × 400". Four
 * hundred rows would be unreadable and slow, and a player who searches for
 * walls wants all of them, not one.
 *
 * ## The chips count the yard, not the query
 *
 * A chip's badge is how many of that kind the yard holds. It does not move as
 * the query is typed, because a badge that did would be reporting on the query
 * — which the list already does — instead of on the yard.
 *
 * The panel stays docked while the player works: clicking a row selects and
 * frames without closing, so several groups can be tried in a row.
 */

export interface SearchPanelActions {
  /** Selects these buildings and puts the camera on the first. */
  onSelect: (ids: number[]) => void;
  onClose: () => void;
}

/**
 * Chip order: the categories a player reaches for first, then the ones they
 * sort out afterwards. `other` is last and only appears when something lands
 * in it.
 */
const KIND_ORDER: readonly string[] = [
  "tower",
  "special",
  "resource",
  "trap",
  "wall",
  "decoration",
  OTHER_KIND,
];

const KIND_LABELS: Readonly<Record<string, string>> = {
  tower: "Towers",
  special: "Special",
  resource: "Resources",
  trap: "Traps",
  wall: "Walls",
  decoration: "Decorations",
  [OTHER_KIND]: "Other",
};

export class SearchPanel {
  readonly element: HTMLElement;

  private readonly panel: Panel;
  private readonly input: HTMLInputElement;
  private readonly chipRow: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly actions: SearchPanelActions;

  private readonly kinds = new Set<string>();
  private nodes: readonly PlanNode[] = [];
  private groups: SearchGroup[] = [];

  constructor(actions: SearchPanelActions) {
    this.actions = actions;
    this.panel = new Panel({
      title: "Find buildings",
      className: "map-panel planner-search",
      onClose: actions.onClose,
    });
    this.element = this.panel.element;

    this.input = document.createElement("input");
    this.input.type = "search";
    this.input.className = "field__input planner-search__input";
    this.input.placeholder = "Name or type id";
    this.input.setAttribute("aria-label", "Search placed buildings");
    this.input.addEventListener("input", () => this.render());
    this.input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.selectAllMatches();
    });

    this.chipRow = document.createElement("div");
    this.chipRow.className = "planner-search__chips";
    this.chipRow.setAttribute("role", "group");
    this.chipRow.setAttribute("aria-label", "Filter by kind");

    this.list = document.createElement("ul");
    this.list.className = "planner-search__rows";

    this.empty = document.createElement("p");
    this.empty.className = "planner-search__empty u-muted";
    this.empty.hidden = true;

    // The empty state is not in the body until there is something to say; see
    // `render` for why it is added and removed rather than hidden.
    this.panel.setContent(this.input, this.chipRow, this.list);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  close(): void {
    this.panel.close();
  }

  /** Puts the caret in the box, which is where F should leave it. */
  focus(): void {
    this.input.focus();
    this.input.select();
  }

  /**
   * Hands the panel the plan's buildings.
   *
   * Called on open and again after anything that changes the yard under it, so
   * a re-armed trap shows up in the trap chip's count without the panel being
   * reopened.
   */
  setNodes(nodes: Iterable<PlanNode>): void {
    this.nodes = [...nodes];
    this.renderChips();
    this.render();
  }

  /** What the box currently matches, for the caller and the tests. */
  get matches(): readonly SearchGroup[] {
    return this.groups;
  }

  private renderChips(): void {
    const counts = countByKind(this.nodes);
    const chips: HTMLElement[] = [];

    for (const kind of KIND_ORDER) {
      const count = counts.get(kind) ?? 0;
      if (count === 0) continue;

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "btn btn--ghost planner-search__chip";
      chip.dataset["kind"] = kind;
      chip.setAttribute("aria-pressed", String(this.kinds.has(kind)));
      chip.title = `Show only ${KIND_LABELS[kind] ?? kind}`;

      const label = document.createElement("span");
      label.textContent = KIND_LABELS[kind] ?? kind;

      const badge = document.createElement("span");
      badge.className = "planner-search__count";
      badge.textContent = String(count);

      chip.append(label, badge);
      chip.addEventListener("click", () => {
        if (this.kinds.has(kind)) this.kinds.delete(kind);
        else this.kinds.add(kind);
        chip.setAttribute("aria-pressed", String(this.kinds.has(kind)));
        this.render();
      });

      chips.push(chip);
    }

    this.chipRow.replaceChildren(...chips);
  }

  private render(): void {
    const query = this.input.value;
    this.groups = searchNodes(this.nodes, query, this.kinds);

    const rows = this.groups.map((group) => this.renderRow(group));
    this.list.replaceChildren(...rows);

    // Taken out of the document rather than hidden. The class sets
    // `display: flex`, which beats the `hidden` attribute's `display: none`, so
    // a hidden-but-present message goes on showing "No buildings match …" over
    // a list that has started matching again. Removing it also takes its margin
    // with it, which a hidden element would have left behind.
    if (this.groups.length === 0) {
      this.renderEmpty(query);
      this.empty.hidden = false;
      if (!this.empty.parentNode) this.list.after(this.empty);
    } else {
      this.empty.replaceChildren();
      this.empty.hidden = true;
      this.empty.remove();
    }
  }

  private renderRow(group: SearchGroup): HTMLElement {
    const item = document.createElement("li");
    item.className = "planner-search__row";

    const link = document.createElement("button");
    link.type = "button";
    link.className = "btn btn--ghost planner-search__pick";
    link.title = `Select ${group.ids.length === 1 ? "it" : "all of them"} and show me`;

    const name = document.createElement("span");
    name.className = "planner-search__name";
    name.textContent = `${group.name} L${group.level}`;

    const count = document.createElement("span");
    count.className = "planner-search__count";
    count.textContent = `× ${group.ids.length}`;

    link.append(name, count);
    link.addEventListener("click", () => this.actions.onSelect([...group.ids]));

    item.append(link);
    return item;
  }

  /**
   * The empty state, with the way out of it.
   *
   * §4.4 asks for the reason and the remedy in the same place, so the message
   * names whichever filter is doing the excluding and the link clears both.
   */
  private renderEmpty(query: string): void {
    const trimmed = query.trim();
    const message = document.createElement("span");
    message.textContent =
      this.nodes.length === 0
        ? "This yard has nothing to find."
        : trimmed.length > 0
          ? `No buildings match “${trimmed}”.`
          : "No buildings match the kinds you picked.";

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "btn btn--ghost planner-search__clear";
    clear.textContent = "Clear search";
    clear.addEventListener("click", () => {
      this.input.value = "";
      this.kinds.clear();
      this.renderChips();
      this.render();
      this.focus();
    });

    this.empty.replaceChildren(message, clear);
  }

  /** Enter: everything the box matches, in one selection. */
  private selectAllMatches(): void {
    const ids = this.groups.flatMap((group) => [...group.ids]);
    if (ids.length === 0) return;
    this.actions.onSelect(ids);
  }
}
