// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MapRenderer } from "./MapRenderer";
import {
  PENDING_DELAY_MS,
  PrepareTracker,
  STALL_MS,
  preparedThisPage,
  resetPreparedThisPage,
  type NeededProgram,
  type WarmerView,
} from "./prepareProgress";
import type { Sight } from "./Sight";
import type { ZoneStore } from "./ZoneStore";

const look = vi.hoisted(() => ({ classic: false }));
vi.mock(import("@/game/classicLook"), async (original) => ({
  ...(await original()),
  classicLook: () => look.classic,
}));

/** The map's own state the screen reads, set directly (building the painted look needs a GPU). */
interface Inside {
  webGL2: boolean;
  paintedWanted: boolean;
  paintedBroken: boolean;
  painted: { drawsLevel(level: string): boolean; destroy(): void } | null;
  preparing: { tracker: PrepareTracker; look: unknown; warmer: unknown; level: string } | null;
}

/**
 * The "Preparing map" loading screen's state from the map (owner chose design A, 8 Nov 2026):
 * covering a first open from the start, following the compile, gone for good once the full look is
 * in, never on a map already prepared on this page, never in Classic, never stuck.
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

  beforeEach(() => {
    resetPreparedThisPage();
    ready.clear();
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

  /** A first open at High: the painted look wanted, WebGL2, its code not arrived yet. */
  const opening = (): { map: MapRenderer; inside: Inside; full: { on: boolean }; arrive: () => void } => {
    const map = new MapRenderer({} as ZoneStore, {} as Sight);
    const inside = map as unknown as Inside;
    inside.webGL2 = true;
    inside.paintedWanted = true;
    const full = { on: false };
    const arrive = (): void => {
      const tracker = new PrepareTracker(view);
      tracker.update(needed);
      inside.preparing = { tracker, look: {}, warmer: {}, level: "high" };
      inside.painted = { drawsLevel: () => full.on, destroy: () => undefined };
    };
    return { map, inside, full, arrive };
  };

  it("covers a first open at 0% while the look's code is on its way, after a moment", () => {
    const { map } = opening();
    expect(map.prepareState(1_000).show).toBe(false);
    expect(map.prepareState(1_000 + PENDING_DELAY_MS)).toEqual({ show: true, percent: 0 });
  });

  it("follows the compile, then ends at 100% for good once the full look is in", () => {
    const { map, full, arrive } = opening();
    map.prepareState(0);
    arrive();
    expect(map.prepareState(500)).toEqual({ show: true, percent: 0 });
    ready.add("ground-low");
    expect(map.prepareState(4_000)).toEqual({ show: true, percent: 25 });
    ready.add("ground-high");
    full.on = true;
    expect(map.prepareState(15_000)).toEqual({ show: false, percent: 100 });
    expect(preparedThisPage()).toBe(true);
    // A later Quality change waits with the Low look, without the screen.
    full.on = false;
    expect(map.prepareState(20_000)).toEqual({ show: false, percent: 100 });
  });

  it("never shows on a second open of the page: nothing while the code comes, nothing after", () => {
    const first = opening();
    first.map.prepareState(0);
    first.arrive();
    ready.add("ground-low");
    ready.add("ground-high");
    first.full.on = true;
    first.map.prepareState(100);

    const second = opening();
    expect(second.map.prepareState(0).show).toBe(false);
    expect(second.map.prepareState(PENDING_DELAY_MS * 10).show).toBe(false);
    second.arrive();
    expect(second.map.prepareState(PENDING_DELAY_MS * 20).show).toBe(false);
  });

  it("gives up and fades if the progress stands still for STALL_MS", () => {
    const { map, arrive } = opening();
    map.prepareState(0);
    arrive();
    ready.add("ground-low");
    expect(map.prepareState(1_000)).toEqual({ show: true, percent: 25 });
    expect(map.prepareState(1_000 + STALL_MS - 1).show).toBe(true);
    expect(map.prepareState(1_000 + STALL_MS)).toEqual({ show: false, percent: 25 });
    // It does not come back, even if the compile ends later.
    ready.add("ground-high");
    expect(map.prepareState(1_000 + STALL_MS + 5_000).show).toBe(false);
  });

  it("gives up too if the look's code never arrives", () => {
    const { map } = opening();
    map.prepareState(0);
    expect(map.prepareState(PENDING_DELAY_MS).show).toBe(true);
    expect(map.prepareState(PENDING_DELAY_MS + STALL_MS).show).toBe(false);
  });

  it("never shows in Classic", () => {
    look.classic = true;
    const { map, arrive } = opening();
    expect(map.prepareState(PENDING_DELAY_MS * 2).show).toBe(false);
    arrive();
    expect(map.prepareState(PENDING_DELAY_MS * 3).show).toBe(false);
  });

  it("goes when the painted look fails or is switched off", () => {
    const { map, inside, arrive } = opening();
    map.prepareState(0);
    arrive();
    expect(map.prepareState(100).show).toBe(true);
    inside.paintedBroken = true;
    expect(map.prepareState(200).show).toBe(false);
    inside.paintedBroken = false;
    inside.paintedWanted = false;
    expect(map.prepareState(300).show).toBe(false);
  });

  it("never covers without WebGL2 (no painted look at all)", () => {
    const { map, inside } = opening();
    inside.webGL2 = false;
    map.prepareState(0);
    expect(map.prepareState(PENDING_DELAY_MS * 2).show).toBe(false);
  });
});
