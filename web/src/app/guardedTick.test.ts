import { afterEach, describe, expect, it, vi } from "vitest";
import { Ticker } from "pixi.js";
import { GUARD_REPORT_MAX, guardTick, reportToWindow } from "./guardedTick";

/** One throw in a scene's update must not freeze the game (audit 2026-10-29, W1). */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("guardTick", () => {
  it("passes the time through and keeps ticking after a throw", () => {
    const seen: number[] = [];
    const report = vi.fn();
    const guard = guardTick((dt) => {
      seen.push(dt);
      if (dt === 2) throw new Error("scene broke");
    }, report);

    expect(() => guard.run(1)).not.toThrow();
    expect(() => guard.run(2)).not.toThrow();
    expect(() => guard.run(3)).not.toThrow();

    expect(seen).toEqual([1, 2, 3]);
    expect(report).toHaveBeenCalledTimes(1);
    expect((report.mock.calls[0]![0] as Error).message).toBe("scene broke");
    expect(guard.caught()).toBe(1);
  });

  it("reports the same error once, however many frames it throws", () => {
    const report = vi.fn();
    const guard = guardTick(() => {
      throw new TypeError("x is undefined");
    }, report);
    for (let frame = 0; frame < 600; frame += 1) guard.run(1 / 60);
    expect(report).toHaveBeenCalledTimes(1);
    expect(guard.caught()).toBe(600);
  });

  it("reports each distinct error, up to the cap", () => {
    const report = vi.fn();
    let frame = 0;
    const guard = guardTick(() => {
      frame += 1;
      throw new Error(`broke on frame ${frame}`);
    }, report);
    for (let i = 0; i < GUARD_REPORT_MAX + 5; i += 1) guard.run(1 / 60);
    expect(report).toHaveBeenCalledTimes(GUARD_REPORT_MAX);
    expect(guard.caught()).toBe(GUARD_REPORT_MAX + 5);
  });

  it("survives a reporter that throws itself", () => {
    const guard = guardTick(
      () => {
        throw new Error("scene broke");
      },
      () => {
        throw new Error("reporter broke");
      },
    );
    expect(() => guard.run(1)).not.toThrow();
  });

  it("keeps a real Pixi ticker scheduling frames", () => {
    // Pixi asks for the next frame only after every listener returns: an
    // unguarded throw ends the loop, the guarded one does not.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => frames.push(run));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const ticker = new Ticker();
    ticker.autoStart = false;
    let updates = 0;
    const guard = guardTick(() => {
      updates += 1;
      throw new Error("scene broke");
    }, vi.fn());
    ticker.add(() => guard.run(ticker.deltaMS / 1000));
    ticker.start();

    for (let i = 0; i < 3; i += 1) frames.shift()!(performance.now() + 16 * (i + 1));

    expect(updates).toBe(3);
    expect(frames.length).toBe(1);
    ticker.destroy();
  });
});

describe("reportToWindow", () => {
  it("uses the browser's reportError, which fires the window error event the reporters listen to", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const error = new Error("scene broke");
    reportToWindow(error);
    expect(reportError).toHaveBeenCalledWith(error);
  });

  it("falls back to a rethrow on a fresh task where reportError is missing", () => {
    vi.stubGlobal("reportError", undefined);
    vi.useFakeTimers();
    const error = new Error("scene broke");
    reportToWindow(error);
    expect(() => vi.runAllTimers()).toThrow(error);
  });
});
