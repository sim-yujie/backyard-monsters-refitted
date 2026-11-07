// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { PREPARE_LABEL, PreparingMap } from "./PreparingMap";

/** The map's "Preparing map… N%" plate (owner, 7 Nov 2026): an icon, a bar and a number. */
describe("PreparingMap", () => {
  const parts = (plate: PreparingMap) => ({
    fill: plate.element.querySelector<HTMLElement>(".mr2-prepare__fill"),
    number: plate.element.querySelector(".mr2-prepare__number")?.textContent,
  });

  it("starts hidden, with no words on it but its icon, bar and number (the word is its tooltip)", () => {
    const plate = new PreparingMap();
    expect(plate.showing).toBe(false);
    expect(plate.element.classList.contains("mr2-prepare--shown")).toBe(false);
    expect(plate.element.getAttribute("aria-hidden")).toBe("true");
    expect(plate.element.querySelector("img")).not.toBeNull();
    expect(plate.element.title).toBe(PREPARE_LABEL);
    expect(plate.element.getAttribute("role")).toBe("progressbar");
  });

  it("shows the percent as a bar and a number", () => {
    const plate = new PreparingMap();
    plate.set({ show: true, percent: 42.4 });
    expect(plate.showing).toBe(true);
    expect(plate.element.classList.contains("mr2-prepare--shown")).toBe(true);
    expect(plate.element.getAttribute("aria-hidden")).toBe("false");
    expect(parts(plate).fill?.style.width).toBe("42%");
    expect(parts(plate).number).toBe("42%");
    expect(plate.element.getAttribute("aria-valuenow")).toBe("42");
  });

  it("fades out full when the look comes in, and keeps its number when hidden for another reason", () => {
    const plate = new PreparingMap();
    plate.set({ show: true, percent: 60 });
    plate.set({ show: false, percent: 0 });
    expect(plate.showing).toBe(false);
    expect(parts(plate).number).toBe("60%");
    plate.set({ show: true, percent: 70 });
    plate.set({ show: false, percent: 100 });
    expect(parts(plate).number).toBe("100%");
    expect(parts(plate).fill?.style.width).toBe("100%");
  });
});
