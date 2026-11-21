/**
 * DESIGN PROTOTYPE ONLY (b9 round 2, never merged): outpost arrows without a
 * yard name in the HUD (owner, 21 Nov 2026: the name plaque is "distracting
 * and lengthy"). `b9arrows=d|e|f`.
 *
 * - D: three discs, no words: Prev / where / Next above Map and Friends. The
 *   middle disc is a painted house (Main) or flag (an outpost) over "2/12".
 * - E: one capsule: `< house 2/12 >`, a single 46 px control.
 * - F (astra's Y): a small tile `flag 2/12` at rest; a tap swaps the dock for
 *   a travel bar with big Prev / All yards / Next and the yard's full name.
 */
import type { OwnYardEntry } from "@/game/yard/ownYards";
import { classicLook } from "@/game/classicLook";
import { gameIcon, gameIconUrl, type GameIconName } from "@/ui/gameIcon";
import "./b9-arrows-r2.css";

export type B9ArrowsR2Option = "d" | "e" | "f";

interface Hooks {
  readonly step: (direction: -1 | 1) => boolean;
  readonly openList: () => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const arrowArt = (direction: -1 | 1, px: number): HTMLImageElement => {
  const name = `friend${direction === 1 ? "next" : "prev"}${classicLook() ? "classic" : ""}` as GameIconName;
  const image = gameIcon(name, { size: 32, decorative: true, className: "b9r2-art" });
  const url64 = gameIconUrl(name, 64);
  image.srcset = [image.srcset, ...[96, 128].map((side) => `${url64.replace(/-64\.webp$/, `-${side}.webp`)} ${side}w`)].join(", ");
  image.sizes = `${px}px`;
  return image;
};

/** F's travel bar stays open from yard to yard (the dock is rebuilt on each). */
let travelOpen = new URLSearchParams(window.location.search).get("b9state") === "travel";

export class B9ArrowsR2 {
  private readonly prevs: HTMLButtonElement[] = [];
  private readonly nexts: HTMLButtonElement[] = [];
  private readonly wheres: HTMLElement[] = [];
  private readonly travel: HTMLElement | null = null;
  private readonly travelName = el("span", "b9r2-travel__name");
  private going = false;

  constructor(
    option: B9ArrowsR2Option,
    root: HTMLElement,
    private readonly hooks: Hooks,
  ) {
    document.documentElement.classList.add("b9-arrows-r2", `b9-arrows-${option}`);
    if (option === "d") {
      const row = el("div", "b9r2-discs");
      row.append(this.arrow(-1, "yard-dock__disc b9r2-disc", 34), this.whereDisc(), this.arrow(1, "yard-dock__disc b9r2-disc", 34));
      root.prepend(row);
    } else if (option === "e") {
      const pill = el("div", "b9r2-pill");
      pill.append(this.arrow(-1, "b9r2-pill__arrow", 30), this.whereChip("b9r2-pill__where", () => hooks.openList()), this.arrow(1, "b9r2-pill__arrow", 30));
      root.prepend(pill);
    } else {
      const tile = this.whereChip("b9r2-tile", () => this.setTravel(!travelOpen));
      root.prepend(tile);
      const bar = el("div", "b9r2-travel");
      const head = el("div", "b9r2-travel__head");
      const close = el("button", "b9r2-travel__close", "✕");
      close.type = "button";
      close.setAttribute("aria-label", "Close travel");
      close.addEventListener("click", () => this.setTravel(false));
      const where = el("span", "b9r2-where b9r2-travel__where");
      this.wheres.push(where);
      head.append(where, this.travelName, close);
      const row = el("div", "b9r2-travel__row");
      const all = el("button", "b9r2-travel__button");
      all.type = "button";
      all.setAttribute("aria-label", "All yards");
      const disc = el("span", "yard-dock__disc b9r2-travel__disc");
      disc.append(gameIcon("outpost", { size: 32, decorative: true, className: "b9r2-art" }), el("span", "b9r2-travel__list", "≡"));
      all.append(disc);
      all.addEventListener("click", () => hooks.openList());
      row.append(this.arrow(-1, "yard-dock__disc b9r2-travel__disc", 44, "b9r2-travel__button"), all, this.arrow(1, "yard-dock__disc b9r2-travel__disc", 44, "b9r2-travel__button"));
      bar.append(head, row);
      bar.hidden = !travelOpen;
      this.travel = bar;
      root.append(bar);
      document.documentElement.classList.toggle("b9-travel-open", travelOpen);
    }
  }

  render(entries: readonly OwnYardEntry[]): void {
    const at = Math.max(0, entries.findIndex((entry) => entry.current));
    const current = entries[at];
    this.going = false;
    for (const prev of this.prevs) prev.disabled = at <= 0;
    for (const next of this.nexts) next.disabled = at >= entries.length - 1;
    const main = !current || current.target.kind !== "outpost";
    for (const where of this.wheres) {
      where.replaceChildren(
        gameIcon(main ? "townhall" : "outpost", { size: 32, decorative: true, className: "b9r2-where__icon" }),
        el("span", `b9r2-where__count${where.closest(".b9r2-wheredisc") ? " yard-dock__label" : ""}`, `${at + 1}/${Math.max(1, entries.length)}`),
      );
    }
    this.travelName.textContent = current?.title ?? "";
  }

  private setTravel(open: boolean): void {
    travelOpen = open;
    if (this.travel) this.travel.hidden = !open;
    document.documentElement.classList.toggle("b9-travel-open", open);
  }

  private arrow(direction: -1 | 1, discClass: string, px: number, buttonClass = "b9r2-arrow"): HTMLButtonElement {
    const button = el("button", buttonClass);
    button.type = "button";
    button.setAttribute("aria-label", direction === 1 ? "Next yard" : "Previous yard");
    const disc = el("span", discClass);
    disc.append(arrowArt(direction, px));
    button.append(disc);
    button.addEventListener("click", () => {
      if (this.going || button.disabled) return;
      this.going = this.hooks.step(direction);
    });
    (direction === 1 ? this.nexts : this.prevs).push(button);
    return button;
  }

  /** D's middle: a dock disc with the house or flag, the place in the order on its plaque. */
  private whereDisc(): HTMLButtonElement {
    const button = el("button", "yard-dock__button b9r2-wheredisc");
    button.type = "button";
    button.setAttribute("aria-label", "Your yards");
    const where = el("span", "b9r2-where");
    this.wheres.push(where);
    button.append(where);
    button.addEventListener("click", () => this.hooks.openList());
    return button;
  }

  private whereChip(className: string, onTap: () => void): HTMLButtonElement {
    const button = el("button", `b9r2-where ${className}`);
    button.type = "button";
    button.setAttribute("aria-label", "Your yards");
    this.wheres.push(button);
    button.addEventListener("click", onTap);
    return button;
  }
}
