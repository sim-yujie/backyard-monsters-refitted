// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, LOADING_ART_URL, MIST_MAX, createPrepareView } from "./PrepareDesigns";
import { PREPARE_LABEL } from "./PreparingMap";

/** The "Preparing map" prototypes A, B and C (owner, 8 Nov 2026). */
describe("Preparing map prototypes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const number = (root: HTMLElement): string | null | undefined => root.querySelector(".mr2-prep__number")?.textContent;
  const shown = (element: HTMLElement | null): boolean => element?.classList.contains("mr2-prep--shown") ?? false;

  it("keeps the first bar in its dock when no prototype is picked", () => {
    const view = createPrepareView("bar");
    expect(view.docked).toBe(true);
    expect(view.under).toBeNull();
    expect(view.over.classList.contains("mr2-prepare")).toBe(true);
  });

  it("A is a loading screen: the painted map picture, the two words, a big bar", () => {
    const view = createPrepareView("a");
    expect(view.docked).toBe(false);
    expect(view.over.classList.contains("mr2-prep-a")).toBe(true);
    expect(view.over.querySelector<HTMLImageElement>("img")?.src).toContain(LOADING_ART_URL);
    expect(view.over.textContent).toContain(PREPARE_LABEL);
    expect(view.over.querySelector(".mr2-prep__row--big")).not.toBeNull();
  });

  it("B is a strip with an icon, the two words, a broad bar and the percent", () => {
    const view = createPrepareView("b");
    view.set({ show: true, percent: 37 });
    expect(view.over.classList.contains("mr2-prep-b")).toBe(true);
    expect(view.over.querySelector("img")).not.toBeNull();
    expect(view.over.textContent).toContain(PREPARE_LABEL);
    expect(number(view.over)).toBe("37%");
    expect(view.over.getAttribute("aria-valuenow")).toBe("37");
    expect(shown(view.over)).toBe(true);
  });

  it("C's mist thins as it prepares and goes with the plaque", () => {
    const view = createPrepareView("c");
    const clouds = view.under?.querySelector<HTMLElement>(".mr2-prep-c-mist__clouds");
    view.set({ show: true, percent: 0 });
    expect(shown(view.under)).toBe(true);
    expect(Number(clouds?.style.opacity)).toBeCloseTo(MIST_MAX);
    view.set({ show: true, percent: 50 });
    expect(Number(clouds?.style.opacity)).toBeCloseTo(MIST_MAX / 2);
    view.set({ show: false, percent: 0 });
    expect(shown(view.under)).toBe(false);
    expect(shown(view.over)).toBe(false);
  });

  it("holds the full bar briefly at 100% before fading", () => {
    vi.useFakeTimers();
    const view = createPrepareView("b");
    view.set({ show: true, percent: 80 });
    view.set({ show: false, percent: 100 });
    expect(number(view.over)).toBe("100%");
    expect(shown(view.over)).toBe(true);
    view.set({ show: false, percent: 100 });
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(shown(view.over)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(shown(view.over)).toBe(false);
  });

  it("comes back if it shows again during the hold (the demo replayed), and never shows when it never started", () => {
    vi.useFakeTimers();
    const view = createPrepareView("a");
    view.set({ show: false, percent: 100 });
    expect(shown(view.over)).toBe(false);
    view.set({ show: true, percent: 90 });
    view.set({ show: false, percent: 100 });
    view.set({ show: true, percent: 5 });
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(shown(view.over)).toBe(true);
    expect(number(view.over)).toBe("5%");
    view.destroy();
  });
});
