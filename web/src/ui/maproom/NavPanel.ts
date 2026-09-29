import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import type { Bookmark } from "@/api/bookmarks";
import { outpostTitle, type OwnOutpost } from "@/game/yard/ownYards";
import { Panel } from "@/ui/Panel";

/**
 * Navigation: home, jump to a coordinate, bookmarks and a manual refresh.
 * Beside Home, one button per own outpost centres on it (outposts WP5), so
 * Home reaches any of the player's yards. Since the calm map (#176) it opens
 * from the Find button (`FindControl`) instead of sitting on the map.
 *
 * A view only. It holds no bookmark state and does no network work — it reports
 * intent and is told what to display, so the save-and-roll-back rules live in
 * one place (game/maproom/Bookmarks.ts) instead of being split across the DOM.
 */

export interface NavPanelOptions {
  onHome: () => void;
  onJump: (x: number, y: number) => void;
  onRefresh: () => void;
  /** Pulls back until the whole world is on screen. */
  onFit: () => void;
  onBookmarkJump: (bookmark: Bookmark) => void;
  onBookmarkAdd: (name: string) => void;
  onBookmarkRemove: (index: number) => void;
}

export class NavPanel {
  readonly element: HTMLElement;

  private readonly panel: Panel;
  private readonly xInput: HTMLInputElement;
  private readonly yInput: HTMLInputElement;
  private readonly nameInput: HTMLInputElement;
  private readonly addButton: HTMLButtonElement;
  private readonly list: HTMLUListElement;
  /** One button per own outpost; hidden while there are none. */
  private readonly outposts: HTMLElement;
  private readonly status: HTMLElement;
  private readonly options: NavPanelOptions;

  constructor(options: NavPanelOptions) {
    this.options = options;
    this.panel = new Panel({ title: "Find a place", closable: false, className: "map-panel" });
    this.element = this.panel.element;

    const actions = document.createElement("div");
    actions.className = "map-row";
    actions.append(
      button("Home", "Centre on your main yard", options.onHome),
      button("World", "Pull back to see the whole world", options.onFit),
      button("Refresh", "Refetch every visible zone now", options.onRefresh),
    );

    this.outposts = document.createElement("div");
    this.outposts.className = "map-row map-row--wrap";
    this.outposts.setAttribute("role", "group");
    this.outposts.setAttribute("aria-label", "Your outposts");
    this.outposts.hidden = true;

    const jump = document.createElement("form");
    jump.className = "map-row";
    this.xInput = coordInput("Jump to x", WORLD_WIDTH);
    this.yInput = coordInput("Jump to y", WORLD_HEIGHT);
    const go = document.createElement("button");
    go.type = "submit";
    go.className = "btn";
    go.textContent = "Jump";
    jump.append(this.xInput, this.yInput, go);
    jump.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitJump();
    });

    const add = document.createElement("form");
    add.className = "map-row";
    this.nameInput = document.createElement("input");
    this.nameInput.className = "map-coord-input";
    this.nameInput.maxLength = 20;
    this.nameInput.placeholder = "Bookmark name";
    this.nameInput.setAttribute("aria-label", "Bookmark name");
    this.addButton = document.createElement("button");
    this.addButton.type = "submit";
    this.addButton.className = "btn";
    this.addButton.textContent = "Add";
    this.addButton.disabled = true;
    add.append(this.nameInput, this.addButton);
    add.addEventListener("submit", (event) => {
      event.preventDefault();
      options.onBookmarkAdd(this.nameInput.value);
      this.nameInput.value = "";
    });

    this.list = document.createElement("ul");
    this.list.className = "bookmark-list";

    this.status = document.createElement("p");
    this.status.className = "map-status";
    // The frame and zone counts are for whoever is building the map (#176).
    this.status.hidden = !import.meta.env.DEV;

    this.panel.setContent(actions, this.outposts, jump, this.list, add, this.status);
  }

  /** The title bar, for the Find panel's own close button. */
  get titlebar(): HTMLElement {
    return this.panel.titlebar;
  }

  /** Puts something at the top of the panel's body: the world map. */
  prepend(node: Node): void {
    this.panel.body.prepend(node);
  }

  /** Enables the add button and names what it would bookmark. */
  setBookmarkTarget(cell: { col: number; row: number } | null, reason?: string): void {
    this.addButton.disabled = cell === null || reason !== undefined;
    this.addButton.title =
      reason ?? (cell ? `Bookmark ${cell.col}, ${cell.row}` : "Select a cell first");
    if (cell) this.nameInput.placeholder = `Name for ${cell.col}, ${cell.row}`;
  }

  setBookmarks(bookmarks: readonly Bookmark[]): void {
    this.list.replaceChildren();

    if (bookmarks.length === 0) {
      const empty = document.createElement("li");
      empty.className = "u-muted";
      empty.style.fontSize = "var(--text-sm)";
      empty.textContent = "No bookmarks yet.";
      this.list.append(empty);
      return;
    }

    bookmarks.forEach((bookmark, index) => {
      const item = document.createElement("li");
      item.className = "bookmark";

      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "btn btn--ghost bookmark__jump";
      jump.title = `Jump to ${bookmark.x}, ${bookmark.y}`;
      const label = document.createElement("span");
      label.textContent = `${bookmark.name} `;
      const coords = document.createElement("span");
      coords.className = "bookmark__coords";
      coords.textContent = `${bookmark.x},${bookmark.y}`;
      jump.append(label, coords);
      jump.addEventListener("click", () => this.options.onBookmarkJump(bookmark));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn--ghost btn--icon";
      remove.textContent = "×";
      remove.title = `Remove ${bookmark.name}`;
      remove.setAttribute("aria-label", `Remove bookmark ${bookmark.name}`);
      remove.addEventListener("click", () => this.options.onBookmarkRemove(index));

      item.append(jump, remove);
      this.list.append(item);
    });
  }

  /** The player's outposts, each a button that centres on it. */
  setOutposts(outposts: readonly OwnOutpost[]): void {
    this.outposts.hidden = outposts.length === 0;
    this.outposts.replaceChildren(
      ...outposts.map(({ cell }) =>
        button(outpostTitle(cell), `Centre on your outpost at ${cell.col}, ${cell.row}`, () =>
          this.options.onJump(cell.col, cell.row),
        ),
      ),
    );
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  destroy(): void {
    this.panel.close();
  }

  private submitJump(): void {
    const x = Number(this.xInput.value);
    const y = Number(this.yInput.value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.options.onJump(
      clampInt(x, WORLD_WIDTH),
      // The original client's y bound was 0 <= y <= mapHeight, one past the
      // last row (MapRoomPopup.as:1277-1293). Clamped properly here.
      clampInt(y, WORLD_HEIGHT),
    );
  }
}

const coordInput = (label: string, size: number): HTMLInputElement => {
  const input = document.createElement("input");
  input.className = "map-coord-input";
  input.type = "number";
  input.min = "0";
  input.max = String(size - 1);
  input.step = "1";
  input.placeholder = label.endsWith("x") ? "x" : "y";
  input.setAttribute("aria-label", label);
  return input;
};

const button = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "btn";
  element.textContent = label;
  element.title = title;
  element.addEventListener("click", onClick);
  return element;
};

const clampInt = (value: number, size: number): number =>
  Math.min(Math.max(Math.trunc(value), 0), size - 1);
