// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MapRenderer } from "./MapRenderer";
import { PrepareTracker, SHOW_DELAY_MS, type NeededProgram, type WarmerView } from "./prepareProgress";
import type { Sight } from "./Sight";
import type { ZoneStore } from "./ZoneStore";

const look = vi.hoisted(() => ({ classic: false }));
vi.mock(import("@/game/classicLook"), async (original) => ({
  ...(await original()),
  classicLook: () => look.classic,
}));

/** The map's own state the bar reads, set directly (building the painted look needs a GPU). */
interface Inside {
  paintedWanted: boolean;
  paintedBroken: boolean;
  painted: { drawsLevel(level: string): boolean; destroy(): void } | null;
  preparing: { tracker: PrepareTracker; look: unknown; warmer: unknown; level: string; since: number } | null;
}

/**
 * The "Preparing map… N%" bar's state from the map (owner, 7 Nov 2026): shown while the painted
 * look compiles on an open that had programs left to compile, gone for good once the full look is in.
 */
describe("MapRenderer.prepareState", () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
          putImageData: () => undefined,
        }) as unknown as ReturnType<HTMLCanvasElement["getContext"]>,
    );
  });

  afterEach(() => {
    look.classic = false;
  });

  const ready = new Set<string>();
  const view: WarmerView = {
    ready: (source) => ready.has(source.fragment ?? ""),
    failed: () => false,
    startedAt: () => null,
  };
  const needed: NeededProgram[] = [
    { key: "ground-low", source: { fragment: "ground-low" }, expectMs: 4_000 },
    { key: "ground-high", source: { fragment: "ground-high" }, expectMs: 12_000 },
  ];

  /** A map whose painted look's code arrived at time 0, with `needed` still to compile (High Quality). */
  const opened = (): { map: MapRenderer; inside: Inside; full: { on: boolean } } => {
    ready.clear();
    const map = new MapRenderer({} as ZoneStore, {} as Sight);
    const inside = map as unknown as Inside;
    const tracker = new PrepareTracker(view);
    tracker.update(needed);
    const full = { on: false };
    inside.paintedWanted = true;
    inside.preparing = { tracker, look: {}, warmer: {}, level: "high", since: 0 };
    inside.painted = { drawsLevel: () => full.on, destroy: () => undefined };
    return { map, inside, full };
  };

  it("is hidden before the painted look's code has arrived", () => {
    const map = new MapRenderer({} as ZoneStore, {} as Sight);
    expect(map.prepareState(10_000).show).toBe(false);
  });

  it("shows after a moment while programs compile, with the share done, then fades at 100% for good", () => {
    const { map, full } = opened();
    expect(map.prepareState(0).show).toBe(false);
    expect(map.prepareState(SHOW_DELAY_MS)).toEqual({ show: true, percent: 0 });
    ready.add("ground-low");
    expect(map.prepareState(SHOW_DELAY_MS + 3_000)).toEqual({ show: true, percent: 25 });
    ready.add("ground-high");
    full.on = true;
    expect(map.prepareState(SHOW_DELAY_MS + 10_000)).toEqual({ show: false, percent: 100 });
    // A later Quality change waits with the Low look, without the bar.
    full.on = false;
    expect(map.prepareState(SHOW_DELAY_MS + 20_000).show).toBe(false);
  });

  it("never shows when nothing was left to compile", () => {
    ready.add("ground-low");
    ready.add("ground-high");
    const map = new MapRenderer({} as ZoneStore, {} as Sight);
    const inside = map as unknown as Inside;
    const tracker = new PrepareTracker(view);
    tracker.update(needed);
    inside.paintedWanted = true;
    inside.preparing = { tracker, look: {}, warmer: {}, level: "high", since: 0 };
    expect(map.prepareState(SHOW_DELAY_MS * 10).show).toBe(false);
  });

  it("never shows in Classic, or once the painted look failed", () => {
    const { map, inside } = opened();
    look.classic = true;
    expect(map.prepareState(SHOW_DELAY_MS * 2).show).toBe(false);
    look.classic = false;
    expect(map.prepareState(SHOW_DELAY_MS * 2).show).toBe(true);
    inside.paintedBroken = true;
    expect(map.prepareState(SHOW_DELAY_MS * 2).show).toBe(false);
  });

  it("goes when the painted look is switched off", () => {
    const { map, inside } = opened();
    inside.paintedWanted = false;
    expect(map.prepareState(SHOW_DELAY_MS * 2).show).toBe(false);
  });
});
