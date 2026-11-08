import type { PrepareState } from "@/game/maproom/prepareProgress";

/**
 * Map Room 2's "Preparing map" loading screen (owner chose design A on the Review Desk, 8 Nov 2026;
 * Codex's designs in archive/prepare-bar-review/codex-review.md). On a first open where the painted
 * look's shaders still compile (Firefox: ~15-20 s), it covers the map area under the top bar: a
 * painted map picture, "Preparing map", a big bar and the percent, in the window's own frame (Modern
 * steel, Classic parchment, `skin.css` `.panel`). The map waits behind it and cannot be touched; the
 * top bar stays usable, so the player can still go back to the yard. At 100% it holds the full bar
 * for {@link HOLD_MS}, then fades into the finished map.
 *
 * A view only: `MapRenderer.prepareState` decides when it shows. Styles: `maproom.css`
 * ("Preparing map").
 */

export const PREPARE_LABEL = "Preparing map";

/** How long the full bar stays at 100% before the screen fades. */
export const HOLD_MS = 600;

/** The painted map picture on the card (reused from the What's new pop-up, beta 6; no new art). */
export const LOADING_ART_URL = `${import.meta.env.BASE_URL}whats-new/beta6-map.webp`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

export class PreparingMap {
  readonly element: HTMLDivElement;
  private readonly fill: HTMLSpanElement;
  private readonly number: HTMLSpanElement;
  private shown = false;
  private percent = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.element = el("div", "mr2-prepare");
    this.element.setAttribute("role", "progressbar");
    this.element.setAttribute("aria-label", PREPARE_LABEL);
    this.element.setAttribute("aria-valuemin", "0");
    this.element.setAttribute("aria-valuemax", "100");
    this.element.setAttribute("aria-hidden", "true");
    // The map behind it waits: no click, tap, drag or wheel reaches it while the screen shows.
    for (const type of ["pointerdown", "click", "dblclick", "wheel", "contextmenu"] as const) {
      this.element.addEventListener(type, (event) => {
        if (this.shown) event.preventDefault();
      });
    }

    const card = el("div", "panel mr2-prepare__card");
    const art = el("img", "mr2-prepare__art");
    art.src = LOADING_ART_URL;
    art.alt = "";
    art.decoding = "async";
    art.draggable = false;

    const row = el("div", "mr2-prepare__row");
    const track = el("span", "mr2-prepare__track");
    this.fill = el("span", "mr2-prepare__fill");
    track.append(this.fill);
    this.number = el("span", "mr2-prepare__number");
    row.append(track, this.number);

    card.append(art, el("div", "mr2-prepare__title", PREPARE_LABEL), row);
    this.element.append(card);
  }

  /** Whether the screen is up (including the hold at 100%); the map ignores its keys meanwhile. */
  get showing(): boolean {
    return this.shown;
  }

  /** Shows the state; touches the page only when something changed. */
  set(state: PrepareState): void {
    if (state.show) {
      this.clearTimer();
      this.render(state.percent);
      this.toggle(true);
    } else if (this.shown) {
      if (state.percent >= 100) {
        // Done: the full bar for a moment, then the fade into the finished map.
        this.render(100);
        this.timer ??= setTimeout(() => {
          this.timer = null;
          this.toggle(false);
        }, HOLD_MS);
      } else {
        // Gave up (stalled), or the look was switched off: fade straight away.
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
    this.element.setAttribute("aria-valuenow", String(percent));
  }

  private toggle(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.element.classList.toggle("mr2-prepare--shown", on);
    this.element.setAttribute("aria-hidden", String(!on));
  }
}
