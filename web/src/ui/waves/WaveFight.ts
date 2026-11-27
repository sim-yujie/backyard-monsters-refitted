import type { WaveStatus } from "@/api/waves";
import { el } from "@/ui/dom";
import { gameIcon } from "@/ui/gameIcon";
import { isPhoneLayout } from "@/ui/phoneLayout";
import "@/ui/styles/waves.css";
import { waveMonsterImage, waveMonsterName } from "./waveArt";

/**
 * A wave's fight screen (beta 10; neon's direction A, 27 Nov 2026): the
 * "WAVE 7" plaque slams in over the yard, then folds into a status pill
 * under the strip, which holds the wave, the yard's health on a bar with the
 * 10% win line marked, and the monsters still to beat. Surrender sits apart,
 * top right, away from the speed buttons.
 */

/** How long the slam plaque stays before it folds into the pill. */
export const WAVE_SLAM_MS = 2_500;
/** The fold's own length (`waves.css`, `wave-slam-out`). */
export const WAVE_SLAM_FOLD_MS = 350;
/** The yard's health a wave must beat: more than this share stays standing. */
export const WAVE_WIN_HEALTH_PERCENT = 10;

/** The yard's health from the strip's damage, 0-100, the same rounding as the strip. */
export const yardHealth = (damageShown: number): number => Math.max(0, Math.min(100, 100 - Math.floor(damageShown)));

/** The monsters the fight's script brings in all, a wild champion counting one. */
export const scriptMonsters = (
  events: readonly { readonly monsters: Readonly<Record<string, number>>; readonly champion?: unknown }[],
): number =>
  events.reduce(
    (sum, event) => sum + Object.values(event.monsters).reduce((one, count) => one + (Number(count) || 0), 0) + (event.champion ? 1 : 0),
    0,
  );

export interface WaveFightHudOptions {
  /** The layer over the scene the pieces float in. */
  readonly layer: HTMLElement;
  /** The fight's strip, to sit under. */
  readonly strip: HTMLElement | null;
  /** The wave fought (the status it was called with). */
  readonly wave: WaveStatus;
  /** "Wave 7/30" or "Bonus 1/2" on the plaque. */
  readonly label: string;
  /** The short form, for a phone: "W7", "B1". */
  readonly shortLabel: string;
  /** The slam's words: "WAVE 7", "BONUS WAVE 1". */
  readonly slam: string;
}

export class WaveFightHud {
  readonly element: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly health: HTMLElement;
  private readonly left: HTMLElement;
  private readonly bar: HTMLElement;
  private slamPlate: HTMLElement | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private readonly onResize = (): void => this.place();
  private readonly extras: HTMLElement[] = [];

  constructor(private readonly options: WaveFightHudOptions) {
    const status = el("div", "wave-status");
    status.setAttribute("role", "status");
    const plaque = el("span", "wave-status__plaque");
    plaque.append(el("span", "wave-status__label-long", options.label), el("span", "wave-status__label-short", options.shortLabel));

    const healthGroup = el("span", "wave-status__health");
    healthGroup.title = `Yard health: keep more than ${WAVE_WIN_HEALTH_PERCENT}% and beat every monster`;
    this.bar = el("span", "wave-status__bar");
    this.fill = el("span", "wave-status__fill");
    const notch = el("span", "wave-status__notch");
    notch.style.left = `${WAVE_WIN_HEALTH_PERCENT}%`;
    this.bar.append(this.fill, notch);
    this.health = el("span", "wave-status__percent", "100%");
    healthGroup.append(gameIcon("health", { size: 24, decorative: true, className: "wave-status__heart" }), this.bar, this.health);

    const leftGroup = el("span", "wave-status__left");
    const lead = options.wave.preview[0]?.monster;
    if (lead) {
      const face = waveMonsterImage(lead, "wave-status__face");
      leftGroup.title = `Monsters left (${waveMonsterName(lead)} and more)`;
      leftGroup.append(face);
    } else {
      leftGroup.title = "Monsters left";
      leftGroup.append(gameIcon("lost2", { size: 24, decorative: true, className: "wave-status__face" }));
    }
    this.left = el("span", "wave-status__count", "0");
    leftGroup.append(this.left);

    status.append(plaque, healthGroup, leftGroup);
    status.classList.add("wave-status--waiting");
    this.element = status;
    // A phone's strip has room in its middle (its title is hidden there): the pill rides in it.
    const slot = isPhoneLayout() ? options.strip?.querySelector<HTMLElement>(".attack-strip__slot") : null;
    if (slot) {
      status.classList.add("wave-status--in-strip");
      slot.prepend(status);
    } else {
      options.layer.append(status);
    }
    this.place();
    window.addEventListener("resize", this.onResize);
  }

  /** Keeps a piece of the fight (Surrender) under the strip with the pill. */
  adopt(piece: HTMLElement): void {
    piece.classList.add("wave-fight-piece");
    this.extras.push(piece);
    this.options.layer.append(piece);
    this.place();
  }

  /** The strip's bottom edge: the pieces sit 8px under it. */
  private place(): void {
    const bottom = this.options.strip?.getBoundingClientRect().bottom ?? 0;
    const top = `${Math.round(Math.max(0, bottom) + 8)}px`;
    if (!this.element.classList.contains("wave-status--in-strip")) this.element.style.top = top;
    for (const piece of this.extras) piece.style.top = top;
    if (this.slamPlate) this.slamPlate.style.top = `${Math.round(Math.max(0, bottom) + 28)}px`;
  }

  /** The "WAVE 7" plaque: in, held, then folded into the pill. */
  slam(): void {
    const plate = el("div", "wave-slam");
    plate.setAttribute("aria-hidden", "true");
    plate.append(el("span", "wave-slam__words", this.options.slam));
    this.slamPlate = plate;
    this.options.layer.append(plate);
    this.place();
    this.timers.push(
      setTimeout(() => plate.classList.add("wave-slam--out"), WAVE_SLAM_MS),
      setTimeout(() => {
        plate.remove();
        if (this.slamPlate === plate) this.slamPlate = null;
        this.element.classList.remove("wave-status--waiting");
      }, WAVE_SLAM_MS + WAVE_SLAM_FOLD_MS),
    );
  }

  update(health: number, monstersLeft: number): void {
    const shown = Math.max(0, Math.min(100, Math.round(health)));
    this.fill.style.width = `${shown}%`;
    this.health.textContent = `${shown}%`;
    this.bar.classList.toggle("wave-status__bar--low", shown <= 35);
    this.bar.classList.toggle("wave-status__bar--lost", shown <= WAVE_WIN_HEALTH_PERCENT);
    this.left.textContent = String(Math.max(0, monstersLeft));
  }

  remove(): void {
    for (const timer of this.timers) clearTimeout(timer);
    window.removeEventListener("resize", this.onResize);
    this.slamPlate?.remove();
    this.element.remove();
    for (const piece of this.extras) piece.remove();
  }
}
