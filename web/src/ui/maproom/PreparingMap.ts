import { gameIcon } from "@/ui/gameIcon";
import type { PrepareState } from "@/game/maproom/prepareProgress";

/**
 * The map's "Preparing map… N%" plate (owner, 7 Nov 2026): while the painted look's shaders compile
 * on a first open (Firefox: ~17 s), the plain tiles show and this plate says the look is still
 * coming. Icons and numbers, no words on it (owner: icons over words); the word is in its tooltip
 * and for screen readers. The scene decides when it shows (`MapRenderer.prepareState`); it fades in
 * and out with CSS (`maproom.css` `.mr2-prepare`), and wears the Modern plate (`skin.css`).
 */

export const PREPARE_LABEL = "Preparing map";

export class PreparingMap {
  readonly element: HTMLDivElement;
  private readonly fill: HTMLSpanElement;
  private readonly number: HTMLSpanElement;
  private shown = false;
  private percent = -1;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "mr2-prepare";
    this.element.setAttribute("role", "progressbar");
    this.element.setAttribute("aria-label", PREPARE_LABEL);
    this.element.setAttribute("aria-valuemin", "0");
    this.element.setAttribute("aria-valuemax", "100");
    this.element.setAttribute("aria-hidden", "true");
    this.element.title = PREPARE_LABEL;

    const track = document.createElement("span");
    track.className = "mr2-prepare__track";
    this.fill = document.createElement("span");
    this.fill.className = "mr2-prepare__fill";
    track.append(this.fill);

    this.number = document.createElement("span");
    this.number.className = "mr2-prepare__number";

    this.element.append(gameIcon("mapflat", { size: 24, decorative: true }), track, this.number);
    this.set({ show: false, percent: 0 });
  }

  /** Whether it is showing (or fading in). */
  get showing(): boolean {
    return this.shown;
  }

  /** Shows the state; touches the page only when something changed. */
  set(state: PrepareState): void {
    const percent = Math.max(0, Math.min(100, Math.round(state.percent)));
    // Fading out keeps the last number unless the look came in (100%).
    if (percent !== this.percent && (state.show || percent === 100)) {
      this.percent = percent;
      this.fill.style.width = `${percent}%`;
      this.number.textContent = `${percent}%`;
      this.element.setAttribute("aria-valuenow", String(percent));
    }
    if (state.show !== this.shown) {
      this.shown = state.show;
      this.element.classList.toggle("mr2-prepare--shown", state.show);
      this.element.setAttribute("aria-hidden", String(!state.show));
    }
  }
}
