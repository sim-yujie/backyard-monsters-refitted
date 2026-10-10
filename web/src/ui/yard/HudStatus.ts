import { levelProgress, type LevelProgress } from "@/game/yard/experience";
import { SHOP_ITEMS, protectedUntil, shopOffer } from "@/game/yard/shop";
import type { YardStore, YardUiBinding } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown } from "@/ui/format";
import { Popup } from "@/ui/Popup";
import "@/ui/styles/yard-status.css";

/**
 * The small status strip under the yard's top bar (`UI2.as:254-300` protection,
 * `UI_TOP.as:396-404` experience, `UI_TOP.as:1191-1300` boosts): how long the
 * yard stays protected, the player's level with a bar to the next, and the
 * boosts that are running with the time they have left. A level gained while
 * the yard is open also opens a small "Level N" box (`BASE.as:4895-4912`).
 */

/** One running boost: a timed Shop item that is still going. */
export interface RunningBoost {
  readonly item: string;
  readonly name: string;
  readonly endsAt: number;
}

export interface HudStatusModel {
  /** Unix seconds the damage protection ends, or null when the yard has none. */
  readonly protectedUntil: number | null;
  /** Null from a server that sends no level or points. */
  readonly xp: LevelProgress | null;
  readonly boosts: readonly RunningBoost[];
}

/** Reads the strip from the store. */
export const hudStatusModel = (store: YardStore): HudStatusModel => {
  const level = store.playerLevel;
  const points = store.playerPoints;
  const boosts: RunningBoost[] = [];
  for (const item of SHOP_ITEMS) {
    // Protection has its own badge; a stacking item is never "running".
    if (item.seconds <= 0 || item.stacks) continue;
    const { state } = shopOffer(item, store);
    if (state.kind === "running") boosts.push({ item: item.item, name: item.name, endsAt: state.endsAt });
  }
  boosts.sort((a, b) => a.endsAt - b.endsAt);
  return {
    protectedUntil: protectedUntil(store),
    xp: level !== null && points !== null ? levelProgress(level, points) : null,
    boosts,
  };
};

/** "Protected 3d 4h". */
export const protectionBadgeText = (until: number, now: number): string =>
  `Protected ${formatCountdown(until - now)}`;

/** The XP bar's tooltip: "1,200 points. 2,300 more for level 4." */
export const xpTitle = (xp: LevelProgress): string =>
  xp.next === null
    ? `Level ${xp.level}, the top level. ${formatAmount(xp.points)} points.`
    : `Level ${xp.level}. ${formatAmount(xp.points)} points, ${formatAmount(Math.max(0, xp.next - xp.points))} more for level ${xp.level + 1}.`;

/** The level-up box's line. */
export const levelUpText = (level: number): string => `You reached level ${level}!`;

export class HudStatus {
  readonly element: HTMLElement;

  private readonly store: YardStore;
  private readonly modal: HTMLElement | undefined;
  private readonly badge: HTMLElement;
  private readonly xp: HTMLElement;
  private readonly xpLabel: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly boostList: HTMLElement;
  private readonly boostChips = new Map<string, HTMLElement>();
  private readonly unsubscribe: () => void;
  private readonly timer: ReturnType<typeof setInterval>;
  private shownLevel: number | null;
  private model: HudStatusModel;

  constructor(binding: YardUiBinding) {
    this.store = binding.store;
    this.modal = binding.modal;
    this.shownLevel = this.store.playerLevel;

    this.element = document.createElement("div");
    this.element.className = "hud-status";
    this.element.setAttribute("aria-label", "Yard status");

    this.badge = document.createElement("span");
    this.badge.className = "hud-status__badge";

    this.xp = document.createElement("span");
    this.xp.className = "hud-status__xp";
    this.xpLabel = document.createElement("span");
    this.xpLabel.className = "hud-status__level";
    const track = document.createElement("span");
    track.className = "hud-status__track";
    track.setAttribute("aria-hidden", "true");
    this.xpFill = document.createElement("span");
    this.xpFill.className = "hud-status__fill";
    track.append(this.xpFill);
    this.xp.append(this.xpLabel, track);

    this.boostList = document.createElement("ul");
    this.boostList.className = "hud-status__boosts";
    this.boostList.setAttribute("aria-label", "Running boosts");

    this.element.append(this.badge, this.xp, this.boostList);

    this.model = hudStatusModel(this.store);
    this.render();
    this.unsubscribe = this.store.subscribe(() => this.refresh());
    this.timer = setInterval(() => this.tick(), 1000);
  }

  destroy(): void {
    this.unsubscribe();
    clearInterval(this.timer);
    this.element.remove();
  }

  /** Re-reads the store: after any change. */
  private refresh(): void {
    this.model = hudStatusModel(this.store);
    const level = this.store.playerLevel;
    if (level !== null) {
      if (this.shownLevel !== null && level > this.shownLevel) this.announce(level);
      this.shownLevel = level;
    }
    this.render();
  }

  /** The clock moving on: the countdowns, and a boost or protection that ran out. */
  private tick(): void {
    const now = this.store.now();
    const { protectedUntil: until, boosts } = this.model;
    if ((until !== null && until <= now) || boosts.some((boost) => boost.endsAt <= now)) {
      this.model = hudStatusModel(this.store);
    }
    this.render();
  }

  private render(): void {
    const now = this.store.now();
    const { protectedUntil: until, xp, boosts } = this.model;

    this.badge.hidden = until === null;
    if (until !== null) {
      this.badge.textContent = protectionBadgeText(until, now);
      this.badge.title = "Other players cannot attack your yard while it is protected.";
    }

    this.xp.hidden = xp === null;
    if (xp) {
      this.xpLabel.textContent = `Level ${xp.level}`;
      this.xpFill.style.width = `${Math.round(xp.fraction * 100)}%`;
      this.xp.title = xpTitle(xp);
    }

    this.boostList.hidden = boosts.length === 0;
    for (const [item, chip] of this.boostChips) {
      if (!boosts.some((boost) => boost.item === item)) {
        chip.remove();
        this.boostChips.delete(item);
      }
    }
    for (const boost of boosts) {
      let chip = this.boostChips.get(boost.item);
      if (!chip) {
        chip = document.createElement("li");
        chip.className = "hud-status__boost";
        this.boostChips.set(boost.item, chip);
        this.boostList.append(chip);
      }
      const left = formatCountdown(boost.endsAt - now);
      chip.textContent = `${boost.name} ${left}`;
      chip.title = `${boost.name}: ${left} left`;
    }
    this.element.hidden = until === null && xp === null && boosts.length === 0;
  }

  /** The level-up box: one line and an OK. */
  private announce(level: number): void {
    const popup = new Popup({ title: "Level up!", className: "level-up" });
    const text = document.createElement("p");
    text.className = "level-up__text";
    text.textContent = levelUpText(level);
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "btn btn--primary";
    ok.textContent = "OK";
    ok.addEventListener("click", () => popup.close());
    popup.body.append(text, ok);
    popup.mount(this.modal ?? document.body);
  }
}
