// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import {
  CLASSIC_GROUND_KEY,
  currentGround,
  GROUND_KEY,
  onGroundChange,
  resetGroundForTests,
} from "@/game/yard/groundChoice";
import { GROUND_TEXT, groundPicker } from "./groundPicker";

/** Settings, Look and sound: the yard ground swatches (owner, 12 Nov 2026). */

const swatches = (picker: HTMLElement) => [...picker.querySelectorAll<HTMLButtonElement>(".ground-picker__swatch")];
const chosen = (picker: HTMLElement) =>
  swatches(picker)
    .filter((swatch) => swatch.getAttribute("aria-checked") === "true")
    .map((swatch) => swatch.dataset["ground"]);

afterEach(() => {
  setClassicLook(false);
  resetGroundForTests();
  localStorage.clear();
});

describe("groundPicker", () => {
  it("shows a picture swatch per Modern ground, Meadow chosen by default", () => {
    const picker = groundPicker(false);
    expect(swatches(picker).map((swatch) => swatch.dataset["ground"])).toEqual([
      "meadow",
      "original",
      "autumn",
      "desert",
      "snow",
      "swamp",
    ]);
    expect(chosen(picker)).toEqual(["meadow"]);
    const first = swatches(picker)[0]!;
    expect(first.querySelector("img")?.getAttribute("src")).toMatch(/ui\/grounds\/meadow\.webp$/);
    expect(first.title).toBe("Meadow");
    expect(picker.querySelector("[role='radiogroup']")).not.toBeNull();
  });

  it("shows Flash's four in Classic", () => {
    expect(swatches(groundPicker(true)).map((swatch) => swatch.dataset["ground"])).toEqual([
      "original",
      "rock",
      "sand",
      "crater",
    ]);
  });

  it("changes the yard at once for the page's own Style, and remembers it", () => {
    const heard = vi.fn();
    const stop = onGroundChange(heard);
    const picker = groundPicker(false);
    swatches(picker)[4]!.click();
    expect(chosen(picker)).toEqual(["snow"]);
    expect(heard).toHaveBeenCalledWith("snow");
    expect(currentGround()).toBe("snow");
    expect(localStorage.getItem(GROUND_KEY)).toBe("snow");
    expect(groundPicker(false).querySelector("[aria-checked='true']")?.getAttribute("data-ground")).toBe("snow");
    stop();
  });

  it("only saves a pick for the other Style, for after the reload", () => {
    const heard = vi.fn();
    const stop = onGroundChange(heard);
    const picker = groundPicker(true);
    expect(picker.querySelector(".field__hint")?.textContent).toBe(GROUND_TEXT.laterHint);
    swatches(picker)[3]!.click();
    expect(localStorage.getItem(CLASSIC_GROUND_KEY)).toBe("crater");
    expect(heard).not.toHaveBeenCalled();
    expect(currentGround()).toBe("meadow");
    stop();
  });

  it("moves the choice with the arrow keys, as a radio group does", () => {
    const picker = groundPicker(false);
    document.body.append(picker);
    swatches(picker)[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(chosen(picker)).toEqual(["swamp"]);
    expect(document.activeElement).toBe(swatches(picker)[5]);
    picker.remove();
  });
});
