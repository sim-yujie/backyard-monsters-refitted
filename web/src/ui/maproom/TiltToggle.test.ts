// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { TILT_TOGGLE_TEXT, TiltToggle } from "./TiltToggle";

/** The "Tilted map" button beside the zoom (MR2 look plan step 4). */
describe("TiltToggle", () => {
  it("stays hidden until the map can tilt", () => {
    const toggle = new TiltToggle(() => {});
    expect(toggle.element.hidden).toBe(true);
    toggle.set({ available: false, tilted: false });
    expect(toggle.element.hidden).toBe(true);
    toggle.set({ available: true, tilted: true });
    expect(toggle.element.hidden).toBe(false);
  });

  it("is pressed while the map is tilted and says what a press does", () => {
    const toggle = new TiltToggle(() => {});
    toggle.set({ available: true, tilted: true });
    expect(toggle.element.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.element.getAttribute("aria-label")).toBe(TILT_TOGGLE_TEXT.tilted);
    toggle.set({ available: true, tilted: false });
    expect(toggle.element.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.element.title).toBe(TILT_TOGGLE_TEXT.flat);
    expect(toggle.element.querySelector("svg")).not.toBeNull();
  });

  it("asks for the other state on a press, and leaves the state to the scene", () => {
    const onToggle = vi.fn();
    const toggle = new TiltToggle(onToggle);
    toggle.set({ available: true, tilted: true });
    toggle.element.click();
    expect(onToggle).toHaveBeenLastCalledWith(false);
    expect(toggle.isTilted).toBe(true);
    toggle.set({ available: true, tilted: false });
    toggle.element.click();
    expect(onToggle).toHaveBeenLastCalledWith(true);
  });
});
