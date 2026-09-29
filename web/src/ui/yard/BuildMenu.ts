import { buttonUrl, silhouetteUrl } from "@/game/yard/buildButtonArt";
import {
  BUILD_CATALOGUE,
  BuildCategory,
  buildOffer,
  buildOffers,
  pageCount,
  pageOf,
  sortOffers,
  type BuildGate,
  type BuildNeed,
  type BuildOffer,
} from "@/game/yard/buildCatalogue";
import type { SpotCheck } from "@/game/yard/BuildPlacement";
import { townHallLevel } from "@/game/yard/buildingCosts";
import { NEED_MORE_SILOS } from "@/game/yard/storage";
import { typeName } from "@/game/yard/planner/summary";
import { YardChangeReason, type YardChange, type YardUiBinding } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import { costAmounts, RESOURCE_KEYS, resourceAmount } from "@/ui/resourceIcon";
import { BUILD_BLURBS } from "./buildBlurbs";
import { ShinyButton } from "./ShinyButton";
import "@/ui/styles/build-menu.css";

/**
 * The Build window and the bar shown while a new building is carried (#157,
 * `docs/design/yard-buildings.md` §5.3).
 *
 * The window is the original's build popup (`BUILDINGSPOPUP.as`,
 * `BUILDINGBUTTON.as`, `BUILDINGOPTIONSPOPUP.as`) in the revamp's style: four
 * tabs, Resources, Buildings, Defensive and Decorations; ten tiles a page, five
 * across by two down, with Previous and Next; each tile the building's picture,
 * name and "2 of 3 built", a tick once the yard has all any Town Hall allows,
 * and a dark silhouette with "Unlocks at Town Hall 4" while it is not
 * unlocked. Tiles sort ready first, then locked, then all built
 * (`game/yard/buildCatalogue.ts` decides all of it; this file draws).
 *
 * Picking a tile opens its info beside the tiles (in place of them on a
 * phone): what it is for, what it needs (ticked when the yard has it), the
 * cost, the time and the worker, **Build**, and a small **Build instantly**
 * that spends Shiny. Build hands the type to the scene, which closes the
 * window and starts the placement (`game/yard/BuildPlacement.ts`).
 *
 * Build instantly is a {@link ShinyButton}: tap, then tap again. It starts the
 * same placement, and the drop builds the building finished for the Shiny
 * shown.
 *
 * {@link PlacementBar} is the strip along the bottom while carrying: what is in
 * hand, what it costs, whether the spot is good, Cancel, and on a phone a big
 * **Build here** — a touch screen has no pointer to follow, so a tap moves the
 * building and this button puts it down.
 */

export interface BuildMenuOptions {
  /** The own yard. The window exists only there. */
  readonly binding: YardUiBinding;
  /** Build was pressed: carry this type, finished for Shiny when `instant`. */
  readonly onPick: (type: number, instant: boolean) => void;
  /** "Upgrade Town Hall": show the Town Hall. Left out, the link is not drawn. */
  readonly onTownHall?: () => void;
  /** After the player closes it. */
  readonly onClose?: () => void;
}

/** The layout that stacks the info over the tiles and carries with a Build here button. */
const PHONE_QUERY = "(width <= 620px), (pointer: coarse)";

const isPhone = (): boolean =>
  typeof window !== "undefined" && window.matchMedia?.(PHONE_QUERY).matches === true;

const SVG_NS = "http://www.w3.org/2000/svg";

/** A small line icon in the text's colour, hidden from assistive technology. */
const glyph = (paths: readonly string[], className: string, size = 16): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.4");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
};

const TICK = ["M5 12.5l4.5 4.5L19 7.5"];
const LOCK = ["M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z", "M8 11V8a4 4 0 0 1 8 0v3"];
const CROSS = ["M7 7l10 10", "M17 7L7 17"];
const PREVIOUS = ["M15 6l-6 6 6 6"];
const NEXT = ["M9 6l6 6-6 6"];
const CLOCK = ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z", "M12 7v5l3 2"];
const WORKER = ["M12 4a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z", "M5 20c0-3.5 3-6 7-6s7 2.5 7 6"];

/** "2 of 3 built" and the like: what a tile says under its name. */
export const tileLine = (offer: BuildOffer): string => {
  if (offer.stored !== null) return `${offer.stored} in storage`;
  switch (offer.status) {
    case "locked": {
      const gate = offer.gate;
      if (gate?.reason === "townHall") {
        return gate.have <= 0 ? "Needs a Town Hall" : `Unlocks at Town Hall ${gate.need}`;
      }
      const need = offer.needs.find((one) => !one.met);
      return need ? `Needs ${needText(need)}` : "Not yet";
    }
    case "maxed":
      return `${offer.owned} of ${offer.most} · all built`;
    default:
      return `${offer.owned} of ${offer.allowed} built`;
  }
};

/** "a Housing", "3 Hatcheries at level 2". */
const plural = (name: string): string => {
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/i.test(name)) return `${name}es`;
  return `${name}s`;
};

/** One line of the needs list, as words. On an outpost the core is the hall. */
export const needText = (need: BuildNeed, outpost = false): string => {
  if (need.kind === "townHall") return outpost ? "an Outpost core" : `Town Hall level ${need.level}`;
  const name = typeName(need.type);
  const which =
    need.count === 1 ? `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}` : `${need.count} ${plural(name)}`;
  return need.level > 1 ? `${which} at level ${need.level}` : which;
};

export class BuildMenu {
  readonly element: HTMLElement;

  private readonly binding: YardUiBinding;
  private readonly onPick: BuildMenuOptions["onPick"];
  private readonly onTownHall: (() => void) | undefined;
  private readonly onClose: (() => void) | undefined;
  private readonly tabButtons = new Map<BuildCategory, HTMLButtonElement>();
  private readonly meta: HTMLElement;
  private readonly browse: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly pages: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly info: HTMLElement;
  private readonly unsubscribe: () => void;
  /** One Build instantly button per type, kept across redraws so an armed one survives them. */
  private readonly shiny = new Map<number, ShinyButton>();

  private active: BuildCategory = BuildCategory.RESOURCES;
  private page = 0;
  /** The tile whose info is showing, or null for none. */
  private picked: number | null = null;
  private opened = false;
  private destroyed = false;

  constructor(options: BuildMenuOptions) {
    this.binding = options.binding;
    this.onPick = options.onPick;
    this.onTownHall = options.onTownHall;
    this.onClose = options.onClose;

    const panel = new Panel({ title: "Build", className: "build-menu", closable: false });
    this.element = panel.element;
    this.element.hidden = true;
    this.element.setAttribute("role", "region");
    this.element.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.stopPropagation();
      // On a phone Escape backs out of the info first, as Back does.
      if (this.picked !== null && isPhone()) this.pick(null);
      else this.close();
    });

    this.meta = document.createElement("p");
    this.meta.className = "build-menu__meta";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn btn--ghost btn--icon build-menu__close";
    close.setAttribute("aria-label", "Close Build");
    close.textContent = "×";
    close.addEventListener("click", () => this.close());
    panel.titlebar.append(this.meta, close);

    const strip = document.createElement("div");
    strip.className = "tabs monsters-tabs build-menu__tabs";
    strip.setAttribute("role", "tablist");
    strip.setAttribute("aria-label", "Building types");
    for (const category of BUILD_CATALOGUE) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tabs__tab monsters-tabs__tab";
      button.id = `build-tab-${category.id}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", "build-menu-main");
      button.textContent = category.label;
      button.addEventListener("click", () => this.open(category.id));
      strip.append(button);
      this.tabButtons.set(category.id, button);
    }
    strip.addEventListener("keydown", (event) => this.onStripKey(event));

    this.previous = this.pageButton("Previous page", PREVIOUS, -1);
    this.next = this.pageButton("Next page", NEXT, 1);
    this.grid = document.createElement("ul");
    this.grid.className = "build-menu__grid";
    this.pages = document.createElement("p");
    this.pages.className = "build-menu__pages";
    const pager = document.createElement("div");
    pager.className = "build-menu__pager";
    pager.append(this.previous, this.grid, this.next, this.pages);

    this.legend = document.createElement("div");
    this.legend.className = "build-menu__legend";

    this.browse = document.createElement("div");
    this.browse.className = "build-menu__browse";
    this.browse.append(pager, this.legend);

    this.info = document.createElement("section");
    this.info.className = "build-info";

    const main = document.createElement("div");
    main.className = "build-menu__main";
    main.id = "build-menu-main";
    main.setAttribute("role", "tabpanel");
    main.append(this.browse, this.info);

    panel.setContent(strip, main);
    this.unsubscribe = this.binding.store.subscribe((change) => this.onChange(change));
  }

  get isOpen(): boolean {
    return this.opened;
  }

  get activeTab(): BuildCategory {
    return this.active;
  }

  /** The tile whose info is showing. */
  get pickedType(): number | null {
    return this.picked;
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  /**
   * Opens the window on a tab (or brings that tab forward when already open).
   * It reopens where it was left, as the original did (`BUILDINGS.as:11-15`).
   */
  open(category: BuildCategory = this.active): void {
    if (this.destroyed) return;
    const wasOpen = this.opened;
    this.opened = true;
    this.element.hidden = false;
    if (category !== this.active) {
      this.active = category;
      this.page = 0;
      this.picked = null;
    }
    for (const [id, button] of this.tabButtons) {
      const current = id === category;
      button.setAttribute("aria-selected", String(current));
      button.tabIndex = current ? 0 : -1;
    }
    this.element.querySelector("#build-menu-main")?.setAttribute("aria-labelledby", `build-tab-${category}`);
    // Beside the tiles there is room to show the first one straight away.
    if (this.picked === null && !isPhone()) this.picked = this.sorted()[0]?.type ?? null;
    this.render();
    if (!wasOpen) this.tabButtons.get(category)?.focus();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.element.hidden = true;
    this.disarm();
    // A phone reopens on the tiles, not on an info it was showing.
    if (isPhone()) this.picked = null;
    this.onClose?.();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    this.disarm();
    for (const button of this.shiny.values()) button.destroy();
    this.shiny.clear();
    this.element.remove();
  }

  /** Shows a tile's info, or goes back to the tiles with null. */
  pick(type: number | null): void {
    if (type === this.picked) return;
    this.disarm();
    const back = this.picked;
    this.picked = type;
    this.render();
    if (type !== null) {
      if (isPhone()) this.info.querySelector<HTMLElement>(".build-info__back")?.focus();
    } else if (back !== null) {
      this.grid.querySelector<HTMLElement>(`.build-tile[data-type="${back}"]`)?.focus();
    }
  }

  /** Turns the page by `step`, staying inside the tab. */
  turn(step: number): void {
    const last = pageCount(this.sorted().length) - 1;
    const page = Math.min(Math.max(this.page + step, 0), last);
    if (page === this.page) return;
    this.page = page;
    this.render();
  }

  private onChange(change: YardChange): void {
    if (!this.opened) return;
    if (change.reason === YardChangeReason.PENDING || change.reason === YardChangeReason.AWAY) return;
    this.render();
  }

  private onStripKey(event: KeyboardEvent): void {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const order = BUILD_CATALOGUE.map((category) => category.id);
    const index = order.indexOf(this.active);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = order[(index + step + order.length) % order.length] ?? this.active;
    this.open(next);
    this.tabButtons.get(next)?.focus();
  }

  private pageButton(label: string, paths: readonly string[], step: number): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn build-menu__turn build-menu__turn--${step < 0 ? "previous" : "next"}`;
    button.setAttribute("aria-label", label);
    button.dataset["focus"] = step < 0 ? "previous" : "next";
    button.append(glyph(paths, "build-menu__turn-icon", 20));
    button.addEventListener("click", () => this.turn(step));
    return button;
  }

  /** Lets go of any armed Build instantly, so a closed window cannot spend on a stale tap. */
  private disarm(): void {
    for (const [type, button] of this.shiny) {
      if (!button.armed) continue;
      button.destroy();
      this.shiny.delete(type);
    }
  }

  private sorted(): BuildOffer[] {
    return sortOffers(buildOffers(this.active, this.binding.store));
  }

  private render(): void {
    // Redrawing replaces the controls; put the focus back on the same one.
    const focused =
      document.activeElement instanceof HTMLElement && this.element.contains(document.activeElement)
        ? (document.activeElement.dataset["focus"] ?? null)
        : null;

    const store = this.binding.store;
    const workers = store.workers;
    // On an outpost the core stands in for the hall and never levels up, so
    // the line names the outpost's limits instead (`buildingCosts.ts`).
    const outpost = store.kind === "outpost";
    const hall = townHallLevel(store.yard);
    const free = workers.total - workers.busy;
    this.meta.replaceChildren(
      glyph(WORKER, "build-menu__meta-icon"),
      `${free} of ${workers.total} ${workers.total === 1 ? "worker" : "workers"} free`,
      outpost ? " · Outpost limits" : hall > 0 ? ` · Town Hall level ${hall}` : " · No Town Hall",
    );

    const offers = this.sorted();
    const pages = pageCount(offers.length);
    this.page = Math.min(this.page, pages - 1);
    if (this.picked !== null && !offers.some((offer) => offer.type === this.picked)) this.picked = null;
    this.element.classList.toggle("build-menu--picked", this.picked !== null);

    if (offers.length === 0) {
      const empty = document.createElement("li");
      empty.className = "build-menu__empty";
      empty.textContent =
        this.active === BuildCategory.DECORATIONS
          ? "No decorations in storage. Recycle one to keep it here, then place it again from this tab."
          : "Nothing to build here yet.";
      this.grid.replaceChildren(empty);
    } else {
      this.grid.replaceChildren(...pageOf(offers, this.page).map((offer) => this.tile(offer)));
    }

    this.previous.disabled = this.page === 0;
    this.next.disabled = this.page >= pages - 1;
    this.pages.replaceChildren(...this.pageDots(pages));
    this.drawLegend(outpost ? 0 : hall, this.active === BuildCategory.DECORATIONS);

    const offer = offers.find((one) => one.type === this.picked) ?? null;
    this.drawInfo(offer);

    if (focused) this.element.querySelector<HTMLElement>(`[data-focus="${focused}"]`)?.focus();
  }

  private pageDots(pages: number): Node[] {
    const dots = document.createElement("span");
    dots.className = "build-menu__dots";
    dots.setAttribute("aria-hidden", "true");
    for (let index = 0; index < pages; index++) {
      const dot = document.createElement("span");
      dot.className = "build-menu__dot";
      if (index === this.page) dot.classList.add("build-menu__dot--current");
      dots.append(dot);
    }
    const words = document.createElement("span");
    words.className = "build-menu__page";
    words.textContent = `Page ${this.page + 1} of ${pages}`;
    return [dots, words];
  }

  private drawLegend(hall: number, storage: boolean): void {
    const key = (paths: readonly string[] | null, text: string): HTMLElement => {
      const item = document.createElement("span");
      item.className = "build-menu__key";
      if (paths) item.append(glyph(paths, "build-menu__key-icon", 12));
      item.append(text);
      return item;
    };
    // Decorations come from storage: nothing is locked and nothing runs out
    // but the count, so the build keys would only mislead.
    if (storage) {
      this.legend.replaceChildren(key(null, "Your stored decorations. Placing one is free."));
      return;
    }
    const parts: HTMLElement[] = [
      key(null, "Ready to build come first."),
      key(LOCK, "Dark shape: not yet"),
      key(TICK, "Tick: you have them all"),
    ];
    if (this.onTownHall && hall > 0) {
      const upgrade = document.createElement("button");
      upgrade.type = "button";
      upgrade.className = "btn btn--ghost build-menu__hall";
      upgrade.dataset["focus"] = "hall";
      upgrade.append("Upgrade Town Hall", glyph(NEXT, "build-menu__hall-icon"));
      upgrade.addEventListener("click", () => this.onTownHall?.());
      parts.push(upgrade);
    }
    this.legend.replaceChildren(...parts);
  }

  private tile(offer: BuildOffer): HTMLElement {
    const name = typeName(offer.type);
    const item = document.createElement("li");
    item.className = "build-menu__cell";

    const button = document.createElement("button");
    button.type = "button";
    button.className = `build-tile build-tile--${offer.status}`;
    button.dataset["type"] = String(offer.type);
    button.dataset["focus"] = `tile-${offer.type}`;
    button.setAttribute("aria-pressed", String(offer.type === this.picked));
    button.addEventListener("click", () => this.pick(offer.type));

    const title = document.createElement("span");
    title.className = "build-tile__name";
    title.textContent = name;
    const count = document.createElement("span");
    count.className = "build-tile__count";
    count.textContent = tileLine(offer);
    if (offer.status === "locked" && offer.gate?.reason === "requirements") {
      count.classList.add("build-tile__count--needs");
    }

    button.append(picture(offer, "build-tile__picture"), title, count);
    item.append(button);
    return item;
  }

  private drawInfo(offer: BuildOffer | null): void {
    if (!offer) {
      this.info.removeAttribute("aria-label");
      const empty = document.createElement("p");
      empty.className = "build-info__empty";
      empty.textContent = "Pick a building to see what it needs and costs.";
      this.info.replaceChildren(empty);
      return;
    }
    const name = typeName(offer.type);
    this.info.setAttribute("aria-label", name);

    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn btn--ghost build-info__back";
    back.dataset["focus"] = "back";
    back.append(glyph(PREVIOUS, "build-info__back-icon"), "All buildings");
    back.addEventListener("click", () => this.pick(null));

    const head = document.createElement("div");
    head.className = "build-info__head";
    const title = document.createElement("h3");
    title.className = "build-info__name";
    title.textContent = name;
    const count = document.createElement("span");
    count.className = "build-info__count";
    count.textContent =
      offer.stored !== null || offer.status === "locked"
        ? tileLine(offer)
        : `${offer.owned} of ${offer.allowed} built`;
    head.append(title, count);

    const blurb = document.createElement("p");
    blurb.className = "build-info__blurb";
    blurb.textContent =
      BUILD_BLURBS[offer.type] ??
      (offer.stored !== null ? "A decoration from your storage. It goes anywhere inside your yard." : "");
    if (offer.stored !== null) {
      this.info.replaceChildren(back, picture(offer, "build-info__picture"), head, blurb, this.storageActions(offer, name));
      return;
    }

    const needs = document.createElement("div");
    needs.className = "build-info__needs";
    const needsTitle = document.createElement("h4");
    needsTitle.className = "build-info__label";
    needsTitle.textContent = "Needs";
    const list = document.createElement("ul");
    list.className = "build-info__need-list";
    for (const need of offer.needs) {
      const line = document.createElement("li");
      line.className = `build-need build-need--${need.met ? "met" : "unmet"}`;
      const mark = glyph(need.met ? TICK : CROSS, "build-need__mark", 14);
      const state = document.createElement("span");
      state.className = "u-visually-hidden";
      state.textContent = need.met ? "Done: " : "Not yet: ";
      const words = needText(need, this.binding.store.kind === "outpost");
      line.append(mark, state, words.charAt(0).toUpperCase() + words.slice(1));
      list.append(line);
    }
    needs.append(needsTitle, list);

    const facts = document.createElement("ul");
    facts.className = "build-info__facts";
    facts.setAttribute("aria-label", "Cost");
    const resources = this.binding.store.resources;
    for (const key of RESOURCE_KEYS) {
      const amount = offer.cost[key];
      if (amount <= 0) continue;
      const chip = document.createElement("li");
      chip.className = "build-info__fact";
      if (Number(resources[key] ?? 0) < amount) chip.classList.add("build-info__fact--short");
      chip.append(resourceAmount(key, amount));
      facts.append(chip);
    }
    const time = document.createElement("li");
    time.className = "build-info__fact";
    time.append(glyph(CLOCK, "build-info__fact-icon"), offer.atOnce ? "At once" : formatCountdown(offer.seconds));
    const worker = document.createElement("li");
    worker.className = "build-info__fact";
    worker.append(glyph(WORKER, "build-info__fact-icon"), offer.atOnce ? "No worker" : "1 worker");
    facts.append(time, worker);

    const nodes: Node[] = [back, picture(offer, "build-info__picture"), head, blurb, needs, facts];

    // The needs list already says what a locked building waits for.
    const gate = offer.gate;
    const reasonId = `build-gate-${offer.type}`;
    const saysWhy = gate !== null && gate.reason !== "townHall" && gate.reason !== "requirements";
    if (gate && saysWhy) {
      const reason = gateLine(gate);
      reason.id = reasonId;
      nodes.push(reason);
    }

    const actions = document.createElement("div");
    actions.className = "build-info__actions";
    const build = document.createElement("button");
    build.type = "button";
    // Only a building that can be built wears the primary colour.
    build.className = gate ? "btn build-info__build" : "btn btn--primary build-info__build";
    build.dataset["focus"] = "build";
    build.textContent = "Build · then pick a spot";
    build.disabled = gate !== null;
    build.setAttribute("aria-label", `Build ${name}` + (gate ? `. ${gateSentence(gate)}` : ""));
    if (saysWhy) build.setAttribute("aria-describedby", reasonId);
    build.addEventListener("click", () => this.onPick(offer.type, false));
    actions.append(build);

    // Build instantly is offered once the hall and prerequisites allow the
    // building; what it lacks after that is Shiny, which the button itself says.
    if (!offer.instantGate || offer.instantGate.reason === "credits") {
      const instant = this.instantButton(offer.type);
      instant.setPrice(offer.instantPrice);
      instant.setBlocked(offer.instantGate ? "Not enough Shiny." : null);
      actions.append(instant.element);
    }
    nodes.push(actions);

    this.info.replaceChildren(...nodes);
  }

  /** A stored decoration's facts and its Place button: free, at once, no worker (§8.3). */
  private storageActions(offer: BuildOffer, name: string): HTMLElement {
    const wrap = document.createElement("div");
    const facts = document.createElement("ul");
    facts.className = "build-info__facts";
    facts.setAttribute("aria-label", "Cost");
    for (const [icon, text] of [
      [null, "Free"],
      [CLOCK, "At once"],
      [WORKER, "No worker"],
    ] as const) {
      const fact = document.createElement("li");
      fact.className = "build-info__fact";
      if (icon) fact.append(glyph(icon, "build-info__fact-icon"));
      fact.append(text);
      facts.append(fact);
    }
    const actions = document.createElement("div");
    actions.className = "build-info__actions";
    const place = document.createElement("button");
    place.type = "button";
    place.className = "btn btn--primary build-info__build";
    place.dataset["focus"] = "build";
    place.textContent = "Place · then pick a spot";
    place.setAttribute("aria-label", `Place ${name} from storage`);
    place.addEventListener("click", () => this.onPick(offer.type, false));
    actions.append(place);
    wrap.append(facts, actions);
    return wrap;
  }

  private instantButton(type: number): ShinyButton {
    let button = this.shiny.get(type);
    if (!button) {
      button = new ShinyButton({
        label: "Build instantly for",
        spell: formatAmount,
        className: "btn--ghost build-info__instant",
        onSpend: () => {
          // Re-checked against the yard as it is now, not as the panel was drawn.
          const offer = buildOffer(type, this.binding.store);
          if (offer && !offer.instantGate) this.onPick(type, true);
        },
      });
      button.element.dataset["focus"] = "instant";
      this.shiny.set(type, button);
    }
    return button;
  }
}

/**
 * The building's picture from the original's build buttons, or its dark
 * silhouette while it is locked (`game/yard/buildButtonArt.ts`).
 */
const picture = (offer: BuildOffer, className: string): HTMLElement => {
  const box = document.createElement("span");
  box.className = className;
  box.setAttribute("aria-hidden", "true");
  const image = document.createElement("img");
  image.alt = "";
  image.setAttribute("decoding", "async");
  const locked = offer.status === "locked";
  const silhouette = locked ? silhouetteUrl(offer.type) : null;
  image.src = silhouette ?? buttonUrl(offer.type);
  // No silhouette on disk: the plain picture, drawn dark by the CSS.
  if (locked && !silhouette) box.classList.add(`${className}--shade`);
  box.append(image);
  if (offer.status === "locked" || offer.status === "maxed") {
    const badge = document.createElement("span");
    badge.className = `build-badge build-badge--${offer.status}`;
    badge.append(glyph(offer.status === "locked" ? LOCK : TICK, "build-badge__icon", 12));
    box.append(badge);
  }
  return box;
};

/** Why a building cannot be built, as plain words (a button's accessible name, the info's reason). */
export const gateSentence = (gate: BuildGate): string => {
  switch (gate.reason) {
    case "townHall":
      return gate.have <= 0 ? "Build a Town Hall first." : `Needs Town Hall ${gate.need}.`;
    case "limit":
      return gate.next === null
        ? `You have the most a yard can hold (${gate.allowed}).`
        : `You have all ${gate.allowed} your Town Hall allows. Town Hall ${gate.next} allows more.`;
    case "requirements":
      return `Needs ${gate.requirements
        .map(([type, count, level]) => needText({ kind: "building", type, count, level, met: false }))
        .join(", ")}.`;
    case "shortfall":
      return gate.overCap ? NEED_MORE_SILOS : "Not enough resources.";
    case "workers":
      return gate.total === 1 ? "Your worker is busy." : `All ${gate.total} workers are busy.`;
    case "credits":
      return "Not enough Shiny.";
  }
};

/** The one line that says why a building cannot be built, amounts with their icons. */
export const gateLine = (gate: BuildGate): HTMLElement => {
  const line = document.createElement("p");
  line.className = "build-info__gate";
  if (gate.reason === "shortfall" && !gate.overCap) {
    line.append("Need ", costAmounts(gate.shortfall) ?? "", " more.");
  } else if (gate.reason === "credits") {
    line.append("Need ", resourceAmount("shiny", formatAmount(gate.need)), " more.");
  } else {
    line.textContent = gateSentence(gate);
  }
  return line;
};

/** Why a spot is refused, for the bar. */
export const spotSentence = (check: SpotCheck, nameOf: (id: number) => string | null): string => {
  switch (check.problem) {
    case "outOfBounds":
      return "Outside your yard.";
    case "mushroom":
      return "A mushroom is in the way.";
    case "overlap": {
      const other = check.blockedBy === null ? null : nameOf(check.blockedBy);
      return other ? `On top of your ${other}.` : "Something is already there.";
    }
    default:
      return "";
  }
};

export interface PlacementBarOptions {
  readonly type: number;
  /** Placing finished for Shiny rather than for resources. */
  readonly instant: boolean;
  readonly instantPrice: number;
  readonly cost: BuildOffer["cost"];
  /** How long it takes, already spelled ("15m 0s", "At once"). */
  readonly time?: string;
  readonly onCancel: () => void;
  /** Build here: put it down where it is showing. Left out, the button is not drawn. */
  readonly onBuildHere?: () => void;
}

/** What to do next, before the spot has anything to say. */
const placeHint = (phone: boolean): string =>
  phone ? "Good spot. Tap to move it, or build here." : "Click a spot to build. Esc cancels.";

/** The strip along the bottom while a new building is carried. */
export class PlacementBar {
  readonly element: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly message: HTMLElement;
  private readonly here: HTMLButtonElement | null = null;
  private readonly phone = isPhone();

  constructor(options: PlacementBarOptions) {
    this.element = document.createElement("div");
    this.element.className = "build-placing";
    this.element.setAttribute("role", "region");
    this.element.setAttribute("aria-label", "Placing a building");

    const what = document.createElement("div");
    what.className = "build-placing__what";
    const image = document.createElement("img");
    image.className = "build-placing__picture";
    image.src = buttonUrl(options.type);
    image.alt = "";
    const words = document.createElement("div");
    words.className = "build-placing__words";
    const name = document.createElement("strong");
    name.className = "build-placing__name";
    name.textContent = typeName(options.type);
    const price = document.createElement("span");
    price.className = "build-placing__price";
    if (options.instant) {
      price.append("Finished at once for ", resourceAmount("shiny", formatAmount(options.instantPrice)));
    } else {
      price.append(costAmounts(options.cost) ?? "Free");
      if (options.time) {
        const time = document.createElement("span");
        time.className = "build-placing__time";
        time.textContent = ` · ${options.time}`;
        price.append(time);
      }
    }
    words.append(name, price);
    what.append(image, words);

    this.hint = document.createElement("p");
    this.hint.className = "build-placing__hint";
    this.hint.setAttribute("role", "status");
    this.hint.textContent = placeHint(this.phone);

    this.message = document.createElement("p");
    this.message.className = "build-placing__message";
    this.message.setAttribute("aria-live", "polite");

    const buttons = document.createElement("div");
    buttons.className = "build-placing__buttons";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn build-placing__cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => options.onCancel());
    buttons.append(cancel);
    if (options.onBuildHere) {
      const here = document.createElement("button");
      here.type = "button";
      here.className = "btn btn--primary build-placing__here";
      here.textContent = "Build here";
      const onBuildHere = options.onBuildHere;
      here.addEventListener("click", () => onBuildHere());
      buttons.append(here);
      this.here = here;
    }

    this.element.append(what, this.hint, this.message, buttons);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  /** What the spot says: nothing when it is fine, why when it is not. */
  setSpot(text: string | null): void {
    this.element.classList.toggle("build-placing--blocked", Boolean(text));
    this.hint.textContent = text ? `Can't build here: ${text}` : placeHint(this.phone);
    if (this.here) this.here.disabled = Boolean(text);
  }

  /** A line about the last drop: the server's refusal, or what was built. */
  setMessage(text: string | null, tone: "good" | "bad" = "good"): void {
    this.message.textContent = text ?? "";
    this.message.dataset["tone"] = tone;
  }

  /** A wall or trap went down and another is in hand: say how to place the next. */
  setBuiltAgain(): void {
    this.setMessage(this.phone ? "Built. Tap a new spot for the next one." : "Built. Click again for another.");
  }

  destroy(): void {
    this.element.remove();
  }
}
