import {
  INFERNO_MAP_ART,
  INFERNO_MAP_SIZE,
  TRIBE_PORTRAIT,
  TribeSort,
  TribeState,
  respawnDue,
  respawnText,
  sortTribeRows,
  type TribeRow,
} from "@/game/inferno/tribeMap";
import { Popup } from "@/ui/Popup";
import "@/ui/styles/inferno.css";

/**
 * The Inferno map (WP 2.9, `docs/design/inferno.md` §2.7, §3.2): what the Map
 * button opens on the Inferno yard (`MAPROOM_INFERNO.Show`, `maproom_inferno/
 * MapRoom.as`). Flash's Map / List buttons over one view at a time: the map
 * (`views/MapView.as`), Flash's own 1600 x 1200 picture with Moloch's seven
 * tribes on it, a tap on one opening its card with Attack
 * (`WildMonsterBase.as`, `MapBasePopup`); and the list (`views/ListView.as`,
 * `WMListViewItem.as`), a row per tribe with its own Attack. A phone opens on
 * the list (pins are small to tap), a desktop on the map, as Flash did; the
 * view chosen is kept for the session (Flash's `mrlv`).
 *
 * Flash hid a wrecked tribe until it came back (`PlayerLayer.as:136`); here it
 * stays, dark, with its countdown, as Map Room 1's do. Flash's View button
 * looked at the tribe's yard first; no route serves that look, so it is left
 * out, as on the Descent map. Flash's minimap and drag are the map's own
 * scrolling. The tribe markers and the card are stand-ins until the Inferno
 * map art (A3) is approved. The real players of the Inferno map (PvP, WP 3.5)
 * go into this screen beside the tribes: the list's section and the map's
 * markers take a second kind of row.
 */

export type InfernoMapView = "map" | "list";

export interface InfernoMapActions {
  /** Attack on a tribe. Resolves once the attack scene opens or the start failed. */
  readonly attack: (row: TribeRow) => Promise<void> | void;
  /** Ask the server for the tribes again: a wrecked tribe's time is up. */
  readonly refresh: () => void;
  /** The server's clock, unix seconds. */
  readonly now: () => number;
  readonly onClose?: () => void;
}

const PHONE_QUERY = "(width <= 620px)";

const isPhone = (): boolean =>
  typeof window !== "undefined" && window.matchMedia?.(PHONE_QUERY).matches === true;

/** The view the screen last showed, for the session. */
let lastView: InfernoMapView | null = null;
/** The list's order, for the session (Flash's `mrls`, `mrlsr`). */
let lastSort: { sort: TribeSort; reversed: boolean } = { sort: TribeSort.DEFAULT, reversed: false };

/** Forgets the remembered view and order, for tests. */
export const resetInfernoMapScreen = (): void => {
  lastView = null;
  lastSort = { sort: TribeSort.DEFAULT, reversed: false };
};

export const INFERNO_MAP_TITLE = "Inferno Map";
const RETURN_HOME = "Return Home";
const ATTACK = "Attack";

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const button = (label: string, className: string, onClick: () => void): HTMLButtonElement => {
  const node = element("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
};

const portrait = (className: string): HTMLImageElement => {
  const image = element("img", className);
  image.src = TRIBE_PORTRAIT;
  image.alt = "";
  image.decoding = "async";
  return image;
};

const percentOf = (value: number, of: number): string => `${+((value / of) * 100).toFixed(3)}%`;

/** A marker's spoken name: the list name, and the countdown while wrecked. */
const markerLabel = (row: TribeRow, now: number): string =>
  row.state === TribeState.DESTROYED ? `${row.listName}, wrecked, ${respawnText(row, now)}` : row.listName;

export class InfernoMapScreen {
  readonly popup: Popup;

  private readonly mapButton: HTMLButtonElement;
  private readonly listButton: HTMLButtonElement;
  private readonly mapPane: HTMLElement;
  private readonly map: HTMLElement;
  private readonly listPane: HTMLElement;
  private readonly sortButton: HTMLButtonElement;
  private readonly rowsBox: HTMLElement;
  private readonly status: HTMLElement;

  private view: InfernoMapView;
  private rows: readonly TribeRow[] = [];
  private selected: string | null = null;
  private card: HTMLElement | null = null;
  private busy = false;
  private refreshAsked = false;
  private centred = false;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    host: HTMLElement,
    private readonly actions: InfernoMapActions,
  ) {
    this.view = lastView ?? (isPhone() ? "list" : "map");
    this.popup = new Popup({
      title: INFERNO_MAP_TITLE,
      className: "inferno-popup inferno-map",
      onClose: () => {
        clearInterval(this.timer);
        actions.onClose?.();
      },
    });

    // Flash's Map / List buttons (`map_map_btn`, `map_list_btn`).
    const toggle = element("div", "inferno-map__toggle");
    toggle.setAttribute("role", "group");
    toggle.setAttribute("aria-label", "Show as");
    this.mapButton = button("Map", "inferno-map__toggle-button", () => this.setView("map"));
    this.listButton = button("List", "inferno-map__toggle-button", () => this.setView("list"));
    toggle.append(this.mapButton, this.listButton);

    this.mapPane = element("div", "inferno-map__scroll");
    this.map = element("div", "inferno-map__map");
    this.map.style.aspectRatio = `${INFERNO_MAP_SIZE.width} / ${INFERNO_MAP_SIZE.height}`;
    const art = element("img", "inferno-map__art");
    art.src = INFERNO_MAP_ART;
    art.alt = "";
    art.decoding = "async";
    this.map.append(art);
    this.mapPane.append(this.map);
    // A tap on the map itself puts the card away, as Flash's did on a press elsewhere.
    this.map.addEventListener("click", (event) => {
      if (event.target === this.map || event.target === art) this.select(null);
    });

    this.listPane = element("section", "inferno-map__list");
    this.listPane.setAttribute("aria-labelledby", "inferno-map-tribes");
    const head = element("div", "inferno-map__list-head");
    const heading = element("h2", "inferno-map__heading", "Moloch's tribes");
    heading.id = "inferno-map-tribes";
    // Flash's Level column; its other columns part no tribes (`tribeMap.ts`, `TribeSort`).
    this.sortButton = button("Level", "btn inferno-map__sort", () => this.toggleSort());
    head.append(heading, this.sortButton);
    this.rowsBox = element("div", "inferno-map__rows");
    this.listPane.append(head, this.rowsBox);

    this.status = element("p", "inferno-map__status", "Loading the Inferno map…");

    const body = element("div", "inferno-map__body");
    body.append(this.mapPane, this.listPane, this.status);

    const footer = element("div", "inferno-popup__actions");
    footer.append(button(RETURN_HOME, "btn", () => this.popup.close()));
    this.popup.setContent(toggle, body, footer);
    this.popup.mount(host);
    this.applyView();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  private now(): number {
    return this.actions.now();
  }

  /** Shows "Loading…" or a failure in place of the views, or clears it. */
  setStatus(text: string | null): void {
    this.status.textContent = text ?? "";
    this.status.hidden = text === null;
  }

  /** The tribes, as rows made at the server's clock now. */
  setData(rows: readonly TribeRow[]): void {
    this.rows = rows;
    this.refreshAsked = false;
    this.setStatus(rows.length === 0 ? "No tribes face your Inferno yard right now." : null);
    if (this.selected && !rows.some((row) => row.baseid === this.selected)) this.selected = null;
    this.render();
  }

  /** Lets Attack be pressed again, after a start that failed. */
  enableAttack(): void {
    this.busy = false;
    for (const go of this.popup.element.querySelectorAll<HTMLButtonElement>("[data-attack]")) {
      go.disabled = go.dataset["wrecked"] === "1";
    }
  }

  close(): void {
    this.popup.close();
  }

  /** Once a second: the countdowns, and the map asked again once a tribe is back. */
  private tick(): void {
    if (!this.popup.element.isConnected) {
      clearInterval(this.timer);
      return;
    }
    const now = this.now();
    for (const span of this.popup.element.querySelectorAll<HTMLElement>("[data-respawn]")) {
      const row = this.rows.find((one) => one.baseid === span.dataset["respawn"]);
      if (!row) continue;
      span.textContent = respawnText(row, now);
      span.closest(".inferno-tribe")?.setAttribute("aria-label", markerLabel(row, now));
    }
    if (!this.refreshAsked && respawnDue(this.rows, now)) {
      this.refreshAsked = true;
      this.actions.refresh();
    }
  }

  private setView(view: InfernoMapView): void {
    if (view === this.view) return;
    this.view = view;
    lastView = view;
    this.select(null);
    this.applyView();
  }

  private applyView(): void {
    const onMap = this.view === "map";
    this.mapPane.hidden = !onMap;
    this.listPane.hidden = onMap;
    this.mapButton.setAttribute("aria-pressed", String(onMap));
    this.listButton.setAttribute("aria-pressed", String(!onMap));
    if (onMap) this.centre();
  }

  /** The map opens on its middle (`MapView.scrollTo(0.5, 0.5)`). */
  private centre(): void {
    if (this.centred) return;
    requestAnimationFrame(() => {
      const pane = this.mapPane;
      if (pane.hidden || pane.clientWidth === 0) return;
      pane.scrollLeft = Math.max(0, (pane.scrollWidth - pane.clientWidth) / 2);
      pane.scrollTop = Math.max(0, (pane.scrollHeight - pane.clientHeight) / 2);
      this.centred = true;
    });
  }

  /** Level highest first, lowest first on the next press, back to the opening order on the third. */
  private toggleSort(): void {
    if (lastSort.sort !== TribeSort.LEVEL) lastSort = { sort: TribeSort.LEVEL, reversed: false };
    else if (!lastSort.reversed) lastSort = { sort: TribeSort.LEVEL, reversed: true };
    else lastSort = { sort: TribeSort.DEFAULT, reversed: false };
    this.renderList();
  }

  private render(): void {
    this.renderMap();
    this.renderList();
  }

  private renderMap(): void {
    for (const old of this.map.querySelectorAll(".inferno-tribe, .inferno-card")) old.remove();
    this.card = null;
    const now = this.now();
    for (const row of this.rows) {
      const wrecked = row.state === TribeState.DESTROYED;
      const marker = element("button", `inferno-tribe${wrecked ? " inferno-tribe--wrecked" : ""}`);
      marker.type = "button";
      marker.dataset["baseid"] = row.baseid;
      marker.style.left = percentOf(row.spot.x, INFERNO_MAP_SIZE.width);
      marker.style.top = percentOf(row.spot.y, INFERNO_MAP_SIZE.height);
      marker.setAttribute("aria-label", markerLabel(row, now));
      const frame = element("span", "inferno-tribe__frame");
      frame.append(portrait("inferno-tribe__portrait"), element("span", "inferno-tribe__level", String(row.level)));
      marker.append(frame, element("span", "inferno-tribe__name", row.name));
      if (wrecked) {
        const back = element("span", "inferno-tribe__back", respawnText(row, now));
        back.dataset["respawn"] = row.baseid;
        marker.append(back);
      }
      marker.addEventListener("click", () => this.select(this.selected === row.baseid ? null : row.baseid));
      this.map.append(marker);
    }
    if (this.selected) this.openCard(this.selected);
  }

  private select(baseid: string | null): void {
    this.selected = baseid;
    this.card?.remove();
    this.card = null;
    for (const marker of this.map.querySelectorAll<HTMLElement>(".inferno-tribe")) {
      marker.setAttribute("aria-expanded", String(marker.dataset["baseid"] === baseid));
    }
    if (baseid && this.view === "map") this.openCard(baseid);
  }

  /** The tribe's card beside its marker (`MapBasePopup`): its name, its state, Attack. */
  private openCard(baseid: string): void {
    const row = this.rows.find((one) => one.baseid === baseid);
    if (!row) return;
    const wrecked = row.state === TribeState.DESTROYED;
    const card = element("div", "inferno-card");
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", row.listName);
    card.append(element("p", "inferno-card__name", row.listName));
    if (wrecked) {
      const back = element("p", "inferno-card__back", respawnText(row, this.now()));
      back.dataset["respawn"] = row.baseid;
      card.append(back);
    }
    card.append(this.attackButton(row, "btn btn--primary inferno-card__attack"));
    card.style.left = percentOf(row.spot.x, INFERNO_MAP_SIZE.width);
    card.style.top = percentOf(row.spot.y, INFERNO_MAP_SIZE.height);
    if (row.spot.x > INFERNO_MAP_SIZE.width / 2) card.classList.add("inferno-card--left");
    if (row.spot.y > INFERNO_MAP_SIZE.height / 2) card.classList.add("inferno-card--up");
    this.map.append(card);
    this.card = card;
    // A marker near the pane's edge would leave its card cut off on a phone.
    card.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  /** Attack, off while the tribe lies wrecked or a start is on its way. */
  private attackButton(row: TribeRow, className: string): HTMLButtonElement {
    const wrecked = row.state === TribeState.DESTROYED;
    const go = button(ATTACK, className, () => {
      if (this.busy) return;
      this.busy = true;
      for (const other of this.popup.element.querySelectorAll<HTMLButtonElement>("[data-attack]")) other.disabled = true;
      void this.actions.attack(row);
    });
    go.dataset["attack"] = row.baseid;
    go.dataset["wrecked"] = wrecked ? "1" : "0";
    go.disabled = wrecked || this.busy;
    go.setAttribute("aria-label", `Attack ${row.listName}`);
    return go;
  }

  private renderList(): void {
    const now = this.now();
    this.sortButton.dataset["sort"] = lastSort.sort === TribeSort.LEVEL ? (lastSort.reversed ? "asc" : "desc") : "none";
    this.sortButton.textContent =
      lastSort.sort === TribeSort.LEVEL ? `Level ${lastSort.reversed ? "↑" : "↓"}` : "Level";
    this.sortButton.setAttribute(
      "aria-label",
      lastSort.sort === TribeSort.LEVEL
        ? `Sorted by level, ${lastSort.reversed ? "lowest" : "highest"} first`
        : "Sort by level",
    );
    this.rowsBox.replaceChildren(
      ...sortTribeRows(this.rows, lastSort.sort, lastSort.reversed).map((row) => {
        const wrecked = row.state === TribeState.DESTROYED;
        const item = element("div", `inferno-row${wrecked ? " inferno-row--wrecked" : ""}`);
        item.dataset["baseid"] = row.baseid;
        const words = element("div", "inferno-row__words");
        words.append(element("span", "inferno-row__name", row.listName));
        if (wrecked) {
          const back = element("span", "inferno-row__back", respawnText(row, now));
          back.dataset["respawn"] = row.baseid;
          words.append(back);
        }
        item.append(portrait("inferno-row__portrait"), words, this.attackButton(row, "btn btn--primary inferno-row__attack"));
        return item;
      }),
    );
  }
}
