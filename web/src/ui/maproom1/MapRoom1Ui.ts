import { guideBus, GuideScreen } from "@/game/guide/guideBus";
import type { Resources } from "@/api/types";
import {
  formatRespawn,
  formatSpan,
  type Mr1Neighbour,
  type Mr1Own,
  type Mr1Target,
  type Mr1World,
} from "@/game/maproom1/mr1Model";
import { achievementsLine } from "@/ui/achievements/AchievementsLine";
import { Hud } from "@/ui/Hud";
import { Notices } from "@/ui/maproom/Notices";
import { Mr1ListView } from "./Mr1ListView";
import { Mr1MapView } from "./Mr1MapView";
import { armyChips, targetCard, type CardAction } from "./TargetCard";
import { button, el, icon } from "./icons";

/**
 * Every piece of DOM the Map Room 1 screen puts on the overlay (issue #132),
 * laid out as the approved mock-ups (MR1 · Map, MR1 · Target, MR1 on a phone):
 * the Flash window's Map / List toggle (`com/monsters/maproom/MapRoom.as:53-56`)
 * over one view at a time, and a footer saying what you could send before you
 * pick anything. On a phone the list comes first (pins are small to tap) and
 * the card is a bottom sheet.
 *
 * Reports intent and shows what it is given; the scene owns the data.
 */

export type Mr1View = "map" | "list";

export interface MapRoom1UiHandlers {
  readonly onSceneSelect: (id: string) => void;
  readonly onSignOut: () => void;
  readonly onClose: () => void;
  readonly onView: (target: Mr1Target) => void;
  readonly onAttack: (target: Mr1Target) => void;
  readonly onAction: (action: CardAction) => void;
}

const PHONE_QUERY = "(width <= 620px)";

const isPhone = (): boolean =>
  typeof window !== "undefined" && window.matchMedia?.(PHONE_QUERY).matches === true;

/** The view the screen last showed, kept for the session (Flash kept it in `mrlv`). */
let lastView: Mr1View | null = null;

export class MapRoom1Ui {
  readonly notices = new Notices();

  private readonly hud: Hud;
  private readonly root: HTMLElement;
  private readonly levelChip: HTMLElement;
  private readonly phoneShield: HTMLElement;
  private readonly mapButton: HTMLButtonElement;
  private readonly listButton: HTMLButtonElement;
  private readonly mapView: Mr1MapView;
  private readonly listView: Mr1ListView;
  private readonly listPane: HTMLElement;
  private readonly side: HTMLElement;
  private readonly sheet: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly status: HTMLElement;

  private view: Mr1View;
  private world: Mr1World | null = null;
  private own: Mr1Own | null = null;
  private now = 0;
  private selected: string | null = null;
  private phone = isPhone();

  constructor(
    private readonly handlers: MapRoom1UiHandlers,
    activeScene: string,
    scenes: { id: string; label: string }[],
  ) {
    this.hud = new Hud({
      scenes,
      onSceneSelect: handlers.onSceneSelect,
      onSignOut: handlers.onSignOut,
      // The achievements screen docks over the side panel and a floating
      // card: the card goes first, as Map Room 2's cell panel does.
      onAchievementsOpen: () => this.select(null),
    });
    this.hud.setActiveScene(activeScene);

    this.view = lastView ?? (this.phone ? "list" : "map");

    this.root = el("div", "mr1");
    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-label", "Map Room");

    const header = el("header", "mr1__header");
    const close = button("btn btn--icon mr1__close");
    close.setAttribute("aria-label", "Close the Map Room");
    close.append(icon("close", 18));
    close.addEventListener("click", handlers.onClose);
    const title = el("h1", "mr1__title u-display", "Map Room");
    this.levelChip = el("span", "chip", "Level 1");
    const hint = el(
      "span",
      "mr1__hint",
      "Your neighbours and the wild monster tribes. Tap a pin to see it.",
    );
    this.phoneShield = el("span", "mr1__shield");
    this.phoneShield.hidden = true;
    const toggle = el("div", "mr1__toggle");
    toggle.setAttribute("role", "group");
    toggle.setAttribute("aria-label", "Show as");
    this.mapButton = button("mr1__toggle-button");
    this.mapButton.append(icon("map", 18), "Map");
    this.mapButton.addEventListener("click", () => this.setView("map"));
    this.listButton = button("mr1__toggle-button");
    this.listButton.append(icon("list", 18), "List");
    this.listButton.addEventListener("click", () => this.setView("list"));
    toggle.append(this.mapButton, this.listButton);
    header.append(
      close,
      title,
      this.levelChip,
      hint,
      el("div", "mr1__spacer"),
      this.phoneShield,
      toggle,
    );

    const body = el("div", "mr1__body");
    this.mapView = new Mr1MapView({ onSelect: (key) => this.select(key) });
    this.listView = new Mr1ListView({ onSelect: (key) => this.select(key, true) });
    this.side = el("aside", "mr1-side");
    this.side.setAttribute("aria-label", "Selected");
    this.listPane = el("div", "mr1-listpane");
    this.listPane.append(this.listView.element, this.side);
    this.status = el("p", "mr1__status", "Loading the map…");
    body.append(this.mapView.element, this.listPane, this.status);

    this.footer = el("footer", "mr1__footer");
    this.sheet = el("div", "mr1-sheet");
    this.sheet.hidden = true;

    this.root.append(header, body, this.footer);
    this.header = header;
    this.applyView();
    this.renderFooter();
  }

  /** The map's title row, for the tutorial's "?" (issue #227). */
  private header: HTMLElement | null = null;

  /** Tells the tutorial the map is on screen (issue #227): its scene calls it once the first answer is drawn. */
  announce(): void {
    guideBus.emit("mapOpened", { map: "mr1" });
    guideBus.emit("screen", { id: GuideScreen.MR1, root: this.root, header: this.header });
  }

  mount(container: HTMLElement): this {
    container.append(this.hud.element, this.root, this.sheet);
    this.notices.mount(container);
    this.notices.element.classList.add("mr1-notices");
    window.addEventListener("resize", this.onResize);
    this.mapView.measure();
    return this;
  }

  destroy(): void {
    window.removeEventListener("resize", this.onResize);
    this.mapView.destroy();
    this.hud.destroy();
    this.notices.destroy();
    this.root.remove();
    this.sheet.remove();
  }

  setResources(resources: Resources, credits?: number): void {
    this.hud.setResources(resources, credits);
  }

  /** Shows the "Loading…" or failure line in place of the views, or clears it. */
  setStatus(text: string | null): void {
    this.status.textContent = text ?? "";
    this.status.hidden = text === null;
  }

  setData(world: Mr1World, own: Mr1Own | null, now: number): void {
    this.world = world;
    this.own = own;
    this.now = now;
    this.mapView.setData(world, own, now);
    this.listView.setData(world, now);
    if (this.selected && !this.find(this.selected)) this.selected = null;
    this.renderSelection();
    this.renderFooter();
  }

  /** Once a second: counts every "back in m:ss" down without a rebuild. */
  tick(now: number): void {
    this.now = now;
    for (const span of [
      ...this.root.querySelectorAll<HTMLElement>("[data-until]"),
      ...this.sheet.querySelectorAll<HTMLElement>("[data-until]"),
    ]) {
      span.textContent = formatRespawn(Number(span.dataset["until"]) - now);
    }
  }

  private readonly onResize = (): void => {
    const phone = isPhone();
    if (phone !== this.phone) {
      this.phone = phone;
      this.renderSelection();
    }
    this.mapView.measure();
  };

  private setView(view: Mr1View): void {
    if (view === this.view) return;
    this.view = view;
    lastView = view;
    this.applyView();
    this.renderSelection();
    if (view === "map") {
      this.mapView.measure();
      if (this.selected) this.mapView.reveal(this.selected);
    }
  }

  private applyView(): void {
    const map = this.view === "map";
    this.mapView.element.hidden = !map;
    this.listPane.hidden = map;
    this.mapButton.setAttribute("aria-pressed", String(map));
    this.listButton.setAttribute("aria-pressed", String(!map));
    this.root.dataset["view"] = this.view;
  }

  private find(key: string): Mr1Target | null {
    const world = this.world;
    if (!world) return null;
    return (
      world.tribes.find((one) => one.key === key) ??
      world.neighbours.find((one) => one.key === key) ??
      null
    );
  }

  private select(key: string | null, fromList = false): void {
    this.selected = key;
    this.renderSelection();
    if (key && fromList && this.view === "map") this.mapView.reveal(key);
    const target = key ? this.find(key) : null;
    if (target) {
      guideBus.emit("targetPicked", { baseid: target.baseid, kind: target.kind === "tribe" ? "tribe" : "player" });
    }
  }

  /** Puts the selected target's card where this layout wants it. */
  private renderSelection(): void {
    const target = this.selected ? this.find(this.selected) : null;
    const world = this.world;
    this.listView.setSelected(target?.key ?? null);

    const achievements = this.hud.achievements;
    const card = (variant: "float" | "panel" | "sheet"): HTMLElement | null =>
      target && world
        ? targetCard(
            target,
            { world, own: this.own, now: this.now },
            {
              onClose: () => this.select(null),
              onView: this.handlers.onView,
              onAttack: this.handlers.onAttack,
              onAction: this.handlers.onAction,
              ...(achievements ? { achievementsLine: (neighbour: Mr1Neighbour) => this.achievementsLine(neighbour) } : {}),
            },
            variant,
          )
        : null;

    if (this.phone) {
      this.mapView.setSelected(target?.key ?? null, null);
      this.side.replaceChildren();
      const sheetCard = card("sheet");
      this.sheet.replaceChildren(...(sheetCard ? [sheetCard] : []));
      this.sheet.hidden = !sheetCard;
      this.root.classList.toggle("mr1--sheet-open", Boolean(sheetCard));
      return;
    }

    this.sheet.hidden = true;
    this.sheet.replaceChildren();
    this.root.classList.remove("mr1--sheet-open");
    if (this.view === "map") {
      this.mapView.setSelected(target?.key ?? null, card("float"));
      this.side.replaceChildren();
    } else {
      this.mapView.setSelected(target?.key ?? null, null);
      const panel = card("panel");
      this.side.replaceChildren(
        panel ?? el("p", "mr1-side__empty", "Pick a tribe or a neighbour to see it here."),
      );
    }
  }

  /**
   * A neighbour's achievements on their card (#204 WP7); tapping it opens
   * their read-only list beside the HUD.
   */
  private achievementsLine(neighbour: Mr1Neighbour): HTMLElement {
    return achievementsLine(neighbour.userid, neighbour.name, {
      onOpen: (userid, name, known) => void this.hud.achievements?.openPlayer(userid, name, known),
    });
  }

  /** "Ready to send", the Flinger and your protection, before any pick. */
  private renderFooter(): void {
    const own = this.own;
    const parts: HTMLElement[] = [el("span", "mr1__footer-label", "Ready to send")];
    const army = armyChips(own, "");
    if (army) {
      army.querySelector(".mr1-send__label")?.remove();
      parts.push(army);
    } else {
      parts.push(el("span", "mr1__footer-note", own ? "Housing is empty" : "…"));
    }

    const flinger = el("span", "mr1__footer-note");
    flinger.append(icon("flinger", 16));
    flinger.append(
      !own
        ? "Flinger"
        : own.flinger.state === "ready"
          ? `Flinger level ${own.flinger.level}`
          : own.flinger.state === "busy"
            ? own.flinger.why === "upgrading"
              ? "Flinger upgrading"
              : "Flinger damaged"
            : "No Flinger",
    );
    parts.push(flinger, el("div", "mr1__spacer"));

    const protectedUntil = Math.max(this.world?.protectedUntil ?? 0, own?.protectedUntil ?? 0);
    const left = protectedUntil - this.now;
    this.phoneShield.hidden = !(left > 0);
    this.phoneShield.replaceChildren();
    if (left > 0) {
      const note = el("span", "mr1-protection");
      note.append(icon("shield", 16, "mr1-icon mr1-protection__icon"));
      const words = el("span");
      words.append(
        el("strong", undefined, `You are protected for ${formatSpan(left)}.`),
        " Attacking a player ends it. Tribes do not.",
      );
      note.append(words);
      parts.push(note);
      this.phoneShield.append(icon("shield", 14), formatSpan(left));
      this.phoneShield.setAttribute("aria-label", `You are protected for ${formatSpan(left)}`);
    }
    this.footer.replaceChildren(...parts);
  }
}
