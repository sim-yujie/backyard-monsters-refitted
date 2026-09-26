import { ArtState, resolveArt, stripCrop } from "@/game/yard/buildingArt";
import type { PlanNode } from "@/game/yard/planner/placement";
import {
  categorise,
  countByKind,
  KIND_ORDER,
  kindLabel,
  searchNodes,
  type SearchCategory,
  type SearchGroup,
} from "@/game/yard/planner/search";
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
 * ## Headers, a box and chips
 *
 * Clear the yard and the drawer holds everything, which is far too long a list
 * to read end to end. So the stacks sit under their category — Towers first,
 * then Special, Resources, Traps, Walls, Decorations, Other, the order the Find
 * chips use, from {@link categorise} — each header counting the buildings under
 * it and collapsing on a click. Above them, the same search box and the same
 * kind chips the Find panel has: a player looking for their sniper towers in a
 * drawer of 575 should type "sniper", not scroll.
 *
 * Collapse is remembered across redraws. The drawer redraws after every edit,
 * and a player who folded Walls away to get at their towers should not have it
 * unfold itself the moment they take one out.
 *
 * ## Rows carry a picture
 *
 * A name is not how anyone recognises a building; the art is. Each row draws
 * the building's own top image at icon size, the same picture the yard draws,
 * so a stack is identifiable before it is read. A type the art table has no
 * row for — nothing in the shipped save, but the table is not the props file's
 * equal — falls back to a coloured swatch of its kind rather than a broken
 * image.
 *
 * ## Clicking arms the row
 *
 * A click takes the lowest id off the stack and puts it in the player's hand,
 * which is the carry a click on a placed building starts: the pointer moves it,
 * the next click on the yard drops it, a refused drop keeps it in hand and
 * Escape returns it to the drawer. Nothing places a whole stack at once —
 * where would four hundred walls go? — so the row is a source, not a command.
 *
 * But it is a source that keeps giving (#57): after a drop the session takes
 * the next building off the same stack, so a run of walls is one click on the
 * yard per wall, not a trip back to the drawer each time. The row shows as
 * pressed while it is armed, and clicking it again is how the drawer itself
 * ends the run; Escape, the secondary button, another tool or an empty stack
 * end it from elsewhere, and {@link setArmed} keeps the row honest about which.
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
  /** The armed row was clicked again: put the building in hand back. */
  onPutBack: () => void;
  onClose: () => void;
}

/** A stack, as the session names the one it is placing from. */
export interface InventoryStack {
  readonly type: number;
  readonly level: number;
}

/** One string per stack, so two stacks compare with `===`. */
const stackKey = (stack: InventoryStack): string => `${stack.type}:${stack.level}`;

/**
 * The icon's intrinsic size, matching `.planner-inventory__icon` in the CSS.
 *
 * Set on the element as well as in the sheet so the row reserves its space
 * before the picture arrives and a drawer of several hundred rows does not
 * reflow as it scrolls.
 */
const ICON_PX = 28;

export class InventoryPanel {
  readonly element: HTMLElement;

  private readonly panel: Panel;
  private readonly input: HTMLInputElement;
  private readonly chipRow: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly actions: InventoryPanelActions;

  /** Folded categories, by kind. Survives the redraw after every edit. */
  private readonly collapsed = new Set<string>();
  private readonly kinds = new Set<string>();

  private nodes: readonly PlanNode[] = [];
  private groups: SearchGroup[] = [];
  private categories: SearchCategory[] = [];
  /** The stack being placed from, as {@link stackKey}, or null. */
  private armed: string | null = null;

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

    this.input = document.createElement("input");
    this.input.type = "search";
    this.input.className = "field__input planner-search__input planner-inventory__input";
    this.input.placeholder = "Name or type id";
    this.input.setAttribute("aria-label", "Search stored buildings");
    this.input.addEventListener("input", () => this.render());

    this.chipRow = document.createElement("div");
    this.chipRow.className = "planner-search__chips";
    this.chipRow.setAttribute("role", "group");
    this.chipRow.setAttribute("aria-label", "Filter by kind");

    this.list = document.createElement("ul");
    this.list.className = "planner-search__rows planner-inventory__rows";

    this.empty = document.createElement("p");
    this.empty.className = "planner-inventory__empty u-muted";

    this.panel.setContent(this.summary, this.input, this.chipRow, this.list, this.empty);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  close(): void {
    this.panel.close();
  }

  /** Puts the caret in the box. */
  focus(): void {
    this.input.focus();
    this.input.select();
  }

  /** What the drawer is showing, for the caller and the tests. */
  get stacks(): readonly SearchGroup[] {
    return this.groups;
  }

  /** The same stacks under their headers, in category order. */
  get sections(): readonly SearchCategory[] {
    return this.categories;
  }

  /**
   * Hands the panel the plan's stored buildings.
   *
   * Called on open and again after every edit, so a stack that has just given
   * up its last building disappears rather than sitting there at zero.
   */
  setNodes(nodes: Iterable<PlanNode>): void {
    this.nodes = [...nodes];
    this.renderSummary();
    this.renderChips();
    this.render();
  }

  /**
   * Tells the drawer which stack the session is placing from, or that it has
   * stopped.
   *
   * Called from the scene on every refresh, because most of the ways a run
   * ends — Escape, a right-click, another tool, the last one placed — happen
   * nowhere near this panel. Cheap when nothing changed, which is nearly
   * always; a redraw only when the pressed row has to move.
   */
  setArmed(stack: InventoryStack | null): void {
    const key = stack ? stackKey(stack) : null;
    if (key === this.armed) return;
    this.armed = key;
    this.render();
  }

  /** The stack the drawer shows as pressed, for the tests. */
  get armedStack(): string | null {
    return this.armed;
  }

  /**
   * The count and the warning, which describe the drawer rather than the query.
   *
   * Apply is blocked by what is stored, not by what the box matches, so typing
   * in the box must not make the warning smaller than the truth.
   */
  private renderSummary(): void {
    const total = this.nodes.reduce((count, node) => count + (node.fixed ? 0 : 1), 0);
    this.summary.textContent =
      total === 0
        ? ""
        : `${total} ${total === 1 ? "building" : "buildings"} waiting. Apply is blocked until ${
            total === 1 ? "it is" : "they are"
          } placed.`;
  }

  /** One chip per kind the drawer holds, badged with how many it holds. */
  private renderChips(): void {
    const counts = countByKind(this.nodes);
    const chips: HTMLElement[] = [];

    for (const kind of KIND_ORDER) {
      const count = counts.get(kind) ?? 0;
      if (count === 0) {
        // A chip that is no longer on screen cannot be un-pressed, so a filter
        // on a kind the drawer has run out of has to let go by itself.
        this.kinds.delete(kind);
        continue;
      }

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "btn btn--ghost planner-search__chip";
      chip.dataset["kind"] = kind;
      chip.setAttribute("aria-pressed", String(this.kinds.has(kind)));
      chip.title = `Show only ${kindLabel(kind)}`;

      const label = document.createElement("span");
      label.textContent = kindLabel(kind);

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
    this.chipRow.hidden = chips.length < 2;
  }

  /** The list: what the box and the chips leave, under its headers. */
  private render(): void {
    // An empty drawer hides the box, and a hidden box must not go on filtering
    // from a query nobody can see or clear.
    const searchable = this.nodes.length > 0;
    if (!searchable) this.input.value = "";
    this.input.hidden = !searchable;

    const query = this.input.value;
    this.groups = searchNodes(this.nodes, query, this.kinds);
    this.categories = categorise(this.groups);

    this.list.replaceChildren(...this.categories.map((section) => this.renderSection(section)));
    this.renderEmpty(query);
  }

  private renderSection(section: SearchCategory): HTMLElement {
    const item = document.createElement("li");
    item.className = "planner-inventory__section";
    item.dataset["kind"] = section.kind;

    const collapsed = this.collapsed.has(section.kind);

    const header = document.createElement("button");
    header.type = "button";
    header.className = "btn btn--ghost planner-inventory__header";
    header.dataset["kind"] = section.kind;
    header.setAttribute("aria-expanded", String(!collapsed));
    header.title = collapsed ? `Show ${section.label}` : `Hide ${section.label}`;

    const caret = document.createElement("span");
    caret.className = "planner-inventory__caret";
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = collapsed ? "▸" : "▾";

    const label = document.createElement("span");
    label.className = "planner-inventory__label";
    label.textContent = section.label;

    const badge = document.createElement("span");
    badge.className = "planner-search__count";
    badge.textContent = String(section.total);

    header.append(caret, label, badge);
    header.addEventListener("click", () => {
      if (this.collapsed.has(section.kind)) this.collapsed.delete(section.kind);
      else this.collapsed.add(section.kind);
      this.render();
    });

    const rows = document.createElement("ul");
    rows.className = "planner-inventory__stack";
    rows.hidden = collapsed;
    // A folded category builds no rows at all. Walls can be four hundred of
    // them, and a fold is what a player reaches for to get them out of the
    // way; keeping them in the document hidden would keep the cost of them.
    rows.replaceChildren(
      ...(collapsed ? [] : section.groups.map((group) => this.renderRow(group))),
    );

    item.append(header, rows);
    return item;
  }

  private renderRow(group: SearchGroup): HTMLElement {
    const item = document.createElement("li");
    item.className = "planner-search__row planner-inventory__row";

    const armed = this.armed === stackKey(group);

    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "btn btn--ghost planner-search__pick planner-inventory__pick";
    pick.classList.toggle("planner-inventory__pick--armed", armed);
    pick.setAttribute("aria-pressed", String(armed));
    pick.title = armed
      ? "Placing from this stack. Click again, or press Esc, to stop"
      : group.ids.length === 1
        ? "Pick it up, then click the yard to put it down"
        : "Pick one up, then click the yard once per building. Esc stops";

    const name = document.createElement("span");
    name.className = "planner-search__name planner-inventory__name";
    name.textContent = group.name;

    const level = document.createElement("span");
    level.className = "planner-inventory__level";
    level.textContent = `L${group.level}`;

    const count = document.createElement("span");
    count.className = "planner-search__count";
    count.textContent = `× ${group.ids.length}`;

    pick.append(renderIcon(group), name, level, count);
    pick.addEventListener("click", () => {
      // A second click on the armed row is the stop, not another pick-up:
      // the building in hand is already the next one off this stack.
      if (armed) {
        this.actions.onPutBack();
        return;
      }
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

  /**
   * What to say when there is nothing to list, and the way out of it.
   *
   * An empty drawer and a query that matches nothing are different problems:
   * the first wants telling what the drawer is for, the second wants the
   * search cleared. §4.4 asks for the reason and the remedy together.
   */
  private renderEmpty(query: string): void {
    if (this.categories.length > 0) {
      this.empty.replaceChildren();
      this.empty.hidden = true;
      return;
    }

    const trimmed = query.trim();
    const message = document.createElement("span");
    const filtered = this.nodes.length > 0;
    message.textContent = !filtered
      ? "Nothing stored. Select some buildings and press Store to lift them off the yard."
      : trimmed.length > 0
        ? `No match for “${trimmed}”.`
        : "No match for the kinds you picked.";

    this.empty.replaceChildren(message);

    if (filtered) {
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
      this.empty.append(clear);
    }

    this.empty.hidden = false;
  }
}

/**
 * The row's picture.
 *
 * `resolveArt` gives the same top image the yard draws, so the icon is the
 * building rather than a symbol standing in for it. Lazy, because clearing the
 * yard opens a drawer of several hundred rows and the ones below the fold do
 * not need fetching until they are scrolled to; `object-fit: contain` because
 * the art is every shape from a one-tile block to a tall tower and a squashed
 * tower is worse than a small one.
 *
 * A type the art table has no row for gets a swatch of its kind's colour. That
 * is better than an `<img>` whose `src` is empty, which renders as a broken
 * image and pulls the row's height around.
 *
 * Four types ship no still picture and draw from an animation strip instead —
 * the Monster Bunker's `top` is a 1350 x 83 file of fifteen cells. Pointed at
 * one of those, `object-fit: contain` fits the whole strip and the row wears a
 * 28 x 2 smear, which is what "no icon" looked like. Those get a clipping box
 * around an oversized image instead; `stripCrop` has the arithmetic and the
 * reasoning.
 */
const renderIcon = (group: SearchGroup): HTMLElement => {
  const art = resolveArt(group.type, group.level, ArtState.DEFAULT);
  if (!art) {
    const swatch = document.createElement("span");
    swatch.className = "planner-inventory__icon planner-inventory__swatch";
    swatch.dataset["kind"] = group.kind;
    swatch.setAttribute("aria-hidden", "true");
    return swatch;
  }

  const icon = document.createElement("img");
  icon.src = art.top.url;
  icon.alt = group.name;
  // Set as attributes: the properties do not reflect in jsdom, and the whole
  // point is that the browser sees them before it fetches.
  icon.setAttribute("loading", "lazy");
  icon.setAttribute("decoding", "async");

  const crop = art.top.frame ? stripCrop(art.top.frame, ICON_PX) : null;
  if (!crop) {
    icon.className = "planner-inventory__icon";
    icon.width = ICON_PX;
    icon.height = ICON_PX;
    return icon;
  }

  // Styled here rather than in the stylesheet: the numbers are the cell's, and
  // a rule cannot know them.
  const box = document.createElement("span");
  box.className = "planner-inventory__icon planner-inventory__icon--strip";
  box.style.position = "relative";
  box.style.display = "inline-block";
  box.style.overflow = "hidden";
  icon.style.position = "absolute";
  icon.style.height = `${crop.height}px`;
  // Width follows the strip's own ratio, which is the trick: the file's width
  // is not known until it has loaded, and this never needs it.
  icon.style.width = "auto";
  icon.style.maxWidth = "none";
  icon.style.left = `${crop.left}px`;
  icon.style.top = `${crop.top}px`;
  box.append(icon);
  return box;
};
