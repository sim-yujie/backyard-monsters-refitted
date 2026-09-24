// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { fractionToZoom, zoomToFraction } from "@/game/yard/minimap";
import { ZoomControl } from "./ZoomControl";

/**
 * The zoom control's two directions.
 *
 * Outward: the slider is dragged and the camera is asked for that zoom.
 * Inward: the camera moved on its own — a wheel, a pinch, a key, Fit — and the
 * thumb has to follow. Both are covered here, plus the thing that makes the
 * loop safe: a zoom pushed back in must not rewrite the slider the player is
 * holding.
 *
 * The suite below covers the yard's own defaults — percent readout, a range
 * that moves with `setRange` — and the map's shape of the same control: a
 * factor readout, a fixed range taken at construction, and its own copy and
 * classes.
 */

const MIN = 0.08;
const MAX = 2.5;

interface Harness {
  control: ZoomControl;
  zooms: number[];
  steps: number[];
  fits: number;
  slider: HTMLInputElement;
  readout: HTMLElement;
  buttons: HTMLButtonElement[];
}

const mount = (): Harness => {
  const zooms: number[] = [];
  const steps: number[] = [];
  let fits = 0;

  const control = new ZoomControl({
    onZoom: (zoom) => zooms.push(zoom),
    onStep: (direction) => steps.push(direction),
    onFit: () => {
      fits += 1;
    },
  });
  control.mount(document.body);
  control.setRange(MIN, MAX);
  control.setZoom(1);

  const slider = control.element.querySelector("input[type=range]");
  const readout = control.element.querySelector(".yard-zoom__readout");
  if (!(slider instanceof HTMLInputElement) || !(readout instanceof HTMLElement)) {
    throw new Error("The control did not build its slider and readout");
  }

  return {
    control,
    zooms,
    steps,
    get fits() {
      return fits;
    },
    slider,
    readout,
    buttons: [...control.element.querySelectorAll("button")],
  };
};

/** Moves the slider the way a pointer drag does: set the value, fire `input`. */
const dragTo = (slider: HTMLInputElement, fraction: number): void => {
  slider.value = String(Math.round(fraction * Number(slider.max)));
  slider.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(() => {
  document.body.replaceChildren();
});

describe("slider to camera", () => {
  it("asks for the zoom its position stands for", () => {
    const harness = mount();
    dragTo(harness.slider, 0.5);
    expect(harness.zooms).toHaveLength(1);
    expect(harness.zooms[0]).toBeCloseTo(fractionToZoom(0.5, MIN, MAX));
  });

  it("reaches both ends of the range exactly", () => {
    const harness = mount();
    dragTo(harness.slider, 0);
    dragTo(harness.slider, 1);
    expect(harness.zooms[0]).toBeCloseTo(MIN);
    expect(harness.zooms[1]).toBeCloseTo(MAX);
  });

  it("updates the readout without waiting for the camera to answer", () => {
    const harness = mount();
    dragTo(harness.slider, 1);
    expect(harness.readout.textContent).toBe("250%");
  });
});

describe("camera to slider", () => {
  it("moves the thumb when the camera zooms without it", () => {
    const harness = mount();
    harness.control.setZoom(2);
    expect(Number(harness.slider.value) / Number(harness.slider.max)).toBeCloseTo(
      zoomToFraction(2, MIN, MAX),
      3,
    );
    expect(harness.readout.textContent).toBe("200%");
  });

  it("does not call back into the camera", () => {
    const harness = mount();
    harness.control.setZoom(0.5);
    expect(harness.zooms).toHaveLength(0);
  });

  it("leaves the slider alone when the camera echoes the value back", () => {
    const harness = mount();
    dragTo(harness.slider, 0.42);
    const held = harness.slider.value;
    // What the scene does on the next frame: push the camera's zoom back in.
    harness.control.setZoom(harness.zooms[0] as number);
    expect(harness.slider.value).toBe(held);
  });
});

describe("the range", () => {
  it("rescales when the fit floor moves, without asking the camera to zoom", () => {
    const harness = mount();
    harness.control.setZoom(0.5);
    const before = harness.slider.value;
    harness.control.setRange(0.3, MAX);
    expect(harness.slider.value).not.toBe(before);
    expect(harness.zooms).toHaveLength(0);
  });

  it("disables the ends rather than pretending they work", () => {
    const harness = mount();
    const out = harness.buttons[0];
    const into = harness.buttons[1];
    harness.control.setZoom(MIN);
    expect(out?.disabled).toBe(true);
    expect(into?.disabled).toBe(false);
    harness.control.setZoom(MAX);
    expect(out?.disabled).toBe(false);
    expect(into?.disabled).toBe(true);
  });
});

describe("the buttons", () => {
  it("sends the keyboard's own direction rather than a zoom of its own", () => {
    const harness = mount();
    harness.buttons[0]?.click();
    harness.buttons[1]?.click();
    expect(harness.steps).toEqual([-1, 1]);
    expect(harness.zooms).toHaveLength(0);
  });

  it("has a Fit button that does what the 0 key does", () => {
    const harness = mount();
    const fit = harness.buttons.find((button) => button.textContent === "Fit");
    fit?.click();
    expect(harness.fits).toBe(1);
  });
});

describe("teardown", () => {
  it("takes its element with it", () => {
    const harness = mount();
    expect(document.querySelector(".yard-zoom")).not.toBeNull();
    harness.control.destroy();
    expect(document.querySelector(".yard-zoom")).toBeNull();
  });
});

describe("the factor readout (the map's shape)", () => {
  it("shows a zoom multiplier instead of a percentage", () => {
    const control = new ZoomControl({
      onZoom: () => {},
      onStep: () => {},
      onFit: () => {},
      minZoom: 0.01,
      maxZoom: 2.5,
      readout: "factor",
    });
    control.mount(document.body);
    control.setZoom(0.6);
    const readout = control.element.querySelector("span");
    expect(readout?.textContent).toBe("0.60×");
  });

  it("drops to three decimal places under 10%, and never touches aria-valuetext", () => {
    const control = new ZoomControl({
      onZoom: () => {},
      onStep: () => {},
      onFit: () => {},
      minZoom: 0.01,
      maxZoom: 2.5,
      readout: "factor",
    });
    control.mount(document.body);
    control.setZoom(0.05);
    const readout = control.element.querySelector("span");
    const slider = control.element.querySelector("input[type=range]");
    expect(readout?.textContent).toBe("0.050×");
    expect(slider?.getAttribute("aria-valuetext")).toBeNull();
  });
});

describe("a fixed range (the map's shape)", () => {
  it("takes minZoom and maxZoom at construction, with no setRange call needed", () => {
    const zooms: number[] = [];
    const control = new ZoomControl({
      onZoom: (zoom) => zooms.push(zoom),
      onStep: () => {},
      onFit: () => {},
      minZoom: 0.0175,
      maxZoom: 2.5,
      readout: "factor",
      classes: {
        root: "zoom-controls",
        slider: "zoom-controls__slider",
        readout: "zoom-controls__value",
        step: "btn btn--ghost btn--icon",
        fit: "btn btn--ghost btn--icon",
      },
      labels: {
        out: "Zoom out",
        into: "Zoom in",
        fit: "Fit the whole world on screen",
        slider: "Zoom level",
      },
    });
    control.mount(document.body);

    expect(control.element.className).toBe("zoom-controls");
    const slider = control.element.querySelector("input[type=range]");
    if (!(slider instanceof HTMLInputElement)) throw new Error("The control did not build a slider");
    expect(slider.className).toBe("zoom-controls__slider");
    expect(slider.getAttribute("aria-label")).toBe("Zoom level");

    dragTo(slider, 1);
    expect(zooms[0]).toBeCloseTo(2.5);
  });

  it("carries the given titles and keeps the shared icon-button classes", () => {
    const control = new ZoomControl({
      onZoom: () => {},
      onStep: () => {},
      onFit: () => {},
      minZoom: 0.0175,
      maxZoom: 2.5,
      classes: { step: "btn btn--ghost btn--icon", fit: "btn btn--ghost btn--icon" },
      labels: { out: "Zoom out", into: "Zoom in", fit: "Fit the whole world on screen" },
    });
    control.mount(document.body);

    const buttons = [...control.element.querySelectorAll("button")];
    expect(buttons[0]?.title).toBe("Zoom out");
    expect(buttons[0]?.className).toBe("btn btn--ghost btn--icon");
    const fit = buttons.find((button) => button.textContent === "Fit");
    expect(fit?.title).toBe("Fit the whole world on screen");
    expect(fit?.className).toBe("btn btn--ghost btn--icon");
  });
});
