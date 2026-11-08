// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, LOADING_ART_URL, PREPARE_LABEL, PreparingMap } from "./PreparingMap";

/** Map Room 2's "Preparing map" loading screen (owner chose design A, 8 Nov 2026). */
describe("PreparingMap", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const parts = (screen: PreparingMap) => ({
    fill: screen.element.querySelector<HTMLElement>(".mr2-prepare__fill"),
    number: screen.element.querySelector(".mr2-prepare__number")?.textContent,
    up: screen.element.classList.contains("mr2-prepare--shown"),
  });

  it("is a framed card with the painted map picture, the two words and a big bar, hidden at first", () => {
    const screen = new PreparingMap();
    expect(screen.showing).toBe(false);
    expect(parts(screen).up).toBe(false);
    expect(screen.element.getAttribute("aria-hidden")).toBe("true");
    expect(screen.element.getAttribute("role")).toBe("progressbar");
    // `.panel` gives it the window's frame: Modern steel, Classic parchment.
    expect(screen.element.querySelector(".mr2-prepare__card")?.classList.contains("panel")).toBe(true);
    expect(screen.element.querySelector<HTMLImageElement>(".mr2-prepare__art")?.src).toContain(LOADING_ART_URL);
    expect(screen.element.querySelector(".mr2-prepare__title")?.textContent).toBe(PREPARE_LABEL);
  });

  it("shows the percent as a bar and a number", () => {
    const screen = new PreparingMap();
    screen.set({ show: true, percent: 42.4 });
    expect(screen.showing).toBe(true);
    expect(parts(screen).up).toBe(true);
    expect(parts(screen).fill?.style.width).toBe("42%");
    expect(parts(screen).number).toBe("42%");
    expect(screen.element.getAttribute("aria-valuenow")).toBe("42");
    expect(screen.element.getAttribute("aria-hidden")).toBe("false");
  });

  it("holds the full bar at 100% for a moment, then fades into the map", () => {
    vi.useFakeTimers();
    const screen = new PreparingMap();
    screen.set({ show: true, percent: 80 });
    screen.set({ show: false, percent: 100 });
    expect(parts(screen).number).toBe("100%");
    expect(screen.showing).toBe(true);
    // Asked again every frame meanwhile: the hold does not start over.
    vi.advanceTimersByTime(HOLD_MS - 1);
    screen.set({ show: false, percent: 100 });
    expect(screen.showing).toBe(true);
    vi.advanceTimersByTime(1);
    expect(screen.showing).toBe(false);
    expect(parts(screen).up).toBe(false);
  });

  it("fades straight away when it gives up (stalled) or the look is switched off", () => {
    const screen = new PreparingMap();
    screen.set({ show: true, percent: 30 });
    screen.set({ show: false, percent: 30 });
    expect(screen.showing).toBe(false);
    expect(parts(screen).number).toBe("30%");
  });

  it("never appears when it was never needed", () => {
    vi.useFakeTimers();
    const screen = new PreparingMap();
    screen.set({ show: false, percent: 100 });
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(screen.showing).toBe(false);
    expect(parts(screen).up).toBe(false);
  });

  it("swallows clicks and wheel turns while it shows, so nothing behind it reacts", () => {
    const screen = new PreparingMap();
    screen.set({ show: true, percent: 10 });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true });
    screen.element.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
  });

  it("clears its hold timer when the map closes", () => {
    vi.useFakeTimers();
    const screen = new PreparingMap();
    screen.set({ show: true, percent: 99 });
    screen.set({ show: false, percent: 100 });
    screen.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});

/**
 * The screen must stay over every Map Room 2 control while it shows (owner, 8 Nov 2026): the Key
 * button and its legend card (friends work), the hover card, the tool row. They all live in the
 * same overlay, so every z-index in the map's stylesheet must stay under the screen's.
 */
describe("the Preparing map screen stays on top of the map's controls", () => {
  const css = readFileSync(resolve(process.cwd(), "src/ui/styles/maproom.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: (selector ?? "").trim(),
    body: body ?? "",
  }));
  const zOf = (body: string): string | null => /z-index:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? null;
  const screenZ = Number(zOf(blocks.find(({ selector }) => selector === ".mr2-prepare")?.body ?? ""));
  /** The design tokens these rules use (tokens.css): the overlay is 10, the top bar 20. */
  const TOKENS: Record<string, number> = { "var(--z-canvas)": 0, "var(--z-overlay)": 10 };

  it("has a z-index above the overlay (10) and below the top bar (20), which stays usable", () => {
    expect(screenZ).toBeGreaterThan(10);
    expect(screenZ).toBeLessThan(20);
  });

  it("is above the Key button's legend card and every other map control", () => {
    const others = blocks.filter(({ selector, body }) => zOf(body) !== null && !selector.includes("mr2-prepare"));
    expect(others.some(({ selector }) => selector.includes(".mr2-key"))).toBe(true);
    for (const { selector, body } of others) {
      const raw = zOf(body) ?? "";
      const z = raw in TOKENS ? TOKENS[raw] : Number(raw);
      expect({ selector, z }).toEqual({ selector, z: expect.any(Number) });
      expect(z, selector).toBeLessThan(screenZ);
    }
  });
});
