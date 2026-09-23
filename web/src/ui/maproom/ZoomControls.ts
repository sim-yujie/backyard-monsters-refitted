import { MAX_ZOOM, MIN_ZOOM } from "@/config";

/**
 * Zoom buttons and a slider.
 *
 * The slider is logarithmic. Zoom spans 0.0175 to 2.5, a factor of about 140,
 * and a linear slider would spend nine tenths of its travel between 0.25 and
 * 2.5 while the entire zoomed-out half of the map hid in the first few pixels.
 * On a log scale one notch of the thumb is a constant *ratio* of zoom, which is
 * what the wheel does too, so the two controls agree.
 */

const SLIDER_STEPS = 1000;

export interface ZoomControlsOptions {
  /** Called with an absolute zoom the camera should move to. */
  onZoom: (zoom: number) => void;
  /** Called by the reset button; the scene decides what "reset" means. */
  onReset: () => void;
  minZoom?: number;
  maxZoom?: number;
}

export class ZoomControls {
  readonly element: HTMLElement;

  private readonly slider: HTMLInputElement;
  private readonly readout: HTMLElement;
  private readonly min: number;
  private readonly max: number;

  constructor(options: ZoomControlsOptions) {
    this.min = options.minZoom ?? MIN_ZOOM;
    this.max = options.maxZoom ?? MAX_ZOOM;

    this.element = document.createElement("div");
    this.element.className = "zoom-controls";
    this.element.setAttribute("role", "group");
    this.element.setAttribute("aria-label", "Zoom");

    const out = this.button("−", "Zoom out", () => options.onZoom(this.stepped(-1)));
    const reset = this.button("Fit", "Fit the whole world on screen", options.onReset);
    const inward = this.button("+", "Zoom in", () => options.onZoom(this.stepped(1)));

    this.slider = document.createElement("input");
    this.slider.type = "range";
    this.slider.className = "zoom-controls__slider";
    this.slider.min = "0";
    this.slider.max = String(SLIDER_STEPS);
    this.slider.step = "1";
    this.slider.setAttribute("aria-label", "Zoom level");
    this.slider.addEventListener("input", () => {
      options.onZoom(this.fromSlider(Number(this.slider.value)));
    });

    this.readout = document.createElement("span");
    this.readout.className = "zoom-controls__value";

    this.element.append(out, this.slider, inward, this.readout, reset);
  }

  /** Reflects the camera's zoom without firing `onZoom`. */
  setZoom(zoom: number): void {
    this.slider.value = String(this.toSlider(zoom));
    this.readout.textContent = zoom >= 0.1 ? `${zoom.toFixed(2)}×` : `${zoom.toFixed(3)}×`;
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  destroy(): void {
    this.element.remove();
  }

  /** One button press is a fixed ratio, matching a couple of wheel notches. */
  private stepped(direction: number): number {
    const current = this.fromSlider(Number(this.slider.value));
    return clamp(current * Math.pow(1.5, direction), this.min, this.max);
  }

  private toSlider(zoom: number): number {
    const clamped = clamp(zoom, this.min, this.max);
    const ratio = Math.log(clamped / this.min) / Math.log(this.max / this.min);
    return Math.round(ratio * SLIDER_STEPS);
  }

  private fromSlider(value: number): number {
    const ratio = clamp(value / SLIDER_STEPS, 0, 1);
    return this.min * Math.pow(this.max / this.min, ratio);
  }

  private button(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn--ghost btn--icon";
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", onClick);
    return button;
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);
