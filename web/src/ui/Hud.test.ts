// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exactLabel, formatDelta, Hud } from "./Hud";
import { spokenText } from "./resourceIcon";

/**
 * The HUD's readouts: icons for the words (#93), and every change visible
 * however big the pool (#92) — the exact figure on hover and on a tap, and a
 * short float of the difference.
 */

describe("the HUD", () => {
  let hud: Hud;

  beforeEach(() => {
    vi.useFakeTimers();
    hud = new Hud({ scenes: [{ id: "yard", label: "Yard" }], onSceneSelect: () => {} }).mount(document.body);
  });

  afterEach(() => {
    hud.destroy();
    vi.useRealTimers();
  });

  const button = (key: string): HTMLButtonElement =>
    hud.element.querySelector<HTMLButtonElement>(`.hud__resource-button[data-resource="${key}"]`)!;
  const floats = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".hud__delta")];
  const bubble = (): HTMLElement | null => document.querySelector(".hud__exact");

  it("shows each resource as its icon and a short amount, with the word kept for hover and screen readers", () => {
    hud.setResources({ r1: 11_163_050_000, r2: 2_500, r3: 0, r4: 999 }, 42);
    expect(hud.element.textContent).not.toMatch(/twigs|pebbles|putty|goo|shiny/i);
    const readouts = [...hud.element.querySelectorAll<HTMLButtonElement>(".hud__resource-button")];
    expect(readouts.map((one) => one.textContent)).toEqual(["11.16B", "2.5K", "0", "999", "42"]);
    expect(readouts.map((one) => one.querySelectorAll(".res-icon").length)).toEqual([1, 1, 1, 1, 1]);
    // The button's own name carries the word and the exact amount; the icon is
    // decorative inside it so the name is not read twice.
    expect(button("r1").getAttribute("aria-label")).toBe("Twigs: 11,163,050,000");
    expect(button("r1").title).toBe("Twigs: 11,163,050,000");
    expect(button("shiny").title).toBe("Shiny: 42");
    expect(button("r1").querySelector(".res-icon")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("starts as dashes and leaves a readout alone when its amount is missing", () => {
    expect(button("r2").textContent).toBe("—");
    expect(button("r2").title).toBe("Pebbles: not known yet");
    hud.setResources({ r1: 5 });
    expect(button("r2").textContent).toBe("—");
    expect(button("shiny").textContent).toBe("—");
  });

  it("floats the difference when an amount changes, but not when it first arrives", () => {
    hud.setResources({ r1: 11_163_050_000, r2: 100 });
    expect(floats()).toHaveLength(0);

    hud.setResources({ r1: 11_158_050_000, r2: 100 });
    // 11.16B both times: the float is what shows the 5M went.
    expect(button("r1").textContent).toBe("11.16B");
    expect(button("r1").title).toBe("Twigs: 11,158,050,000");
    const [float] = floats();
    expect(floats()).toHaveLength(1);
    expect(float?.textContent).toBe("−5.0M");
    expect(float?.classList.contains("hud__delta--down")).toBe(true);
    expect(float?.getAttribute("aria-hidden")).toBe("true");

    // A float lives briefly, then goes on its own.
    vi.advanceTimersByTime(2_000);
    expect(floats()).toHaveLength(0);

    hud.setResources({ r2: 350 });
    expect(floats().map((one) => one.textContent)).toEqual(["+250"]);
    expect(floats()[0]?.classList.contains("hud__delta--up")).toBe(true);
  });

  it("replaces a readout's float rather than stacking them, and takes them away with the bar", () => {
    hud.setResources({ r1: 1_000, r2: 10 });
    hud.setResources({ r1: 900, r2: 20 });
    hud.setResources({ r1: 800 });
    expect(floats().map((one) => one.textContent)).toEqual(["+10", "−100"]);
    hud.destroy();
    expect(floats()).toHaveLength(0);
  });

  it("opens the exact amount on a tap, follows changes, and closes on a second tap or Escape", () => {
    hud.setResources({ r1: 11_163_050_000 });
    button("r1").click();
    expect(spokenText(bubble()!)).toBe("Twigs 11,163,050,000");
    expect(button("r1").getAttribute("aria-expanded")).toBe("true");

    hud.setResources({ r1: 11_158_040_000 });
    expect(spokenText(bubble()!)).toBe("Twigs 11,158,040,000");

    button("r1").click();
    expect(bubble()).toBeNull();
    expect(button("r1").hasAttribute("aria-expanded")).toBe(false);

    button("r1").click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(bubble()).toBeNull();
  });

  it("moves the bubble to another readout, and closes it on its own after a while", () => {
    hud.setResources({ r1: 1, r2: 2 });
    button("r1").click();
    button("r2").click();
    expect(document.querySelectorAll(".hud__exact")).toHaveLength(1);
    expect(spokenText(bubble()!)).toBe("Pebbles 2");
    vi.advanceTimersByTime(6_000);
    expect(bubble()).toBeNull();
  });

  it("closes the bubble on a press elsewhere", () => {
    hud.setResources({ r1: 1 });
    button("r1").click();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(bubble()).toBeNull();
  });
});

describe("the HUD's spellings", () => {
  it("signs a change with a real minus", () => {
    expect(formatDelta(-5_000_000)).toBe("−5.0M");
    expect(formatDelta(12)).toBe("+12");
    expect(formatDelta(1_500)).toBe("+1.5K");
  });

  it("writes the exact amount with thousands separators, whole units only", () => {
    expect(exactLabel("r1", 11_158_040_000.7)).toBe("Twigs: 11,158,040,000");
    expect(exactLabel("r4", undefined)).toBe("Goo: not known yet");
  });
});
