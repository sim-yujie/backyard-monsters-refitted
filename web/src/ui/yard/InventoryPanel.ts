import type { PlanNode } from "@/game/yard/planner/placement";
import { searchNodes, type SearchGroup } from "@/game/yard/planner/search";
import { Panel } from "@/ui/Panel";

/**
 * The drawer: what the planner is holding off the yard (issue #50).
 *
 * Storing is how a full yard gets rearranged at all. Every move has to land
 * legally, so shuffling 575 buildings around each other is a puzzle with no
 * free squares; lifting a run of walls out of the way turns it back into a
 * layout job. This panel is where the lifted buildings wait.
 *
 * ## Rows are stacks, not buildings
 *
 * One row per type *and* level, carrying every id: "Block L1 × 400". The Find
 * panel groups the same way and for the same reason — four hundred rows would
 * be unreadable and nobody wants one wall, they want the run — so both read the
 * same {@link searchNodes}, and a stack here looks exactly like a stack there.
 *
 * ## Clicking places one
 *
 * A click takes the lowest id off the stack and puts it in the player's hand,
 * which is the carry a click on a placed building starts: the pointer moves it,
 * the next click on the yard drops it, a refused drop keeps it in hand and
 * Escape returns it to the drawer. Nothing places a whole stack at once —
 * where would four hundred walls go? — so the row is a source, not a command.
 *
 * The panel stays docked while the player works and redraws from
 * {@link setNodes} after every edit, so the stack it just handed a building
 * from loses one from its count under the pointer.
 */

export interface InventoryPanelActions {
  /**
   * Take this building out of the drawer and carry it.
   *
   * Returns false when it could not be picked up, which the panel reports
   * rather than swallowing: a read-only session is the only way that happens
   * and it should not look like a dead button.
   */
  onPlace: (id: number) => boolean;
  onClose: () => void;
}

export class InventoryPanel {
  readonly element: HTMLElement;

  private readonly panel: Panel;
  private readonly summary: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly actions: InventoryPanelActions;

  private groups: SearchGroup[] = [];

  constructor(actions: InventoryPanelActions) {
    this.actions = actions;
    this.panel = new Panel({
      title: "Stored buildings",
      className: "map-panel planner-inventory",
      onClose: actions.onClose,
    });
    this.element = this.panel.element;

    this.summary = document.createElement("p");
    this.summary.className = "planner-inventory__summary u-muted";

    this.list = document.createElement("ul");
    this.list.className = "planner-search__rows planner-inventory__rows";

    this.empty = document.createElement("p");
    this.empty.className = "planner-inventory__empty u-muted";
    this.empty.textContent =
      "The drawer is empty. Select some buildings and press Store to lift them off the yard.";

    this.panel.setContent(this.summary, this.list, this.empty);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  close(): void {
    this.panel.close();
  }

  /** What the drawer is showing, for the caller and the tests. */
  get stacks(): readonly SearchGroup[] {
    return this.groups;
  }

  /**
   * Hands the panel the plan's stored buildings.
   *
   * Called on open and again after every edit, so a stack that has just given
   * up its last building disappears rather than sitting there at zero.
   */
  setNodes(nodes: Iterable<PlanNode>): void {
    // An empty query and no kind filter: this is the whole drawer, stacked.
    this.groups = searchNodes(nodes, "", new Set());

    const total = this.groups.reduce((count, group) => count + group.ids.length, 0);
    this.summary.textContent =
      total === 0
        ? ""
        : `${total} ${total === 1 ? "building" : "buildings"} waiting. Apply is blocked until ${
            total === 1 ? "it is" : "they are"
          } placed.`;

    this.list.replaceChildren(...this.groups.map((group) => this.renderRow(group)));
    this.empty.hidden = total > 0;
  }

  private renderRow(group: SearchGroup): HTMLElement {
    const item = document.createElement("li");
    item.className = "planner-search__row planner-inventory__row";

    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "btn btn--ghost planner-search__pick";
    pick.title =
      group.ids.length === 1
        ? "Pick it up, then click the yard to put it down"
        : "Pick one up, then click the yard to put it down";

    const name = document.createElement("span");
    name.className = "planner-search__name";
    name.textContent = `${group.name} L${group.level}`;

    const count = document.createElement("span");
    count.className = "planner-search__count";
    count.textContent = `× ${group.ids.length}`;

    pick.append(name, count);
    pick.addEventListener("click", () => {
      // The lowest id, which is the order the rows themselves are in: taking
      // them off a stack in a stable order is what makes a run of walls come
      // back out in the order it went in.
      const first = group.ids[0];
      if (first === undefined) return;
      this.actions.onPlace(first);
    });

    item.append(pick);
    return item;
  }
}
