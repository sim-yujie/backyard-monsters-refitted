import { gameIcon } from "@/ui/gameIcon";
import type { PrepareDesign } from "@/game/maproom/prepareDesign";
import type { PrepareState } from "@/game/maproom/prepareProgress";
import { PREPARE_LABEL, PreparingMap } from "./PreparingMap";

/**
 * Rapid prototypes of the "Preparing map" designs Codex proposed (owner, 8 Nov 2026;
 * archive/prepare-bar-review/codex-review.md), picked with `?prepbar=a|b|c` (`prepareDesign.ts`).
 * Not polished: for the owner to try and choose. Styles in `maproom.css` ("Preparing map
 * prototypes"); the plates wear the Modern steel or the Classic Flash plate (`skin.css`).
 *
 * - A: an illustrated loading screen over the map area (the painted map picture from What's new,
 *   no new art); the map waits behind it and cannot be moved.
 * - B: a broad strip just under the top bar; the map stays usable.
 * - C: a painted mist (the map's own cloud picture) over the map, thinning as it prepares, and a
 *   small plaque near the upper-left edge; panning allowed.
 *
 * A, B and C hold the full bar for {@link HOLD_MS} at 100%, then fade.
 */

export interface PrepareView {
  /** Over the map but under the map's controls (C's mist), or null. */
  readonly under: HTMLElement | null;
  /** Over the map and its controls (under the top bar). */
  readonly over: HTMLElement;
  /** True for the first bar, which lives in its own dock low in the middle. */
  readonly docked: boolean;
  set(state: PrepareState): void;
  destroy(): void;
}

/** How long A, B and C stay full at 100% before fading (Codex: "hold the completed state briefly"). */
export const HOLD_MS = 700;

/** The painted map picture A shows (What's new, beta 6). */
export const LOADING_ART_URL = `${import.meta.env.BASE_URL}whats-new/beta6-map.webp`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

/** A track with its fill, and the percent beside it. */
const progressRow = (size: "big" | "broad" | "small"): { row: HTMLElement; fill: HTMLElement; number: HTMLElement } => {
  const row = el("div", `mr2-prep__row mr2-prep__row--${size}`);
  const track = el("span", "mr2-prep__track");
  const fill = el("span", "mr2-prep__fill");
  track.append(fill);
  const number = el("span", "mr2-prep__number");
  row.append(track, number);
  return { row, fill, number };
};

const asProgressBar = (element: HTMLElement): void => {
  element.setAttribute("role", "progressbar");
  element.setAttribute("aria-label", PREPARE_LABEL);
  element.setAttribute("aria-valuemin", "0");
  element.setAttribute("aria-valuemax", "100");
  element.setAttribute("aria-hidden", "true");
};

/** Shows, updates and hides one prototype, with the hold at 100%. */
class HeldView implements PrepareView {
  readonly docked = false;
  private shown = false;
  private percent = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly over: HTMLElement,
    readonly under: HTMLElement | null,
    private readonly fill: HTMLElement,
    private readonly number: HTMLElement,
    private readonly onPercent: (percent: number) => void = () => {},
  ) {
    asProgressBar(over);
  }

  get showing(): boolean {
    return this.shown;
  }

  set(state: PrepareState): void {
    if (state.show) {
      this.clearTimer();
      this.render(state.percent);
      this.toggle(true);
    } else if (this.shown) {
      if (state.percent >= 100) {
        this.render(100);
        this.timer ??= setTimeout(() => {
          this.timer = null;
          this.toggle(false);
        }, HOLD_MS);
      } else {
        this.clearTimer();
        this.toggle(false);
      }
    }
  }

  destroy(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private render(value: number): void {
    const percent = Math.max(0, Math.min(100, Math.round(value)));
    if (percent === this.percent) return;
    this.percent = percent;
    this.fill.style.width = `${percent}%`;
    this.number.textContent = `${percent}%`;
    this.over.setAttribute("aria-valuenow", String(percent));
    this.onPercent(percent);
  }

  private toggle(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    for (const element of [this.over, this.under]) element?.classList.toggle("mr2-prep--shown", on);
    this.over.setAttribute("aria-hidden", String(!on));
  }
}

/** A: the illustrated loading screen. */
const loadingScreen = (): HeldView => {
  const cover = el("div", "mr2-prep-a");
  const card = el("div", "panel mr2-prep-a__card");
  const art = el("img", "mr2-prep-a__art");
  art.src = LOADING_ART_URL;
  art.alt = "";
  art.decoding = "async";
  const { row, fill, number } = progressRow("big");
  card.append(art, el("div", "mr2-prep__title mr2-prep-a__title", PREPARE_LABEL), row);
  cover.append(card);
  return new HeldView(cover, null, fill, number);
};

/** B: the strip under the top bar. */
const strip = (): HeldView => {
  const plate = el("div", "mr2-prep-b");
  const { row, fill, number } = progressRow("broad");
  plate.append(gameIcon("mapflat", { size: 32, decorative: true }), el("span", "mr2-prep__title", PREPARE_LABEL), row);
  return new HeldView(plate, null, fill, number);
};

/** How thick the mist is at 0%. */
export const MIST_MAX = 0.85;

/** C: the mist over the map and the plaque. */
const mistAndPlaque = (): HeldView => {
  const mist = el("div", "mr2-prep-c-mist");
  const clouds = el("div", "mr2-prep-c-mist__clouds");
  mist.append(clouds);
  const plaque = el("div", "mr2-prep-c");
  const { row, fill, number } = progressRow("small");
  plaque.append(gameIcon("mapflat", { size: 24, decorative: true }), el("span", "mr2-prep__title", PREPARE_LABEL), row);
  return new HeldView(plaque, mist, fill, number, (percent) => {
    clouds.style.opacity = String(MIST_MAX * (1 - percent / 100));
  });
};

/** The first bar, in its dock. */
const firstBar = (): PrepareView => {
  const plate = new PreparingMap();
  return { under: null, over: plate.element, docked: true, set: (state) => plate.set(state), destroy: () => {} };
};

export const createPrepareView = (design: PrepareDesign): PrepareView => {
  switch (design) {
    case "a":
      return loadingScreen();
    case "b":
      return strip();
    case "c":
      return mistAndPlaque();
    default:
      return firstBar();
  }
};
