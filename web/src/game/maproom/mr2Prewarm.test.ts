import { afterEach, describe, expect, it, vi } from "vitest";
import type { Renderer } from "pixi.js";
import {
  isYardDownload,
  prewarmLevel,
  prewarmStarted,
  resetPrewarm,
  runPrewarm,
  watchIdle,
  type PaintedWarmup,
  type PrewarmFacts,
} from "./mr2Prewarm";

/** Map Room 2's warm-up in the yard (MR2 open speed, 7 Nov 2026). */

afterEach(() => resetPrewarm());

const facts = (extra: Partial<PrewarmFacts> = {}): PrewarmFacts => ({
  level: "high",
  classic: false,
  mapRoom2: true,
  painted: true,
  webGL2: true,
  ...extra,
});

describe("prewarmLevel: whether, and at which Quality, to warm up", () => {
  it("warms at the player's own Quality on High and Medium", () => {
    expect(prewarmLevel(facts())).toBe("high");
    expect(prewarmLevel(facts({ level: "medium" }))).toBe("medium");
  });

  it("does nothing on Low, in Classic, without the painted look, without WebGL2, or without Map Room 2", () => {
    expect(prewarmLevel(facts({ level: "low" }))).toBeNull();
    expect(prewarmLevel(facts({ classic: true }))).toBeNull();
    expect(prewarmLevel(facts({ painted: false }))).toBeNull();
    expect(prewarmLevel(facts({ webGL2: false }))).toBeNull();
    expect(prewarmLevel(facts({ mapRoom2: false }))).toBeNull();
  });

  it("does nothing when switched off in the browser (for measuring)", () => {
    expect(prewarmLevel(facts({ switchedOff: true }))).toBeNull();
  });
});

/** A clock and a hand-driven interval. */
const harness = (state: { settled: boolean; download: number | null }) => {
  let now = 0;
  let tick: (() => void) | null = null;
  const run = vi.fn();
  const stop = watchIdle({
    settled: () => state.settled,
    lastDownloadAt: () => state.download,
    now: () => now,
    run,
    quietMs: 5_000,
    checkMs: 1_000,
    every: (callback) => {
      tick = callback;
      return () => {
        tick = null;
      };
    },
  });
  const advance = (seconds: number): void => {
    for (let index = 0; index < seconds; index++) {
      now += 1_000;
      tick?.();
    }
  };
  return { run, stop, advance, running: () => tick !== null };
};

describe("isYardDownload: the files that count as the yard still loading", () => {
  it("counts pictures, sounds and code, never the game's periodic requests", () => {
    expect(isYardDownload("https://bymrevamped.com/buildings/hall@2x.webp?v=3")).toBe(true);
    expect(isYardDownload("/assets/sounds/yard.mp3")).toBe(true);
    expect(isYardDownload("/static/index-abc.js")).toBe(true);
    expect(isYardDownload("https://api.bymrevamped.com/api/v1.6.1-beta/player/presence")).toBe(false);
    expect(isYardDownload("https://api.bymrevamped.com/base/load")).toBe(false);
  });
});

describe("watchIdle: the warm-up waits for the yard to go quiet", () => {
  it("runs once the yard has been settled for the quiet time, then stops watching", () => {
    const h = harness({ settled: true, download: null });
    h.advance(4);
    expect(h.run).not.toHaveBeenCalled();
    h.advance(2);
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.running()).toBe(false);
    h.advance(10);
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it("starts the wait again whenever the yard is busy (a request in flight or queued)", () => {
    const state = { settled: true, download: null };
    const h = harness(state);
    h.advance(4);
    state.settled = false;
    h.advance(1);
    state.settled = true;
    h.advance(4);
    expect(h.run).not.toHaveBeenCalled();
    h.advance(2);
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it("waits until no download has landed for the quiet time (the yard's own pictures first)", () => {
    const state: { settled: boolean; download: number | null } = { settled: true, download: null };
    const h = harness(state);
    h.advance(3);
    state.download = 3_000;
    h.advance(4);
    expect(h.run).not.toHaveBeenCalled();
    h.advance(1);
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it("never runs once stopped (the yard closed)", () => {
    const h = harness({ settled: true, download: null });
    h.advance(2);
    h.stop();
    h.advance(10);
    expect(h.run).not.toHaveBeenCalled();
  });
});

const renderer = (gl: unknown = { isContextLost: () => false }) => ({ gl }) as unknown as Renderer;

const look = (): PaintedWarmup & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    warmAhead: vi.fn(async (_renderer, _gl, level) => {
      calls.push(`shaders:${level}`);
      return [true, true];
    }),
    prefetchArt: vi.fn(async (level, go) => {
      calls.push(`art:${level}:${go()}`);
      return go() ? 7 : 0;
    }),
  };
};

describe("runPrewarm: code, shaders, then pictures, once a page", () => {
  it("starts the shaders before fetching the pictures, at the given Quality", async () => {
    const painted = look();
    const result = await runPrewarm(renderer(), "medium", () => true, async () => painted);
    expect(painted.calls).toEqual(["shaders:medium", "art:medium:true"]);
    expect(result).toEqual({ programs: true, pictures: 7 });
  });

  it("runs once a page however often it is asked", async () => {
    const painted = look();
    await runPrewarm(renderer(), "high", () => true, async () => painted);
    expect(prewarmStarted()).toBe(true);
    const again = await runPrewarm(renderer(), "high", () => true, async () => painted);
    expect(again).toEqual({ programs: false, pictures: 0 });
    expect(painted.warmAhead).toHaveBeenCalledTimes(1);
  });

  it("does nothing more once the yard is busy again by the time the code arrives", async () => {
    const painted = look();
    const result = await runPrewarm(renderer(), "high", () => false, async () => painted);
    expect(painted.warmAhead).not.toHaveBeenCalled();
    expect(painted.prefetchArt).not.toHaveBeenCalled();
    expect(result.pictures).toBe(0);
  });

  it("does nothing on a lost or missing context, and never throws when the code does not arrive", async () => {
    const painted = look();
    expect((await runPrewarm(renderer({ isContextLost: () => true }), "high", () => true, async () => painted)).programs).toBe(false);
    resetPrewarm();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failed = await runPrewarm(renderer(), "high", () => true, () => Promise.reject(new Error("offline")));
    expect(failed).toEqual({ programs: false, pictures: 0 });
    expect(painted.warmAhead).not.toHaveBeenCalled();
  });
});
