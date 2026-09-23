import { fractionToZoom, sameZoom, zoomPercent, zoomToFraction } from "@/game/yard/minimap";

/**
 * The yard's zoom control: minus, a continuous slider, plus, a percentage and
 * Fit (design §3, F15; §4.1 puts it along the canvas's bottom edge).
 *
 * The original's slider was an empty handler — `BasePlannerPopup.onZoomScroll`
 * (`client/scripts/com/monsters/baseplanner/BasePlannerPopup.as:537-538`) — so
 * the control that looked most like a zoom control did nothing. This one is
 * the whole range: its floor is the camera's own floor, the zoom at which the
 * plot fits, and its ceiling is the camera's ceiling.
 *
 * It is a readout as much as a control. Wheel, pinch and the keyboard all go
 * straight to the camera without passing through here, so the scene pushes the
 * camera's zoom back in through `setZoom` every frame the camera moved, and
 * the thumb follows a wheel zoom rather than sitting stale until it is touched.
 *
 * Two things keep that loop from fighting itself. The slider is only rewritten
 * when its integer position actually changes, so a round trip through the
 * camera's clamp cannot jitter the thumb under the player's finger. And the
 * range is expressed as a fraction of the floor-to-ceiling span rather than as
 * zoom values, so moving the floor — a resize, a view switch, the planner's
 * bars appearing — rescales the control without moving the camera.
 */

/** Slider positions across the whole range. Finer than a pixel of travel. */
const STEPS = 1000;

export interface ZoomControlActions {
  /** The slider was moved: zoom to this, about the viewport centre. */
  onZoom: (zoom: number) => void;
  /**
   * Minus or plus was pressed. The direction is the keyboard's sign, so the
   * scene can send it through exactly the path the keys use and the two cannot
   * drift apart.
   */
  onStep: (direction: 1 | -1) => void;
  /** Fit was pressed: frame the whole plot, the same as the 0 key. */
  onFit: () => void;
}

export class ZoomControl {
  readonly element: HTMLElement;

  private readonly slider: HTMLInputElement;
  private readonly readout: HTMLElement;
  private readonly out: HTMLButtonElement;
  private readonly into: HTMLButtonElement;

  private minZoom = 0.05;
  private maxZoom = 2.5;
  private zoom = 1;

  constructor(actions: ZoomControlActions) {
    this.element = document.createElement("div");
    this.element.className = "yard-zoom";
    this.element.setAttribute("role", "group");
    this.element.setAttribute("aria-label", "Zoom");

    this.out = iconButton("−", "Zoom out (−)");
    this.out.addEventListener("click", () => actions.onStep(-1));

    this.slider = document.createElement("input");
    this.slider.type = "range";
    this.slider.className = "yard-zoom__slider";
    this.slider.min = "0";
    this.slider.max = String(STEPS);
    this.slider.step = "1";
    this.slider.value = "0";
    this.slider.setAttribute("aria-label", "Zoom");
    this.slider.title = "Drag to zoom";
    this.slider.addEventListener("input", () => {
      const fraction = Number(this.slider.value) / STEPS;
      const next = fractionToZoom(fraction, this.minZoom, this.maxZoom);
      this.zoom = next;
      this.writeReadout();
      actions.onZoom(next);
    });

    this.into = iconButton("+", "Zoom in (+)");
    this.into.addEventListener("click", () => actions.onStep(1));

    this.readout = document.createElement("span");
    this.readout.className = "yard-zoom__readout";
    this.readout.setAttribute("role", "status");
    this.readout.textContent = "100%";

    const fit = document.createElement("button");
    fit.type = "button";
    fit.className = "btn btn--ghost yard-zoom__fit";
    fit.textContent = "Fit";
    fit.title = "Frame the whole yard (0)";
    fit.addEventListener("click", actions.onFit);

    this.element.append(this.out, this.slider, this.into, this.readout, fit);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  /**
   * Moves the ends of the range.
   *
   * The floor is the fit-to-plot zoom, which changes with the viewport, with
   * the view and with how much of the canvas the planner's bars cover. Only
   * the control is rescaled: the camera enforces its own floor, and pulling
   * the camera in from here would fight it.
   */
  setRange(minZoom: number, maxZoom: number): void {
    if (sameZoom(minZoom, this.minZoom) && sameZoom(maxZoom, this.maxZoom)) return;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.writeSlider();
    this.writeReadout();
  }

  /** The camera's current zoom, pushed in after wheel, pinch, keys or Fit. */
  setZoom(zoom: number): void {
    if (sameZoom(zoom, this.zoom)) return;
    this.zoom = zoom;
    this.writeSlider();
    this.writeReadout();
  }

  destroy(): void {
    this.element.remove();
  }

  /** Only writes when the integer position moved, so a drag cannot stutter. */
  private writeSlider(): void {
    const position = String(
      Math.round(zoomToFraction(this.zoom, this.minZoom, this.maxZoom) * STEPS),
    );
    if (this.slider.value !== position) this.slider.value = position;
  }

  private writeReadout(): void {
    const percent = zoomPercent(this.zoom);
    this.readout.textContent = `${percent}%`;
    this.slider.setAttribute("aria-valuetext", `${percent} percent`);

    // Disabled at the ends rather than silently doing nothing, because a
    // button that looks live and is not is the bug this feature is fixing.
    this.out.disabled = this.zoom <= this.minZoom * (1 + 1e-6);
    this.into.disabled = this.zoom >= this.maxZoom * (1 - 1e-6);
  }
}

const iconButton = (label: string, title: string): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "btn btn--ghost btn--icon yard-zoom__step";
  element.textContent = label;
  element.title = title;
  element.setAttribute("aria-label", title);
  return element;
};
