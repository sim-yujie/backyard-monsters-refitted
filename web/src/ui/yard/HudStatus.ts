import { guideRunning } from "@/game/announcements/announcementQueue";
import { SHOP_ITEMS, protectedUntil, shopOffer } from "@/game/yard/shop";
import type { YardStore, YardUiBinding } from "@/game/yard/YardStore";
import { formatCountdown } from "@/ui/format";
import { Popup } from "@/ui/Popup";
import "@/ui/styles/yard-status.css";

/**
 * The small status strip under the yard's top bar (`UI2.as:254-300` protection,
 * `UI_TOP.as:1191-1300` boosts): how long the yard stays protected and the
 * boosts that are running with the time they have left. The level and its bar
 * are on the account pill (`AccountMenu.setLevel`). A level gained while
 * the yard is open also opens a small "Level N" box (`BASE.as:4895-4912`).
 * While Bob's guided start runs the box waits, since its scrim would cover the
 * button Bob points at and his pane its OK; it opens for the level reached
 * once the guide is over or skipped.
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
  readonly boosts: readonly RunningBoost[];
}

/** Reads the strip from the store. */
export const hudStatusModel = (store: YardStore): HudStatusModel => {
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
    boosts,
  };
};

/** "Protected 3d 4h". */
export const protectionBadgeText = (until: number, now: number): string =>
  `Protected ${formatCountdown(until - now)}`;

/** The level-up box's line. */
export const levelUpText = (level: number): string => `You reached level ${level}!`;

export class HudStatus {
  readonly element: HTMLElement;

  private readonly store: YardStore;
  private readonly modal: HTMLElement | undefined;
  private readonly badge: HTMLElement;
  private readonly boostList: HTMLElement;
  private readonly boostChips = new Map<string, HTMLElement>();
  private readonly unsubscribe: () => void;
  private readonly timer: ReturnType<typeof setInterval>;
  private shownLevel: number | null;
  /** A level gained while the guided start ran, announced once it is over. */
  private heldLevel: number | null = null;
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

    this.boostList = document.createElement("ul");
    this.boostList.className = "hud-status__boosts";
    this.boostList.setAttribute("aria-label", "Running boosts");

    this.element.append(this.badge, this.boostList);

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
      if (this.shownLevel !== null && level > this.shownLevel) this.heldLevel = level;
      this.shownLevel = level;
    }
    this.releaseLevelUp();
    this.render();
  }

  /** Opens the waiting level-up box, unless the guided start still has the yard. */
  private releaseLevelUp(): void {
    if (this.heldLevel === null || guideRunning(this.store.save.onboarding?.guide.state)) return;
    const level = this.heldLevel;
    this.heldLevel = null;
    this.announce(level);
  }

  /** The clock moving on: the countdowns, and a boost or protection that ran out. */
  private tick(): void {
    const now = this.store.now();
    const { protectedUntil: until, boosts } = this.model;
    if ((until !== null && until <= now) || boosts.some((boost) => boost.endsAt <= now)) {
      this.model = hudStatusModel(this.store);
    }
    this.releaseLevelUp();
    this.render();
  }

  private render(): void {
    const now = this.store.now();
    const { protectedUntil: until, boosts } = this.model;

    this.badge.hidden = until === null;
    if (until !== null) {
      this.badge.textContent = protectionBadgeText(until, now);
      this.badge.title = "Other players cannot attack your yard while it is protected.";
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
    this.element.hidden = until === null && boosts.length === 0;
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
