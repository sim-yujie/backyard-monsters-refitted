import { WATER_MAX_HEIGHT } from "@/config";
import { CellType, isPlayerCell, isWaterCell, type MapCell, type Resources } from "@/api/types";
import { HexGrid, type OffsetCell } from "@/game/HexGrid";
import { Panel } from "@/ui/Panel";
import { TRIBE_COLOURS } from "@/game/maproom/cellVisuals";

/**
 * Everything the payload says about one cell.
 *
 * Deliberately exhaustive rather than curated: this screen is also how the rest
 * of the client gets checked against the server, so a field that arrives is a
 * field that shows. Where the wire is known to lie — `pi` and `fr` are always
 * 0, `dm` is zeroed once protection lapses — the panel says so instead of
 * presenting the value as fact.
 */

export interface CellPanelOptions {
  onClose: () => void;
  onBookmark: (cell: OffsetCell) => void;
  /** Whether "Bookmark" should be offered for this cell. */
  canBookmark: () => boolean;
  /** Opens the yard screen. Only offered on the caller's own cell. */
  onViewYard: () => void;
}

const ATTACK_SOON = "Coming soon: attacking is a later task.";

/**
 * Why "View yard" is limited to the caller's own cell.
 *
 * Opening someone else's yard is a `/base/load` in `view` mode against their
 * base id, and that mode is not implemented yet — `api/base.ts` only has the
 * own-yard call. The button therefore stays disabled on every other cell rather
 * than opening a screen that would show the player their own base under
 * somebody else's name.
 */
const OTHERS_YARD = "Coming soon: only your own yard opens in this build.";

export class CellPanel {
  readonly element: HTMLElement;

  private readonly panel: Panel;
  private readonly facts: HTMLDListElement;
  private readonly kind: HTMLElement;
  private readonly swatch: HTMLElement;
  private readonly bookmarkButton: HTMLButtonElement;
  private readonly viewYardButton: HTMLButtonElement;
  private readonly options: CellPanelOptions;

  private cell: OffsetCell | null = null;
  private payload: MapCell | undefined;
  /** Countdown rows, refreshed once a second by `tick`. */
  private countdowns: { node: HTMLElement; expiresAt: number }[] = [];

  constructor(options: CellPanelOptions) {
    this.options = options;
    this.panel = new Panel({
      title: "Cell",
      className: "map-panel",
      onClose: options.onClose,
    });
    this.element = this.panel.element;

    this.kind = document.createElement("span");
    this.kind.className = "cell-kind";
    this.swatch = document.createElement("span");
    this.swatch.className = "cell-swatch";
    const kindLabel = document.createElement("span");
    this.kind.append(this.swatch, kindLabel);

    this.facts = document.createElement("dl");
    this.facts.className = "cell-facts";

    this.viewYardButton = document.createElement("button");
    this.viewYardButton.type = "button";
    this.viewYardButton.className = "btn";
    this.viewYardButton.textContent = "View yard";
    this.viewYardButton.addEventListener("click", () => options.onViewYard());

    const actions = document.createElement("div");
    actions.className = "map-row map-row--wrap";
    actions.append(this.viewYardButton, disabledAction("Attack", ATTACK_SOON));

    this.bookmarkButton = document.createElement("button");
    this.bookmarkButton.type = "button";
    this.bookmarkButton.className = "btn";
    this.bookmarkButton.textContent = "Bookmark";
    this.bookmarkButton.addEventListener("click", () => {
      if (this.cell) options.onBookmark(this.cell);
    });
    actions.append(this.bookmarkButton);

    this.panel.setContent(this.kind, this.facts, actions);
  }

  /** Shows a cell. `payload` is undefined while its zone is still loading. */
  show(cell: OffsetCell, payload: MapCell | undefined): void {
    this.cell = cell;
    this.payload = payload;
    this.panel.setTitle(`Cell ${cell.col}, ${cell.row}`);
    this.bookmarkButton.disabled = !this.options.canBookmark();
    this.setViewYardEnabled(payload !== undefined && isPlayerCell(payload) && payload.mine === 1);
    this.render();
  }

  /** Re-renders with fresh payload, keeping the panel where it is. */
  update(payload: MapCell | undefined): void {
    if (!this.cell) return;
    this.payload = payload;
    this.setViewYardEnabled(payload !== undefined && isPlayerCell(payload) && payload.mine === 1);
    this.render();
  }

  /** Enabled on the caller's own cell, and explained on every other. */
  private setViewYardEnabled(enabled: boolean): void {
    this.viewYardButton.disabled = !enabled;
    if (enabled) {
      this.viewYardButton.title = "Open your yard";
      this.viewYardButton.setAttribute("aria-label", "View yard. Open your yard.");
    } else {
      this.viewYardButton.title = OTHERS_YARD;
      this.viewYardButton.setAttribute("aria-label", `View yard. ${OTHERS_YARD}`);
    }
  }

  get shownCell(): OffsetCell | null {
    return this.cell;
  }

  /** Advances the countdowns. Called once a second by the scene. */
  tick(nowSeconds: number): void {
    for (const entry of this.countdowns) {
      entry.node.textContent = formatCountdown(entry.expiresAt - nowSeconds);
    }
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  close(): void {
    this.panel.close();
  }

  private render(): void {
    const cell = this.cell;
    if (!cell) return;

    this.facts.replaceChildren();
    this.countdowns = [];

    const axial = HexGrid.toAxial(cell.col, cell.row);
    this.add("Coordinates", `${cell.col}, ${cell.row}`);
    this.add("Axial", `q ${axial.q}, r ${axial.r}`);

    const payload = this.payload;
    if (!payload) {
      this.setKind("Loading", "var(--colour-text-muted)");
      this.add("Status", "Waiting for this zone to load");
      return;
    }

    this.add("Terrain height", String(payload.i));

    if (isWaterCell(payload)) {
      this.setKind("Water", "var(--colour-terrain-water)");
      this.add("Occupiable", `No, height is ${payload.i} (water is ${WATER_MAX_HEIGHT} or less)`);
      return;
    }

    if (isPlayerCell(payload)) {
      this.renderPlayer(payload);
      return;
    }

    this.setKind("Wild monster camp", hexToCss(TRIBE_COLOURS[payload.n] ?? 0x9aa3b8));
    this.add("Tribe", payload.n);
    this.add("Level", String(payload.l));
    this.add("Damage", `${payload.dm}%`, payload.dm > 0 ? "is-danger" : undefined);
    this.add(
      "Destroyed",
      payload.d === 1 ? "Yes, takeover-eligible" : "No",
      payload.d === 1 ? "is-danger" : undefined,
    );
    this.add("Base id", payload.bid);
  }

  private renderPlayer(payload: Extract<MapCell, { uid: number; mine: 0 | 1 }>): void {
    const outpost = payload.b === CellType.OUTPOST;
    this.setKind(
      payload.mine === 1
        ? `Your ${outpost ? "outpost" : "main yard"}`
        : outpost
          ? "Outpost"
          : "Main yard",
      payload.mine === 1 ? "var(--colour-accent)" : "var(--colour-text)",
    );

    this.add("Owner", `${payload.n} (user ${payload.uid})`);
    this.add("Level", String(payload.l));
    this.add("Empire value", payload.v.toLocaleString());
    this.add("Alliance", payload.aid === null ? "None" : `#${payload.aid}`);
    this.add("Flinger", `Level ${payload.f}`);
    this.add("Catapult", `Level ${payload.c}`);

    this.add(
      "Damage",
      payload.p === 1 ? `${payload.dm}%` : `${payload.dm}% (reset once protection lapsed)`,
      payload.dm > 0 ? "is-danger" : undefined,
    );
    this.add(
      "Destroyed",
      payload.d === 1 ? "Yes, takeover-eligible" : "No",
      payload.d === 1 ? "is-danger" : undefined,
    );

    // The wire carries `p` as a boolean only. The expiry exists server-side as
    // `save.protected` but is not sent (docs/specs/maproom2.md §10), so there
    // is nothing honest to count down to here — unlike a truce.
    this.add(
      "Protection",
      payload.p === 1 ? "Active (the server sends no expiry)" : "None",
      payload.p === 1 ? "is-info" : undefined,
    );

    if (payload.t !== undefined) {
      this.addCountdown("Truce", payload.t);
    } else {
      this.add("Truce", payload.mine === 1 ? "Not sent for your own cells" : "None");
    }

    this.add(
      "Busy",
      payload.lo === 0 ? "No" : `Locked by user ${payload.lo} (online or under attack)`,
      payload.lo === 0 ? undefined : "is-info",
    );
    this.add("Base id", payload.bid);
    this.add("Avatar", payload.pic_square ?? "None");

    if (payload.r) this.addResources(payload.r);
    if (payload.m && Object.keys(payload.m).length > 0) {
      this.add("Hatchery data", `${Object.keys(payload.m).length} fields`);
    }
  }

  /** `r1`..`r4` in the order the game has always shown them (`docs/specs/base-building.md:569-574`). */
  private addResources(resources: Resources): void {
    const names: [string, string][] = [
      ["r1", "Twigs"],
      ["r2", "Pebbles"],
      ["r3", "Putty"],
      ["r4", "Goo"],
    ];
    for (const [key, label] of names) {
      const amount = resources[key];
      if (amount === undefined) continue;
      const max = resources[`${key}max`];
      this.add(
        label,
        max === undefined
          ? amount.toLocaleString()
          : `${amount.toLocaleString()} / ${max.toLocaleString()}`,
      );
    }
  }

  private setKind(label: string, colour: string): void {
    const text = this.kind.lastElementChild;
    if (text) text.textContent = label;
    this.swatch.style.background = colour;
  }

  private add(label: string, value: string, className?: string): void {
    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    definition.textContent = value;
    if (className) definition.className = className;
    this.facts.append(term, definition);
  }

  private addCountdown(label: string, expiresAtSeconds: number): void {
    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    definition.className = "is-info";
    definition.textContent = formatCountdown(expiresAtSeconds - Date.now() / 1000);
    this.facts.append(term, definition);
    this.countdowns.push({ node: definition, expiresAt: expiresAtSeconds });
  }
}

const disabledAction = (label: string, tooltip: string): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  button.textContent = label;
  button.disabled = true;
  button.title = tooltip;
  // `title` alone is not exposed on a disabled control in every browser.
  button.setAttribute("aria-label", `${label}. ${tooltip}`);
  return button;
};

/** Seconds remaining as a compact duration, or "Expired". */
const formatCountdown = (seconds: number): string => {
  if (seconds <= 0) return "Expired";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = Math.floor(seconds % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
};

const hexToCss = (colour: number): string => `#${colour.toString(16).padStart(6, "0")}`;
