import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Assets, Texture } from "pixi.js";
import { LOAD_TRIES, loadWithRetries, RETRY_DELAYS_MS } from "./retryLoad";

/** Every wait the retries make, run straight through. */
const waitAll = async () => {
  for (const delay of RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(delay);
};

describe("loadWithRetries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("gives five tries over about four seconds, as Flash's ImageCache did", () => {
    expect(LOAD_TRIES).toBe(5);
    const total = RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
    expect(total).toBeGreaterThanOrEqual(3000);
    expect(total).toBeLessThanOrEqual(5000);
  });

  it("returns the picture from the first try that works", async () => {
    let calls = 0;
    vi.spyOn(Assets, "load").mockImplementation((() => {
      calls++;
      return calls < 4 ? Promise.reject(new Error("broken answer")) : Promise.resolve(Texture.WHITE);
    }) as typeof Assets.load);

    const loaded = loadWithRetries("/a.png");
    await waitAll();

    await expect(loaded).resolves.toBe(Texture.WHITE);
    expect(calls).toBe(4);
  });

  it("fails with the last error after five tries", async () => {
    let calls = 0;
    vi.spyOn(Assets, "load").mockImplementation((() => {
      calls++;
      return Promise.reject(new Error(`try ${calls}`));
    }) as typeof Assets.load);

    const loaded = loadWithRetries("/a.png");
    const settled = expect(loaded).rejects.toThrow("try 5");
    await waitAll();

    await settled;
    expect(calls).toBe(LOAD_TRIES);
  });

  it("stops asking once the asker has gone", async () => {
    const load = vi
      .spyOn(Assets, "load")
      .mockImplementation((() => Promise.reject(new Error("gone"))) as typeof Assets.load);
    let gone = false;

    const loaded = loadWithRetries("/a.png", () => gone);
    const settled = expect(loaded).rejects.toThrow("gone");
    await vi.advanceTimersByTimeAsync(0);
    gone = true;
    await waitAll();

    await settled;
    expect(load).toHaveBeenCalledOnce();
  });
});
