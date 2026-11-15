import { guideRunning } from "@/game/announcements/announcementQueue";
import { SHOP_ITEMS, protectedUntil, shopOffer } from "@/game/yard/shop";
import type { YardStore, YardUiBinding } from "@/game/yard/YardStore";
import { formatCountdown } from "@/ui/format";
import { gameIcon, type GameIconName } from "@/ui/gameIcon";
import { Popup } from "@/ui/Popup";
import "@/ui/styles/yard-status.css";

/**
 * The small status strip under the yard's top bar (`UI2.as:254-300` protection,
 * `UI_TOP.as:1191-1300` boosts), the owner's option C (beta 8, 15 Nov 2026):
 * a painted shield with a short time ("3d") while the yard is protected, and
 * ONE painted boosts button with a count while Shop boosts run. Either opens
 * a small list under Bob's "?" (protection's exact time; each boost's name
 * and time), shut by a tap elsewhere or Escape. However many boosts run, the
 * strip stays two buttons wide.
 *
 * The level and its bar are on the account pill (`AccountMenu.setLevel`). A
 * level gained while the yard is open also opens a small "Level N" box
 * (`BASE.as:4895-4912`). While Bob's guided start runs the box waits, since
 * its scrim would cover the button Bob points at and his pane its OK; it
 * opens for the level reached once the guide is over or skipped.
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
    // Protection has its own shield; a stacking item is never "running".
    if (item.seconds <= 0 || item.stacks) continue;
    const { state } = shopOffer(item, store);
    // A boost that can be bought again while it runs (Tower Overdrive, the
    // monster buffs) is on sale, with the time it ends.
    const endsAt = state.kind === "running" ? state.endsAt : state.kind === "buy" ? state.endsAt : undefined;
    if (endsAt !== undefined) boosts.push({ item: item.item, name: item.name, endsAt });
  }
  boosts.sort((a, b) => a.endsAt - b.endsAt);
  return {
    protectedUntil: protectedUntil(store),
    boosts,
  };
};

/** The level-up box's line. */
export const levelUpText = (level: number): string => `You reached level ${level}!`;

/** "3d 4h" → "3d": the countdown's first unit, for the strip. */
export const shortTime = (seconds: number): string => formatCountdown(seconds).split(" ")[0] ?? "";

/** A painted icon per boost; the rest share Sharper Tools' (no own icon yet). */
const BOOST_ICONS: Readonly<Record<string, GameIconName>> = {
  POD: "overdrive",
  CLOD: "overdrive",
  HOD: "overdrive",
  HOD2: "overdrive",
  HOD3: "overdrive",
  TOD: "overdrive",
  MOD: "overdrive",
  MSOD: "speed",
  MDOD: "damage",
  EXH: "housing",
};
export const boostIcon = (item: string): GameIconName => BOOST_ICONS[item] ?? "tools";

/** The boosts button's picture. */
const BOOSTS_ICON: GameIconName = "overdrive";

/** What the list under the strip shows. */
type ListFor = "shield" | "boosts";

let nextId = 0;

export class HudStatus {
  readonly element: HTMLElement;

  private readonly store: YardStore;
  private readonly modal: HTMLElement | undefined;
  private readonly shield: HTMLButtonElement;
  private readonly shieldTime: HTMLElement;
  private readonly boostsButton: HTMLButtonElement;
  private readonly boostsCount: HTMLElement;
  private readonly list: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly unsubscribe: () => void;
  private readonly timer: ReturnType<typeof setInterval>;
  private shownLevel: number | null;
  /** A level gained while the guided start ran, announced once it is over. */
  private heldLevel: number | null = null;
  private model: HudStatusModel;
  /** Which list is open, or null. */
  private listFor: ListFor | null = null;
  /** The rows drawn last, as a key: the list is rebuilt only when it changes. */
  private rowsKey = "";

  private readonly onDocumentDown = (event: Event): void => {
    if (event.target instanceof Node && this.element.contains(event.target)) return;
    this.closeList();
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || this.listFor === null) return;
    const opener = this.listFor === "shield" ? this.shield : this.boostsButton;
    this.closeList();
    opener.focus();
  };

  constructor(binding: YardUiBinding) {
    this.store = binding.store;
    this.modal = binding.modal;
    this.shownLevel = this.store.playerLevel;
    const listId = `hud-status-list-${++nextId}`;

    this.element = document.createElement("div");
    this.element.className = "hud-status";
    this.element.setAttribute("aria-label", "Yard status");

    this.shieldTime = document.createElement("span");
    this.shieldTime.className = "hud-status__time";
    this.shield = this.chip("hud-status__shield", "shield", this.shieldTime, listId);
    this.shield.addEventListener("click", () => this.toggleList("shield"));

    this.boostsCount = document.createElement("span");
    this.boostsCount.className = "hud-status__count";
    this.boostsButton = this.chip("hud-status__boosts", BOOSTS_ICON, this.boostsCount, listId);
    this.boostsButton.addEventListener("click", () => this.toggleList("boosts"));

    this.list = document.createElement("div");
    this.list.className = "hud-status__list";
    this.list.id = listId;
    this.list.setAttribute("role", "group");
    this.list.hidden = true;
    this.rows = document.createElement("ul");
    this.rows.className = "hud-status__rows";
    this.list.append(this.rows);

    this.element.append(this.shield, this.boostsButton, this.list);

    this.model = hudStatusModel(this.store);
    this.render();
    this.unsubscribe = this.store.subscribe(() => this.refresh());
    this.timer = setInterval(() => this.tick(), 1000);
  }

  destroy(): void {
    this.closeList();
    this.unsubscribe();
    clearInterval(this.timer);
    this.element.remove();
  }

  /** Which list is open: "shield", "boosts" or null. */
  get openList(): ListFor | null {
    return this.listFor;
  }

  private chip(className: string, icon: GameIconName, value: HTMLElement, listId: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `hud-status__chip ${className}`;
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", listId);
    button.append(gameIcon(icon, { size: 24, decorative: true, className: "hud-status__icon" }), value);
    return button;
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

  toggleList(which: ListFor): void {
    if (this.listFor === which) {
      this.closeList();
      return;
    }
    const wasOpen = this.listFor !== null;
    this.listFor = which;
    this.shield.setAttribute("aria-expanded", String(which === "shield"));
    this.boostsButton.setAttribute("aria-expanded", String(which === "boosts"));
    this.list.setAttribute("aria-label", which === "shield" ? "Protection" : "Running boosts");
    this.list.hidden = false;
    this.rowsKey = "";
    if (!wasOpen) {
      document.addEventListener("pointerdown", this.onDocumentDown, true);
      document.addEventListener("keydown", this.onKey);
    }
    this.render();
  }

  closeList(): void {
    if (this.listFor === null) return;
    this.listFor = null;
    this.list.hidden = true;
    this.shield.setAttribute("aria-expanded", "false");
    this.boostsButton.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", this.onDocumentDown, true);
    document.removeEventListener("keydown", this.onKey);
  }

  private render(): void {
    const now = this.store.now();
    const { protectedUntil: until, boosts } = this.model;

    this.shield.hidden = until === null;
    if (until !== null) {
      const short = shortTime(until - now);
      if (this.shieldTime.textContent !== short) this.shieldTime.textContent = short;
      const full = `Protected ${formatCountdown(until - now)}`;
      if (this.shield.title !== full) {
        this.shield.title = full;
        this.shield.setAttribute("aria-label", full);
      }
    }

    this.boostsButton.hidden = boosts.length === 0;
    const count = String(boosts.length);
    if (this.boostsCount.textContent !== count) {
      this.boostsCount.textContent = count;
      this.boostsButton.setAttribute("aria-label", `${count} ${boosts.length === 1 ? "boost" : "boosts"} running`);
      this.boostsButton.title = boosts.map((boost) => boost.name).join(", ");
    }

    this.element.hidden = until === null && boosts.length === 0;
    if ((this.listFor === "shield" && until === null) || (this.listFor === "boosts" && boosts.length === 0)) {
      this.closeList();
    }
    if (this.listFor !== null) this.renderList(now);
  }

  /** The open list's rows: protection's exact time, or each boost's name and time. */
  private renderList(now: number): void {
    const { protectedUntil: until, boosts } = this.model;
    const entries: { key: string; icon: GameIconName; title: string; detail?: string; endsAt: number }[] =
      this.listFor === "shield"
        ? until === null
          ? []
          : [
              {
                key: "shield",
                icon: "shield",
                title: "Protected",
                detail: "Other players cannot attack your yard.",
                endsAt: until,
              },
            ]
        : boosts.map((boost) => ({ key: boost.item, icon: boostIcon(boost.item), title: boost.name, endsAt: boost.endsAt }));
    const key = entries.map((entry) => entry.key).join("|");
    if (key !== this.rowsKey) {
      this.rowsKey = key;
      this.rows.replaceChildren(
        ...entries.map((entry) => {
          const row = document.createElement("li");
          row.className = "hud-status__row";
          row.dataset["item"] = entry.key;
          const name = document.createElement("span");
          name.className = "hud-status__name";
          const title = document.createElement("span");
          title.className = "hud-status__title";
          title.textContent = entry.title;
          name.append(title);
          if (entry.detail) {
            const detail = document.createElement("small");
            detail.className = "hud-status__detail";
            detail.textContent = entry.detail;
            name.append(detail);
          }
          const left = document.createElement("span");
          left.className = "hud-status__left";
          row.append(gameIcon(entry.icon, { size: 24, decorative: true, className: "hud-status__icon" }), name, left);
          return row;
        }),
      );
    }
    entries.forEach((entry, index) => {
      const left = this.rows.children[index]?.querySelector(".hud-status__left");
      const text = formatCountdown(entry.endsAt - now);
      if (left && left.textContent !== text) left.textContent = text;
    });
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
