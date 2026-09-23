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
