import { waveName, type WaveStatus } from "@/api/waves";
import { coinAmount, coinWords } from "@/ui/events/coinUi";
import { gameIcon } from "@/ui/gameIcon";
import { el } from "@/ui/dom";
import { isPhoneLayout } from "@/ui/phoneLayout";
import "@/ui/styles/waves.css";
import { totemImage, waveMonsterImage, waveMonsterName } from "./waveArt";

/**
 * The wave event's bar on the own yard (beta 10, Wild Monster Invasion;
 * neon's direction A, 27 Nov 2026): a pill that names the next wave ("Wave
 * 7/30") and opens a tray with the wave's monsters, its prize and "Start
 * wave 7". On a computer or iPad it sits open in the bottom middle, between
 * Friends and Collect all; on a phone it sits closed at the top, between
 * Chat and Events, and opens downward, so the yard stays clear until asked.
 * The start is only in the tray, never on the pill, so a pan never calls a
 * wave by mistake.
 */

/** How many portraits the tray shows before "+N". */
export const HUD_PORTRAITS = 4;

const COLLAPSED_KEY = "bymr.waveHud.closed";

const readClosed = (): boolean | null => {
  try {
    const value = window.localStorage.getItem(COLLAPSED_KEY);
    return value === null ? null : value === "1";
  } catch {
    return null;
  }
};

const writeClosed = (closed: boolean): void => {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, closed ? "1" : "0");
  } catch {
    /* private mode: the default next time */
  }
};

export interface WaveHudOptions {
  /** "Start wave N". */
  readonly onStart: () => void;
}

/** Whether the bar sits at the top and its tray opens downwards (`waves.css`). */
const opensDown = (): boolean =>
  isPhoneLayout() || (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 1100px)").matches);

export class WaveHud {
  readonly element: HTMLElement;
  private readonly pill: HTMLButtonElement;
  private readonly tray: HTMLElement;
  private open: boolean;
  private status: WaveStatus | null = null;
  private busy = false;

  constructor(private readonly options: WaveHudOptions) {
    this.element = el("section", "wave-hud");
    this.element.setAttribute("aria-label", "Invasion waves");
    this.pill = el("button", "wave-hud__pill");
    this.pill.type = "button";
    this.pill.addEventListener("click", () => this.setOpen(!this.open));
    this.tray = el("div", "wave-hud__tray");
    this.tray.id = `wave-hud-tray-${Math.random().toString(36).slice(2, 8)}`;
    this.pill.setAttribute("aria-controls", this.tray.id);
    this.element.append(this.pill, this.tray);
    const saved = readClosed();
    // Open by default only on a computer; on a phone or iPad it sits at the top and starts closed.
    this.open = saved === null ? !opensDown() : !saved;
    // On a phone the open tray covers part of the top; a tap anywhere else closes it.
    this.outside = (event: PointerEvent) => {
      if (this.open && isPhoneLayout() && !this.element.contains(event.target as Node)) this.setOpen(false);
    };
    document.addEventListener("pointerdown", this.outside, true);
  }

  private readonly outside: (event: PointerEvent) => void;

  /** Hidden while a window or pop-up is over the yard, so its Start is never shown twice. */
  setCovered(covered: boolean): void {
    this.element.classList.toggle("wave-hud--covered", covered);
  }

  mount(host: HTMLElement): this {
    host.append(this.element);
    return this;
  }

  remove(): void {
    document.removeEventListener("pointerdown", this.outside, true);
    this.element.remove();
  }

  update(status: WaveStatus | null, busy = false): void {
    this.status = status;
    this.busy = busy;
    this.render();
  }

  private setOpen(open: boolean): void {
    this.open = open;
    writeClosed(!open);
    this.render();
  }

  private render(): void {
    const status = this.status;
    this.element.hidden = status === null;
    if (!status) return;
    const done = status.next === null;
    const bonus = status.next !== null && status.next >= status.firstBonusWave;
    this.element.classList.toggle("wave-hud--open", this.open);
    this.element.classList.toggle("wave-hud--bonus", bonus);
    this.element.classList.toggle("wave-hud--done", done);

    // The pill: the totem as it stands, the wave counter, the chevron.
    this.pill.replaceChildren(
      totemImage(status.totemType ?? 121, Math.max(1, status.totemLevel), `wave-hud__totem${status.totemLevel === 0 ? " wave-hud__totem--none" : ""}`),
      el("span", "wave-hud__label", done ? "All waves beaten" : waveName(status.next!, status.firstBonusWave)),
      // The tray opens downwards on a phone or iPad, upwards on a computer.
      el("span", "wave-hud__chevron", this.open === opensDown() ? "▴" : "▾"),
    );
    this.pill.setAttribute("aria-expanded", String(this.open));
    this.pill.setAttribute(
      "aria-label",
      `${status.title}: ${done ? "every wave beaten" : `next is wave ${status.next} of ${status.waves}`}. ${this.open ? "Hide" : "Show"} the wave.`,
    );
    this.tray.hidden = !this.open;
    if (!this.open) return;

    if (done) {
      this.tray.replaceChildren(el("p", "wave-hud__note", `${status.title}: all ${status.waves} waves beaten!`));
      return;
    }

    const monsters = el("ul", "wave-hud__monsters");
    if (bonus) {
      const secret = el("li", "wave-hud__monster wave-hud__monster--secret");
      secret.append(el("span", "wave-hud__secret", "?"), el("span", "wave-hud__count", "Secret"));
      secret.title = "Bonus wave: its monsters are a secret";
      monsters.append(secret);
    } else {
      for (const group of status.preview.slice(0, HUD_PORTRAITS)) {
        const item = el("li", "wave-hud__monster");
        item.title = `${group.count} ${waveMonsterName(group.monster)}`;
        item.append(waveMonsterImage(group.monster, "wave-hud__portrait"), el("span", "wave-hud__count", `×${group.count}`));
        monsters.append(item);
      }
      const more = status.preview.length - HUD_PORTRAITS;
      if (more > 0) monsters.append(el("li", "wave-hud__more", `+${more}`));
    }

    // The prize stands apart from the monsters and the button, so it never reads as a price.
    const prize = el("div", "wave-hud__prize");
    prize.title = "Prize for beating it";
    prize.append(gameIcon("gift", { size: 24, decorative: true, className: "wave-hud__prize-icon" }));
    if (status.prize && status.prize.glimmers > 0) {
      const coins = coinAmount(`+${status.prize.glimmers}`, { size: 24 });
      coins.setAttribute("aria-label", coinWords(status.prize.glimmers));
      prize.append(coins);
    }
    if (status.prize?.totemLevel && status.totemType) {
      const totem = el("span", "wave-hud__prize-totem");
      totem.append(totemImage(status.totemType, status.prize.totemLevel, "wave-hud__prize-totem-art"), el("span", "", `Lv ${status.prize.totemLevel}`));
      prize.append(totem);
    }

    const start = el("button", "btn btn--primary wave-hud__start");
    start.type = "button";
    start.append(gameIcon("swords", { size: 24, decorative: true, className: "wave-hud__start-icon" }), ` ${bonus ? "Start bonus" : `Start wave ${status.next}`}`);
    start.disabled = this.busy;
    start.addEventListener("click", () => this.options.onStart());

    const parts: HTMLElement[] = [monsters, prize, start];
    if (status.next === 1) parts.push(el("p", "wave-hud__hint", "No loot lost · Auto-repairs"));
    this.tray.replaceChildren(...parts);
  }
}
