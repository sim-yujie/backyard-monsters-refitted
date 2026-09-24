import { fractionToZoom, sameZoom, zoomPercent, zoomToFraction } from "@/game/yard/minimap";

/**
 * The zoom control shared by the yard and the map: minus, a continuous
 * slider, plus, a readout and a Fit button (design §3, F15 for the yard;
 * §4.1 puts the yard's along the canvas's bottom edge; the map docks its own
 * beside the minimap in the same corner).
 *
 * The yard's original was an empty handler — `BasePlannerPopup.onZoomScroll`
 * (`client/scripts/com/monsters/baseplanner/BasePlannerPopup.as:537-538`) — so
 * the control that looked most like a zoom control did nothing. This one is
 * the whole range: its floor is the camera's own floor, and its ceiling is
 * the camera's ceiling. On the yard the floor is the zoom at which the plot
 * fits, which moves with the viewport, the view and the planner's bars. On
 * the map the floor is fixed — the whole world always fits the same way — so
 * that caller sets it once at construction and never calls `setRange` again.
 *
 * It is a readout as much as a control. Wheel, pinch and the keyboard all go
 * straight to the camera without passing through here, so the scene pushes
 * the camera's zoom back in through `setZoom` every frame the camera moved,
 * and the thumb follows a wheel zoom rather than sitting stale until it is
 * touched.
 *
 * Two things keep that loop from fighting itself. The slider is only
 * rewritten when its integer position actually changes, so a round trip
 * through the camera's clamp cannot jitter the thumb under the player's
 * finger. And the range is expressed as a fraction of the floor-to-ceiling
 * span rather than as zoom values, so moving the floor rescales the control
 * without moving the camera.
 */

/** Slider positions across the whole range. Finer than a pixel of travel. */
const STEPS = 1000;

export interface ZoomControlClasses {
  root: string;
  slider: string;
  readout: string;
  /** Full class list for the minus and plus buttons. */
  step: string;
  /** Full class list for the Fit button. */
  fit: string;
}

/** The yard's own look, and the default so existing callers pass nothing. */
const YARD_CLASSES: ZoomControlClasses = {
  root: "yard-zoom",
  slider: "yard-zoom__slider",
  readout: "yard-zoom__readout",
  step: "btn btn--ghost btn--icon yard-zoom__step",
  fit: "btn btn--ghost yard-zoom__fit",
};

export interface ZoomControlLabels {
  /** Title and aria-label on the minus button. */
  out: string;
  /** Title and aria-label on the plus button. */
  into: string;
  /** Title on the Fit button; its visible text is always "Fit". */
  fit: string;
  /** aria-label on the slider itself. */
  slider: string;
  /** aria-label on the control's own group element. */
  group: string;
}

const YARD_LABELS: ZoomControlLabels = {
  out: "Zoom out (−)",
  into: "Zoom in (+)",
  fit: "Frame the whole yard (0)",
  slider: "Zoom",
  group: "Zoom",
};

export interface ZoomControlOptions {
  /** The slider was moved: zoom to this, about the viewport centre. */
  onZoom: (zoom: number) => void;
  /**
   * Minus or plus was pressed. The direction is the keyboard's sign, so the
   * scene can send it through exactly the path the keys use and the two
   * cannot drift apart.
   */
  onStep: (direction: 1 | -1) => void;
  /** Fit was pressed: frame the whole thing, the same as its keyboard shortcut. */
  onFit: () => void;
  /**
   * The starting range. Moved later with `setRange` for a floor that follows
   * the viewport (the yard); left alone for a floor that never moves (the
   * map, whose whole range is fixed).
   */
  minZoom?: number;
  maxZoom?: number;
  /**
   * "percent" (default): "100%", the yard's own art at native size is 100.
   * "factor": "0.60×", the map's zoom multiplier.
   */
  readout?: "percent" | "factor";
  /** Button and slider copy. Defaults to the yard's. */
  labels?: Partial<ZoomControlLabels>;
  /**
   * CSS classes for the root, slider, readout and buttons. Defaults to the
   * yard's, so existing callers do not have to pass anything.
   */
  classes?: Partial<ZoomControlClasses>;
}

export class ZoomControl {
  readonly element: HTMLElement;

  private readonly slider: HTMLInputElement;
  private readonly readout: HTMLElement;
  private readonly out: HTMLButtonElement;
  private readonly into: HTMLButtonElement;
  private readonly readoutStyle: "percent" | "factor";

  private minZoom: number;
  private maxZoom: number;
  private zoom = 1;

  constructor(options: ZoomControlOptions) {
    const classes = { ...YARD_CLASSES, ...options.classes };
    const labels = { ...YARD_LABELS, ...options.labels };
    this.readoutStyle = options.readout ?? "percent";
    this.minZoom = options.minZoom ?? 0.05;
    this.maxZoom = options.maxZoom ?? 2.5;

    this.element = document.createElement("div");
    this.element.className = classes.root;
    this.element.setAttribute("role", "group");
    this.element.setAttribute("aria-label", labels.group);

    this.out = iconButton(classes.step, "−", labels.out);
    this.out.addEventListener("click", () => options.onStep(-1));

    this.slider = document.createElement("input");
    this.slider.type = "range";
    this.slider.className = classes.slider;
    this.slider.min = "0";
    this.slider.max = String(STEPS);
    this.slider.step = "1";
    this.slider.value = "0";
    this.slider.setAttribute("aria-label", labels.slider);
    this.slider.title = "Drag to zoom";
    this.slider.addEventListener("input", () => {
      const fraction = Number(this.slider.value) / STEPS;
      const next = fractionToZoom(fraction, this.minZoom, this.maxZoom);
      this.zoom = next;
      this.writeReadout();
      options.onZoom(next);
    });

    this.into = iconButton(classes.step, "+", labels.into);
    this.into.addEventListener("click", () => options.onStep(1));

    this.readout = document.createElement("span");
    this.readout.className = classes.readout;
    this.readout.setAttribute("role", "status");
    this.readout.textContent = this.readoutStyle === "factor" ? "1.00×" : "100%";

    const fit = document.createElement("button");
    fit.type = "button";
    fit.className = classes.fit;
    fit.textContent = "Fit";
    fit.title = labels.fit;
    fit.addEventListener("click", options.onFit);

    this.element.append(this.out, this.slider, this.into, this.readout, fit);
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  /**
   * Moves the ends of the range.
   *
   * On the yard the floor is the fit-to-plot zoom, which changes with the
   * viewport, with the view and with how much of the canvas the planner's
   * bars cover. Only the control is rescaled: the camera enforces its own
   * floor, and pulling the camera in from here would fight it. A caller with
   * a fixed range (the map) can skip this entirely after construction.
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
    if (this.readoutStyle === "factor") {
      this.readout.textContent = factorText(this.zoom);
    } else {
      const percent = zoomPercent(this.zoom);
      this.readout.textContent = `${percent}%`;
      this.slider.setAttribute("aria-valuetext", `${percent} percent`);
    }

    // Disabled at the ends rather than silently doing nothing, because a
    // button that looks live and is not is the bug this feature is fixing.
    this.out.disabled = this.zoom <= this.minZoom * (1 + 1e-6);
    this.into.disabled = this.zoom >= this.maxZoom * (1 - 1e-6);
  }
}

/** The map's own readout: "0.60×", or three places below 10%. */
const factorText = (zoom: number): string =>
  zoom >= 0.1 ? `${zoom.toFixed(2)}×` : `${zoom.toFixed(3)}×`;

const iconButton = (className: string, label: string, title: string): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.title = title;
  element.setAttribute("aria-label", title);
  return element;
};
