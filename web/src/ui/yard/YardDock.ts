import { tutTarget } from "@/game/guide/targets";
import {
  finishedMonstersJobs,
  finishedText,
  type FinishedMonstersJobs,
} from "@/game/monsters/finishedJobs";
import { stalledHatcheries } from "@/game/monsters/housing";
import type { OwnYardTarget } from "@/game/yard/ownYards";
import { YardChangeReason, type YardUiBinding } from "@/game/yard/YardStore";
import { formatAmount } from "@/ui/format";
import { icon, type IconName } from "@/ui/icons";
import { MonstersTabId } from "@/ui/monsters/monstersTab";
import "@/ui/styles/yard-hud.css";
import { CollectAll } from "./CollectAll";
import { YardSwitcher } from "./YardSwitcher";

/**
 * The yard's round buttons: the HUD redesign's "game corner" (#171, option B;
 * the owner: "It's a game, not a dashboard").
 *
 * Bottom right, under the right thumb: Build, large, in the accent; the
 * Collect all harvest bubble (`CollectAll`) above and left of it; Monsters
 * beside Build, with an amber badge for monsters waiting for room, or else a
 * cyan one for monster jobs finished since the player last looked
 * (`finishedJobs.ts`, #192); Layout above
 * Build. Bottom left, the ways out: Map, and above it the yard switcher
 * (`YardSwitcher`, #146) on the own yard or Home on a visit. A visit whose
 * gate passed has Attack in Build's place.
 *
 * Each is a real button with its word under the disc, so the word is its
 * name and part of what a finger can press; the tooltip says what it does.
 * The dock only draws and reports; the scene decides what a press does and
 * pushes back what changed (`setBuild`, `setLayout`, `setAttack`).
 *
 * Which buttons show follows the yard (`dockButtonsFor`): Collect all only on
 * the main yard, since an outpost banks by itself (`BUILDINGINFO.as:130-131`);
 * Kits only on an outpost, in Collect's place (the Starter Kits, #188; Flash
 * showed Kits on Map Room 2 outposts only, `UI_MENU.as:39-41`, `:100-101`);
 * Monsters wherever the scene can open the Monsters screen; the switcher once
 * an own yard is bound.
 */

/** Monsters' picture: a Pokey, the first monster every player has. */
const MONSTERS_ICON_URL = "/assets/monsters/C1-small.png";

export interface YardDockOptions {
  /** Map: the way to the world. */
  readonly onMap: () => void;
  /** Layout: the planner, opened or closed. */
  readonly onLayout: () => void;
  /** Build: the own yard only. */
  readonly onBuild?: () => void;
  /** Attack: a visit whose gate passed. */
  readonly onAttack?: () => void;
  /** Home: a visit's way back to the player's own yard. */
  readonly onHome?: () => void;
  /** The yard switcher's pick: the own yard only. */
  readonly onYardSelect?: (target: OwnYardTarget) => void;
  /** Kits: the Starter Kit picker, on an own outpost only. */
  readonly onKits?: () => void;
  /** The finished monster jobs to count; the tab's own by default. */
  readonly finished?: FinishedMonstersJobs;
}

/** Which of the dock's optional buttons show. Map and Layout always do. */
export interface DockButtons {
  readonly build: boolean;
  readonly collect: boolean;
  readonly kits: boolean;
  readonly monsters: boolean;
  readonly switcher: boolean;
  readonly home: boolean;
  readonly attack: boolean;
}

/**
 * The buttons a yard shows: the scene's options say which exist at all, the
 * binding (null on a visit and before the load) whether the own yard's show.
 */
export const dockButtonsFor = (
  options: Pick<YardDockOptions, "onBuild" | "onAttack" | "onHome" | "onYardSelect" | "onKits">,
  binding: Pick<YardUiBinding, "store" | "scene"> | null,
): DockButtons => ({
  build: options.onBuild !== undefined,
  collect: binding !== null && binding.store.kind !== "outpost",
  kits: binding !== null && binding.store.kind === "outpost" && options.onKits !== undefined,
  monsters: binding?.scene.openMonsters !== undefined,
  switcher: binding !== null && options.onYardSelect !== undefined,
  home: options.onHome !== undefined,
  attack: options.onAttack !== undefined,
});

/** "2 monsters are waiting for room", the Monsters badge's tooltip. */
export const waitingText = (count: number): string =>
  count === 1 ? "1 monster is waiting for room" : `${formatAmount(count)} monsters are waiting for room`;

/** How the Build button reads (`setBuild`). */
export interface BuildState {
  readonly disabled: boolean;
  /** A new building is in hand: the button puts it down. */
  readonly carrying: boolean;
  /** The Build window is open, or a building is in hand. */
  readonly open: boolean;
}

/** How the Layout button reads (`setLayout`). */
export interface LayoutState {
  readonly disabled: boolean;
  /** The planner is open. */
  readonly open: boolean;
  /** "Layout", or "View layout" where it opens read-only. */
  readonly label: string;
  /** Its tooltip: what it does, or what would unlock it. */
  readonly title: string;
}

interface RoundButton {
  readonly element: HTMLButtonElement;
  readonly disc: HTMLElement;
  readonly label: HTMLElement;
}

const roundButton = (
  name: string,
  label: string,
  art: SVGSVGElement | HTMLElement,
  onClick: () => void,
): RoundButton => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `yard-dock__button yard-dock__button--${name}`;
  element.dataset["dock"] = name;
  // `dock-build`, `dock-map`, … for Bob's pointer (issue #227).
  tutTarget(element, `dock-${name}`);
  const disc = document.createElement("span");
  disc.className = "yard-dock__disc";
  disc.append(art);
  const text = document.createElement("span");
  text.className = "yard-dock__label";
  text.textContent = label;
  element.append(disc, text);
  element.addEventListener("click", onClick);
  return { element, disc, label: text };
};

/**
 * A round dock button like the dock's own, for a package that adds one
 * (the tutorial's Goals button, issue #227): put it in with
 * `YardDock.placeBesideMonsters`. Tagged `dock-<name>` for Bob's pointer;
 * `disc` takes a badge.
 */
export const dockButton = (
  name: string,
  label: string,
  art: SVGSVGElement | HTMLElement,
  onClick: () => void,
): { element: HTMLButtonElement; disc: HTMLElement } => {
  const { element, disc } = roundButton(name, label, art, onClick);
  return { element, disc };
};

const iconButton = (
  name: string,
  label: string,
  iconName: IconName,
  size: number,
  onClick: () => void,
): RoundButton => roundButton(name, label, icon(iconName, size), onClick);

export class YardDock {
  readonly element: HTMLElement;

  private readonly options: YardDockOptions;
  private readonly map: RoundButton;
  private readonly home: RoundButton | null;
  private readonly layout: RoundButton;
  private readonly build: RoundButton | null;
  private readonly attack: RoundButton | null;
  private readonly monsters: RoundButton;
  private readonly kits: RoundButton | null;
  private readonly monstersBadge: HTMLElement;
  private readonly collect = new CollectAll();
  private readonly switcher: YardSwitcher | null;
  private binding: YardUiBinding | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly finished: FinishedMonstersJobs;
  private readonly unsubscribeFinished: () => void;

  constructor(options: YardDockOptions) {
    this.options = options;
    this.finished = options.finished ?? finishedMonstersJobs;
    this.element = document.createElement("div");
    this.element.className = "yard-dock";

    const left = document.createElement("nav");
    left.className = "yard-dock__left";
    left.setAttribute("aria-label", "Places");
    const right = document.createElement("div");
    right.className = "yard-dock__right";
    right.setAttribute("role", "group");
    right.setAttribute("aria-label", "Yard actions");

    this.map = iconButton("map", "Map", "map", 29, () => options.onMap());
    this.map.element.title = "The world map";
    this.home = options.onHome
      ? iconButton("home", "Home", "home", 29, () => options.onHome?.())
      : null;
    if (this.home) this.home.element.title = "Back to your own yard";
    this.switcher = options.onYardSelect ? new YardSwitcher({ onSelect: options.onYardSelect }) : null;
    left.append(
      ...(this.switcher ? [this.switcher.element] : []),
      ...(this.home ? [this.home.element] : []),
      this.map.element,
    );

    this.layout = iconButton("layout", "Layout", "layout", 29, () => options.onLayout());
    this.layout.element.setAttribute("aria-pressed", "false");

    const picture = document.createElement("img");
    picture.className = "yard-dock__picture";
    picture.src = MONSTERS_ICON_URL;
    picture.alt = "";
    picture.decoding = "async";
    this.monsters = roundButton("monsters", "Monsters", picture, () =>
      this.binding?.scene.openMonsters?.(MonstersTabId.UNLOCK),
    );
    this.monsters.element.title = "Monsters: unlock, hatch and house your monsters";
    this.monstersBadge = document.createElement("span");
    this.monstersBadge.className = "yard-dock__badge yard-dock__badge--warning";
    this.monstersBadge.hidden = true;
    this.monsters.disc.append(this.monstersBadge);

    this.build = options.onBuild
      ? iconButton("build", "Build", "build", 39, () => options.onBuild?.())
      : null;
    if (this.build) {
      this.build.element.classList.add("yard-dock__button--big");
      this.build.element.title = "Build something new";
      this.build.element.setAttribute("aria-expanded", "false");
      this.build.element.disabled = true;
    }
    this.attack = options.onAttack
      ? iconButton("attack", "Attack", "attack", 37, () => options.onAttack?.())
      : null;
    if (this.attack) {
      this.attack.element.classList.add("yard-dock__button--big");
      this.attack.element.disabled = true;
    }

    this.kits = options.onKits
      ? iconButton("kits", "Kits", "kits", 29, () => options.onKits?.())
      : null;
    if (this.kits) {
      this.kits.element.title = "Starter Kits: fill this outpost with a ready-made layout";
      this.kits.element.hidden = true;
    }

    right.append(
      this.collect.element,
      ...(this.kits ? [this.kits.element] : []),
      this.layout.element,
      this.monsters.element,
      ...(this.build ? [this.build.element] : []),
      ...(this.attack ? [this.attack.element] : []),
    );
    this.element.append(left, right);
    this.unsubscribeFinished = this.finished.subscribe(() => this.refreshBadge());
    this.bind(null);
  }

  /** Which optional buttons are on show now. */
  get shown(): DockButtons {
    return dockButtonsFor(this.options, this.binding);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  /**
   * The own yard's binding, or null (a visit, or before the load answers).
   * Collect all, Monsters and the switcher follow it; the dock listens to
   * its store for the bubble and the Monsters badge.
   */
  bind(binding: YardUiBinding | null): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.binding = binding;
    const shown = dockButtonsFor(this.options, binding);
    this.collect.bind(shown.collect ? binding : null);
    this.switcher?.bind(shown.switcher ? binding : null);
    this.monsters.element.hidden = !shown.monsters;
    if (this.kits) this.kits.element.hidden = !shown.kits;
    if (binding) {
      this.unsubscribe = binding.store.subscribe((change) => {
        this.collect.refresh();
        if (change.reason !== YardChangeReason.PENDING) this.refreshBadge();
      });
    }
    this.refreshBadge();
  }

  setBuild(state: BuildState): void {
    const build = this.build;
    if (!build) return;
    build.element.disabled = state.disabled;
    build.element.setAttribute("aria-expanded", String(state.open));
    build.element.classList.toggle("yard-dock__button--on", state.open);
    const word = state.carrying ? "Stop" : "Build";
    if (build.label.textContent !== word) {
      build.label.textContent = word;
      build.disc.replaceChildren(icon(state.carrying ? "close" : "build", state.carrying ? 34 : 39));
    }
    build.element.title = state.carrying
      ? "Put the building down without building it (Esc)"
      : "Build something new";
  }

  setLayout(state: LayoutState): void {
    const layout = this.layout.element;
    this.layout.label.textContent = state.label;
    layout.disabled = state.disabled;
    layout.title = state.title;
    // A disabled control's `title` is not announced by every screen reader,
    // and the locked state's whole point is to say what would unlock it.
    layout.setAttribute("aria-label", `${state.label}. ${state.title}`);
    layout.setAttribute("aria-pressed", String(state.open));
  }

  setAttack(state: { readonly disabled: boolean; readonly title: string }): void {
    if (!this.attack) return;
    this.attack.element.disabled = state.disabled;
    this.attack.element.title = state.title;
  }

  /** Puts a button another part of the scene owns beside Monsters: the Mail button (#193). */
  placeBesideMonsters(element: HTMLElement): void {
    this.monsters.element.after(element);
  }

  destroy(): void {
    this.unsubscribeFinished();
    this.bind(null);
    this.collect.destroy();
    this.switcher?.destroy();
    this.element.remove();
  }

  /**
   * The Monsters badge: hatched monsters waiting for room (amber, #169), or,
   * when none are, the monster jobs finished since the player last opened
   * the screen (cyan, #192). The amber one is the one to act on, so it wins.
   */
  private refreshBadge(): void {
    const store = this.binding?.store;
    const waiting = store ? stalledHatcheries(store.save) : 0;
    const finished = store && waiting <= 0 ? this.finished.value : 0;
    const count = waiting > 0 ? waiting : finished;
    const text = waiting > 0 ? waitingText(waiting) : finished > 0 ? finishedText(finished) : null;
    this.monstersBadge.hidden = count <= 0;
    this.monstersBadge.textContent = count > 0 ? formatAmount(count) : "";
    this.monstersBadge.classList.toggle("yard-dock__badge--warning", waiting > 0);
    this.monstersBadge.classList.toggle("yard-dock__badge--finished", waiting <= 0 && finished > 0);
    const monsters = this.monsters.element;
    monsters.title = text ? `Monsters: ${text}` : "Monsters: unlock, hatch and house your monsters";
    monsters.setAttribute("aria-label", text ? `Monsters. ${text}` : "Monsters");
  }
}
