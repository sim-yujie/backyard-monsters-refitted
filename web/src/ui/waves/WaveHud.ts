import { waveName, type WaveStatus } from "@/api/waves";
import { waveCounter } from "@/game/waves/waveText";
import { coinAmount, coinWords } from "@/ui/events/coinUi";
import { gameIcon } from "@/ui/gameIcon";
import { el } from "@/ui/dom";
import { isPhoneLayout } from "@/ui/phoneLayout";
import "@/ui/styles/waves.css";
import { totemImage, waveMonsterImage, waveMonsterName } from "./waveArt";

/**
 * The wave event's bar on the own yard (beta 10, Wild Monster Invasion).
 *
 * Two of neon's directions, side by side until the owner picks one (27 Nov
 * 2026); `?wavebar=b` shows B, anything else A:
 *
 * - **A, the dock bar** (neon's pick): on a computer, one painted bar in the
 *   bottom middle between Friends and Collect all, open by default: the
 *   wave's tag, its monsters, the prize, "Start wave 7" and a chevron that
 *   folds it to a pill. On an iPad or a phone on its side the same bar sits
 *   under the top bar and starts folded. On an upright phone a pill sits at
 *   the top between Chat and Events and opens a tray below them, over a dim.
 * - **B, the tactical strip**: on a computer or iPad, always open in the top
 *   middle under the resources; on a phone a tab on the left edge slides
 *   out a drawer.
 *
 * The start is only in the open bar, never on the pill or tab, so a pan never
 * calls a wave by mistake.
 */

/** How many portraits the bar shows before "+N". */
export const HUD_PORTRAITS = 4;

export type WaveBarDirection = "a" | "b";

/** The direction this page shows: `?wavebar=b` for B, otherwise A. */
export const waveBarDirection = (search: string = typeof location === "undefined" ? "" : location.search): WaveBarDirection => {
  try {
    return new URLSearchParams(search).get("wavebar")?.toLowerCase() === "b" ? "b" : "a";
  } catch {
    return "a";
  }
};

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
  /** Which direction to draw; the page's `?wavebar=` when absent. */
  readonly direction?: WaveBarDirection;
}

/** A computer's screen: the bar's roomy places (`waves.css`'s queries). */
const roomy = (): boolean =>
  !isPhoneLayout() && (typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 1100px)").matches);

/** "Wave 7/30" on the plaque, "Bonus 1/2" on the bonus waves. */
const tagWords = (status: WaveStatus, wave: number): string =>
  wave >= status.firstBonusWave
    ? `Bonus ${wave - status.firstBonusWave + 1}/${status.waves - status.firstBonusWave + 1}`
    : `Wave ${waveCounter(wave, status.firstBonusWave)}`;

export class WaveHud {
  readonly element: HTMLElement;
  readonly direction: WaveBarDirection;
  private readonly pill: HTMLButtonElement;
  private readonly tray: HTMLElement;
  private open: boolean;
  private status: WaveStatus | null = null;
  private busy = false;

  constructor(private readonly options: WaveHudOptions) {
    this.direction = options.direction ?? waveBarDirection();
    this.element = el("section", `wave-hud wave-hud--${this.direction}`);
    this.element.setAttribute("aria-label", "Invasion waves");
    this.pill = el("button", "wave-hud__pill");
    this.pill.type = "button";
    this.pill.addEventListener("click", () => this.setOpen(!this.open));
    this.tray = el("div", "wave-hud__tray");
    this.tray.id = `wave-hud-tray-${Math.random().toString(36).slice(2, 8)}`;
    this.pill.setAttribute("aria-controls", this.tray.id);
    this.element.append(this.pill, this.tray);
    const saved = readClosed();
    // Open by default only on a computer; on a phone or iPad it starts folded.
    this.open = saved === null ? roomy() : !saved;
    // On a phone the open bar covers part of the yard; a tap anywhere else folds it.
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

  /** B on a computer or iPad never folds: it is the always-ready strip. */
  private get pinned(): boolean {
    return this.direction === "b" && !isPhoneLayout();
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
    const open = this.open || this.pinned;
    const done = status.next === null;
    const bonus = status.next !== null && status.next >= status.firstBonusWave;
    this.element.classList.toggle("wave-hud--open", open);
    this.element.classList.toggle("wave-hud--bonus", bonus);
    this.element.classList.toggle("wave-hud--done", done);

    const totem = (): HTMLImageElement =>
      totemImage(
        status.totemType ?? 121,
        Math.max(1, status.totemLevel),
        `wave-hud__totem${status.totemLevel === 0 ? " wave-hud__totem--none" : ""}`,
      );
    const prizeCoins = (size: 16 | 24): HTMLElement | null => {
      if (!status.prize || status.prize.glimmers <= 0) return null;
      const coins = coinAmount(`+${status.prize.glimmers}`, { size });
      coins.setAttribute("aria-label", coinWords(status.prize.glimmers));
      return coins;
    };

    const shortWords = done ? "" : bonus ? `B${status.next! - status.firstBonusWave + 1}` : `W${status.next}`;
    // The pill (folded), or B's tab on a phone: the totem, the wave, its prize, the chevron.
    const label = el("span", "wave-hud__label");
    if (done) label.textContent = "All waves beaten";
    else {
      label.append(
        el("span", "wave-hud__label-long", tagWords(status, status.next!)),
        el("span", "wave-hud__label-short", shortWords),
      );
    }
    const pillParts: HTMLElement[] = [totem(), label];
    const pillCoins = done ? null : prizeCoins(16);
    if (pillCoins) {
      const prize = el("span", "wave-hud__pill-prize");
      prize.append(pillCoins);
      pillParts.push(prize);
    }
    pillParts.push(el("span", "wave-hud__chevron"));
    this.pill.replaceChildren(...pillParts);
    this.pill.setAttribute("aria-expanded", String(open));
    this.pill.setAttribute(
      "aria-label",
      `${status.title}: ${done ? "every wave beaten" : `next is ${waveName(status.next!, status.firstBonusWave).toLowerCase()} of ${status.firstBonusWave - 1}`}. ${open ? "Hide" : "Show"} the wave.`,
    );
    this.tray.hidden = !open;
    if (!open) return;

    // The tag at the head of the open bar: the totem and the wave on the style's plaque.
    const tag = el("div", "wave-hud__tag");
    const plaque = el("span", "wave-hud__plaque");
    if (done) plaque.textContent = "All beaten";
    else plaque.append(el("span", "wave-hud__label-long", tagWords(status, status.next!)), el("span", "wave-hud__label-short", shortWords));
    tag.append(totem(), plaque);

    // The fold, at the end of the open bar (A) or the drawer (B on a phone).
    const fold = el("button", "wave-hud__fold");
    fold.type = "button";
    fold.setAttribute("aria-label", "Hide the wave");
    fold.setAttribute("aria-controls", this.tray.id);
    fold.addEventListener("click", () => this.setOpen(false));

    if (done) {
      this.tray.replaceChildren(tag, el("p", "wave-hud__note", `All ${status.waves} waves beaten!`), ...(this.pinned ? [] : [fold]));
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

    // The prize on its own dark inset, after a divider, so it never reads as a price.
    const prize = el("div", "wave-hud__prize");
    prize.title = "Prize for beating it";
    prize.append(gameIcon("gift", { size: 24, decorative: true, className: "wave-hud__prize-icon" }));
    const coins = prizeCoins(24);
    if (coins) prize.append(coins);
    if (status.prize?.totemLevel && status.totemType) {
      const prizeTotem = el("span", "wave-hud__prize-totem");
      prizeTotem.append(totemImage(status.totemType, status.prize.totemLevel, "wave-hud__prize-totem-art"), el("span", "", `Lv ${status.prize.totemLevel}`));
      prize.append(prizeTotem);
    }

    const start = el("button", "btn btn--primary wave-hud__start");
    start.type = "button";
    // "Start wave 9"; just "Start" where the bar is narrow and the plaque already names the wave.
    start.append(
      gameIcon("swords", { size: 24, decorative: true, className: "wave-hud__start-icon" }),
      el("span", "wave-hud__start-long", ` ${bonus ? "Start bonus" : `Start wave ${status.next}`}`),
      el("span", "wave-hud__start-short", " Start"),
    );
    start.setAttribute("aria-label", bonus ? "Start the bonus wave" : `Start wave ${status.next}`);
    start.disabled = this.busy;
    start.addEventListener("click", () => this.options.onStart());

    const parts: HTMLElement[] = [tag, monsters, el("span", "wave-hud__divider"), prize, start];
    if (!this.pinned) parts.push(fold);
    // B's drawer on a phone breaks its two rows here (`waves.css`).
    parts.push(el("span", "wave-hud__break"));
    if (status.next === 1) parts.push(el("p", "wave-hud__hint", "No loot lost · Auto-repairs"));
    this.tray.replaceChildren(...parts);
  }
}
