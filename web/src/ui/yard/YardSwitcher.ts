import { tutTarget, TutTarget } from "@/game/guide/targets";
import {
  outpostCountText,
  outpostsOf,
  ownYardsOf,
  yardTitle,
  type OwnYardEntry,
  type OwnYardTarget,
} from "@/game/yard/ownYards";
import type { YardUiBinding } from "@/game/yard/YardStore";
import { icon } from "@/ui/icons";
import "@/ui/styles/yard-switcher.css";

/**
 * The HUD's yard switcher (outposts WP5, #146): which of the player's yards is
 * open, how many outposts they hold, and a short menu of every yard, the main
 * yard first, that opens the one picked.
 *
 * Flash had an outpost counter with a single "next" arrow that walked main,
 * outpost 1, …, main (`client/scripts/UI_TOP.as:163-168`, `:826-832`;
 * `client/scripts/BASE.as:4658-4697`). A list says where each step goes
 * before it is taken, and reaches any yard in one step.
 *
 * Built like the Account menu (`AccountMenu.ts`): it only reports the yard
 * picked, and a press elsewhere or Escape closes it. It shows only while an
 * own yard is bound. Since the HUD redesign (#171) it is one of the yard's
 * round buttons (`YardDock.ts`), above Map: a flag with the outpost count as
 * a badge, the open yard's title under it, and the list opening upwards.
 */

export interface YardSwitcherOptions {
  /** A yard other than the open one was picked. */
  readonly onSelect: (target: OwnYardTarget) => void;
}

export class YardSwitcher {
  /** The button and the list, in one wrapper the list hangs from. */
  readonly element: HTMLElement;

  private readonly button: HTMLButtonElement;
  private readonly title: HTMLElement;
  private readonly count: HTMLElement;
  private readonly list: HTMLElement;
  private readonly onSelect: YardSwitcherOptions["onSelect"];
  private binding: YardUiBinding | null = null;

  constructor(options: YardSwitcherOptions) {
    this.onSelect = options.onSelect;

    this.element = document.createElement("div");
    this.element.className = "yard-switcher";
    this.element.hidden = true;

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "yard-dock__button yard-switcher__button";
    tutTarget(this.button, TutTarget.YARD_SWITCHER);
    this.button.setAttribute("aria-haspopup", "true");
    this.button.setAttribute("aria-expanded", "false");
    const disc = document.createElement("span");
    disc.className = "yard-dock__disc";
    this.count = document.createElement("span");
    this.count.className = "yard-dock__badge yard-switcher__count";
    disc.append(icon("yards", 27), this.count);
    this.title = document.createElement("span");
    this.title.className = "yard-dock__label yard-switcher__title";
    this.button.append(disc, this.title);
    this.button.addEventListener("click", () => this.toggle(this.list.hidden));

    this.list = document.createElement("div");
    this.list.className = "yard-switcher__list";
    this.list.setAttribute("role", "menu");
    this.list.setAttribute("aria-label", "Your yards");
    this.list.hidden = true;

    this.element.append(this.button, this.list);
    document.addEventListener("pointerdown", this.dismiss, true);
    document.addEventListener("keydown", this.dismiss, true);
  }

  get open(): boolean {
    return !this.list.hidden;
  }

  /** Every yard the menu lists, the open one marked; empty while unbound. */
  get entries(): OwnYardEntry[] {
    const store = this.binding?.store;
    return store ? ownYardsOf(store.save, store.target) : [];
  }

  /** The own yard's binding, or null to hide the switcher (the map, a visit). */
  bind(binding: YardUiBinding | null): void {
    this.binding = binding;
    this.toggle(false);
    this.render();
  }

  destroy(): void {
    document.removeEventListener("pointerdown", this.dismiss, true);
    document.removeEventListener("keydown", this.dismiss, true);
    this.element.remove();
  }

  private render(): void {
    const store = this.binding?.store;
    this.element.hidden = !store;
    if (!store) return;

    const title = yardTitle(store.target);
    const outposts = outpostsOf(store.save).length;
    const countText = outpostCountText(outposts);
    this.title.textContent = title;
    this.count.textContent = String(outposts);
    this.count.hidden = outposts <= 0;
    this.button.title = `${title}. ${countText}. Switch to another of your yards.`;
    this.button.setAttribute("aria-label", `Your yards: ${title}, ${countText}`);

    const heading = document.createElement("div");
    heading.className = "yard-switcher__heading";
    heading.textContent = `Your yards · ${countText}`;
    this.list.replaceChildren(heading, ...this.entries.map((entry) => this.item(entry)));
  }

  private item(entry: OwnYardEntry): HTMLButtonElement {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "btn btn--ghost yard-switcher__item";
    item.setAttribute("role", "menuitem");
    item.textContent = entry.title;
    if (entry.current) {
      item.setAttribute("aria-current", "true");
      item.title = "You are here";
    }
    item.addEventListener("click", () => {
      this.toggle(false);
      if (!entry.current) this.onSelect(entry.target);
    });
    return item;
  }

  private toggle(open: boolean): void {
    this.list.hidden = !open;
    this.button.setAttribute("aria-expanded", String(open));
  }

  /** A press anywhere else, or Escape, closes the list. */
  private readonly dismiss = (event: Event): void => {
    if (this.list.hidden) return;
    if (event instanceof KeyboardEvent) {
      if (event.key !== "Escape") return;
      this.toggle(false);
      this.button.focus();
      return;
    }
    if (event.target instanceof Node && this.element.contains(event.target)) return;
    this.toggle(false);
  };
}
