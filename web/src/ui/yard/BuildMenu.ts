import { ArtState, resolveArt, stripCrop } from "@/game/yard/buildingArt";
import {
  BUILD_CATALOGUE,
  BuildCategory,
  buildOffer,
  buildOffers,
  type BuildGate,
  type BuildOffer,
} from "@/game/yard/buildCatalogue";
import type { SpotCheck } from "@/game/yard/BuildPlacement";
import { NEED_MORE_SILOS } from "@/game/yard/storage";
import { typeName } from "@/game/yard/planner/summary";
import { YardChangeReason, type YardChange, type YardUiBinding } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import { costAmounts, resourceAmount } from "@/ui/resourceIcon";
import { ShinyButton } from "./ShinyButton";
import "@/ui/styles/build-menu.css";

/**
 * The build menu and the bar shown while a new building is carried
 * (`docs/design/yard-buildings.md` §5.3).
 *
 * The menu is a palette in the original's categories — resources, buildings,
 * monster buildings, defences, decorations — docked where the Monsters screen
 * docks (right under the HUD; a bottom sheet on a phone). Each tile shows the
 * building, its cost and time, `owned / allowed at this Town Hall`, and, when
 * it cannot be built, the one reason the server would give
 * (`game/yard/buildCatalogue.ts` decides; this file draws). Picking a tile hands
 * the type to the scene, which closes the menu and starts the placement
 * (`game/yard/BuildPlacement.ts`). Three clicks place a tower: Build, the tile,
 * the spot (the original took four, `docs/specs/base-building.md` §10).
 *
 * The tile's **Instant** is a Shiny spend, so it is a {@link ShinyButton}: tap,
 * then tap again. It starts the same placement, and the drop builds the
 * building finished for the Shiny shown.
 *
 * {@link PlacementBar} is the strip along the bottom while carrying: what is in
 * hand, what it costs, why the spot under the pointer is refused, and Cancel —
 * which a touch screen needs, having no Escape key.
 */

export interface BuildMenuOptions {
  /** The own yard. The menu exists only there. */
  readonly binding: YardUiBinding;
  /** A tile was picked: carry this type, finished for Shiny when `instant`. */
  readonly onPick: (type: number, instant: boolean) => void;
  /** After the player closes it. */
  readonly onClose?: () => void;
}

/** The icon box on a tile, in CSS pixels. */
const ICON_PX = 56;

export class BuildMenu {
  readonly element: HTMLElement;

  private readonly binding: YardUiBinding;
  private readonly onPick: BuildMenuOptions["onPick"];
  private readonly onClose: (() => void) | undefined;
  private readonly tabButtons = new Map<BuildCategory, HTMLButtonElement>();
  private readonly body: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly unsubscribe: () => void;
  /** One Instant button per type, kept across redraws so an armed one survives them. */
  private readonly shiny = new Map<number, ShinyButton>();

  private active: BuildCategory = BuildCategory.RESOURCES;
  private opened = false;
  private destroyed = false;

  constructor(options: BuildMenuOptions) {
    this.binding = options.binding;
    this.onPick = options.onPick;
    this.onClose = options.onClose;

    const panel = new Panel({ title: "Build", className: "build-menu", closable: false });
    this.element = panel.element;
    this.element.hidden = true;
    this.element.setAttribute("role", "region");
    this.element.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.stopPropagation();
        this.close();
      }
    });

    const strip = document.createElement("div");
    strip.className = "monsters-tabs build-menu__tabs";
    strip.setAttribute("role", "tablist");
    strip.setAttribute("aria-label", "Building categories");
    for (const category of BUILD_CATALOGUE) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "monsters-tabs__tab";
      button.id = `build-tab-${category.id}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", "build-menu-body");
      button.textContent = category.label;
      button.addEventListener("click", () => this.open(category.id));
      strip.append(button);
      this.tabButtons.set(category.id, button);
    }
    strip.addEventListener("keydown", (event) => this.onStripKey(event));

    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn btn--ghost btn--icon build-menu__close";
    close.setAttribute("aria-label", "Close Build");
    close.textContent = "×";
    close.addEventListener("click", () => this.close());
    panel.titlebar.append(strip, close);

    this.summary = document.createElement("p");
    this.summary.className = "build-menu__summary";

    this.body = document.createElement("div");
    this.body.className = "build-menu__body";
    this.body.id = "build-menu-body";
    this.body.setAttribute("role", "tabpanel");

    panel.setContent(this.summary, this.body);
    this.unsubscribe = this.binding.store.subscribe((change) => this.onChange(change));
  }

  get isOpen(): boolean {
    return this.opened;
  }

  get activeTab(): BuildCategory {
    return this.active;
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  /** Opens the menu on a tab (or brings that tab forward when already open). */
  open(category: BuildCategory = this.active): void {
    if (this.destroyed) return;
    const wasOpen = this.opened;
    this.opened = true;
    this.element.hidden = false;
    this.active = category;
    for (const [id, button] of this.tabButtons) {
      const current = id === category;
      button.setAttribute("aria-selected", String(current));
      button.tabIndex = current ? 0 : -1;
    }
    this.body.setAttribute("aria-labelledby", `build-tab-${category}`);
    this.render();
    if (!wasOpen) this.tabButtons.get(category)?.focus();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.element.hidden = true;
    this.disarm();
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

  /** Lets go of any armed Instant, so a closed menu cannot spend on a stale tap. */
  private disarm(): void {
    for (const [type, button] of this.shiny) {
      if (!button.armed) continue;
      button.destroy();
      this.shiny.delete(type);
    }
  }

  private render(): void {
    const store = this.binding.store;
    const workers = store.workers;
    this.summary.textContent =
      `Workers ${workers.total - workers.busy} free of ${workers.total}` +
      " · Walls and traps finish the moment they are placed.";

    const offers = buildOffers(this.active, store);
    if (offers.length === 0) {
      const empty = document.createElement("p");
      empty.className = "build-menu__empty";
      empty.textContent =
        this.active === BuildCategory.DECORATIONS
          ? "Decorations come with the decoration inventory in a later update."
          : "Nothing to build here yet.";
      this.body.replaceChildren(empty);
      return;
    }

    const list = document.createElement("ul");
    list.className = "build-menu__grid";
    for (const offer of offers) list.append(this.tile(offer));
    this.body.replaceChildren(list);
  }

  private tile(offer: BuildOffer): HTMLElement {
    const name = typeName(offer.type);
    const item = document.createElement("li");
    item.className = "build-tile";
    item.dataset["type"] = String(offer.type);
    if (offer.gate) item.classList.add("build-tile--blocked");

    const head = document.createElement("div");
    head.className = "build-tile__head";
    const title = document.createElement("h3");
    title.className = "build-tile__name";
    title.textContent = name;
    const count = document.createElement("span");
    count.className = "build-tile__count";
    count.textContent = `${offer.owned} / ${offer.allowed}`;
    count.title = `You have ${offer.owned}; your Town Hall allows ${offer.allowed}.`;
    head.append(title, count);

    const cost = document.createElement("div");
    cost.className = "build-tile__cost";
    cost.append(costAmounts(offer.cost) ?? "Free");
    const time = document.createElement("span");
    time.className = "build-tile__time";
    // Said as a sentence, not run into the last amount.
    const takes = document.createElement("span");
    takes.className = "u-visually-hidden";
    takes.textContent = offer.atOnce ? " built " : " takes ";
    time.append(takes, offer.atOnce ? "at once" : formatCountdown(offer.seconds));
    cost.append(time);

    const reason = offer.gate ? gateLine(offer.gate) : null;
    const reasonId = `build-gate-${offer.type}`;
    if (reason) reason.id = reasonId;

    const row = document.createElement("div");
    row.className = "build-tile__buttons";
    const build = document.createElement("button");
    build.type = "button";
    // Only a tile that can be built wears the primary colour.
    build.className = offer.gate ? "btn build-tile__build" : "btn btn--primary build-tile__build";
    build.textContent = "Build";
    build.disabled = offer.gate !== null;
    build.setAttribute(
      "aria-label",
      `Build ${name}` + (offer.gate ? `. ${gateSentence(offer.gate)}` : ""),
    );
    if (reason) build.setAttribute("aria-describedby", reasonId);
    build.addEventListener("click", () => this.onPick(offer.type, false));
    row.append(build);

    // Instant is offered once the hall and prerequisites allow the building;
    // what it lacks after that is Shiny, which the button itself says.
    if (!offer.instantGate || offer.instantGate.reason === "credits") {
      const instant = this.instantButton(offer.type);
      instant.setPrice(offer.instantPrice);
      instant.setBlocked(offer.instantGate ? "Not enough Shiny." : null);
      row.append(instant.element);
    }

    item.append(icon(offer.type, name), head, cost);
    if (reason) item.append(reason);
    item.append(row);
    return item;
  }

  private instantButton(type: number): ShinyButton {
    let button = this.shiny.get(type);
    if (!button) {
      button = new ShinyButton({
        label: "Instant",
        spell: formatAmount,
        className: "build-tile__instant",
        onSpend: () => {
          // Re-checked against the yard as it is now, not as the tile was drawn.
          const offer = buildOffer(type, this.binding.store);
          if (offer && !offer.instantGate) this.onPick(type, true);
        },
      });
      this.shiny.set(type, button);
    }
    return button;
  }
}

/** The building's picture, or a plain box when it has none. */
const icon = (type: number, name: string): HTMLElement => {
  const box = document.createElement("span");
  box.className = "build-tile__icon";
  const art = resolveArt(type, 1, ArtState.DEFAULT);
  if (!art) {
    box.setAttribute("aria-hidden", "true");
    return box;
  }
  const image = document.createElement("img");
  image.src = art.top.url;
  image.alt = "";
  image.setAttribute("loading", "lazy");
  image.setAttribute("decoding", "async");
  // An animation strip is cropped to its first cell (`stripCrop` says why).
  const crop = art.top.frame ? stripCrop(art.top.frame, ICON_PX) : null;
  if (crop) {
    image.style.position = "absolute";
    image.style.height = `${crop.height}px`;
    image.style.width = "auto";
    image.style.maxWidth = "none";
    image.style.left = `${crop.left}px`;
    image.style.top = `${crop.top}px`;
  } else {
    image.className = "build-tile__image";
  }
  box.title = name;
  box.append(image);
  return box;
};

/** "a Monster Locker at level 2", or "2 × Hatchery at level 2". */
const requirementText = ([type, count, level]: readonly [number, number, number]): string =>
  `${count === 1 ? "a" : `${count} ×`} ${typeName(type)} at level ${level}`;

/** Why a tile cannot be built, as plain words (a button's accessible name, a tooltip). */
export const gateSentence = (gate: BuildGate): string => {
  switch (gate.reason) {
    case "townHall":
      return gate.have <= 0 ? "Build a Town Hall first." : `Needs Town Hall ${gate.need}.`;
    case "limit":
      return gate.next === null
        ? `You have the most a yard can hold (${gate.allowed}).`
        : `You have all ${gate.allowed} your Town Hall allows. Town Hall ${gate.next} allows more.`;
    case "requirements":
      return `Needs ${gate.requirements.map(requirementText).join(", ")}.`;
    case "shortfall":
      return gate.overCap ? NEED_MORE_SILOS : "Not enough resources.";
    case "workers":
      return gate.total === 1 ? "Your worker is busy." : `All ${gate.total} workers are busy.`;
    case "credits":
      return "Not enough Shiny.";
  }
};

/** The one line on a tile that says why it cannot be built, amounts with their icons. */
export const gateLine = (gate: BuildGate): HTMLElement => {
  const line = document.createElement("p");
  line.className = "build-tile__gate";
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
  readonly onCancel: () => void;
}

/**
 * What to do next. A touch screen has no pointer to follow, so a tap moves the
 * building and a tap on it builds (`BuildPlacement.ts`).
 */
const PLACE_HINT = (): string =>
  typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
    ? "Tap a spot, then tap the building to build it."
    : "Click a spot to build. Esc cancels.";

/** The strip along the bottom while a new building is carried. */
export class PlacementBar {
  readonly element: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly message: HTMLElement;

  constructor(options: PlacementBarOptions) {
    this.element = document.createElement("div");
    this.element.className = "build-placing";
    this.element.setAttribute("role", "region");
    this.element.setAttribute("aria-label", "Placing a building");

    const what = document.createElement("div");
    what.className = "build-placing__what";
    const name = document.createElement("strong");
    name.className = "build-placing__name";
    name.textContent = typeName(options.type);
    const price = document.createElement("span");
    price.className = "build-placing__price";
    if (options.instant) {
      price.append("Finished at once for ", resourceAmount("shiny", formatAmount(options.instantPrice)));
    } else {
      price.append(costAmounts(options.cost) ?? "Free");
    }
    what.append(name, price);

    this.hint = document.createElement("p");
    this.hint.className = "build-placing__hint";
    this.hint.textContent = PLACE_HINT();

    this.message = document.createElement("p");
    this.message.className = "build-placing__message";
    this.message.setAttribute("role", "status");

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn build-placing__cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => options.onCancel());

    this.element.append(what, this.hint, this.message, cancel);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  /** What the spot under the pointer says: nothing when it is fine, why when it is not. */
  setSpot(text: string | null): void {
    this.element.classList.toggle("build-placing--blocked", Boolean(text));
    this.hint.textContent = text ? `Can't build here: ${text}` : PLACE_HINT();
  }

  /** A line about the last drop: the server's refusal, or what was built. */
  setMessage(text: string | null, tone: "good" | "bad" = "good"): void {
    this.message.textContent = text ?? "";
    this.message.dataset["tone"] = tone;
  }

  destroy(): void {
    this.element.remove();
  }
}
