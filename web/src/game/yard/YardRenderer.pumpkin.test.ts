import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Assets, Texture } from "pixi.js";
import { LOAD_TRIES, RETRY_DELAYS_MS } from "./retryLoad";
import { YardRenderer } from "./YardRenderer";

/**
 * The Halloween pumpkin gets the same five tries as a building picture: one
 * broken answer on a first load must not leave mushrooms all Halloween.
 */

const PUMPKIN = "/assets/buildings/decorations/pumpkins/top.png";

/** Every wait the retries make, run straight through. */
const waitAll = async () => {
  for (const delay of RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(delay);
};

/** The renderer's pumpkin picture, private to it. */
const pumpkinOf = (renderer: YardRenderer) => (renderer as unknown as { pumpkin: Texture | null }).pumpkin;

describe("YardRenderer: the Halloween pumpkin", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("is asked for again when a try fails, and used once one works", async () => {
    let calls = 0;
    const load = vi.spyOn(Assets, "load").mockImplementation((() => {
      calls++;
      return calls < 3 ? Promise.reject(new Error("broken answer")) : Promise.resolve(Texture.WHITE);
    }) as typeof Assets.load);
    const renderer = new YardRenderer();

    renderer.setSeason("halloween");
    await vi.advanceTimersByTimeAsync(0);
    expect(pumpkinOf(renderer)).toBeNull();
    await waitAll();

    expect(load).toHaveBeenCalledTimes(3);
    expect(load).toHaveBeenCalledWith(PUMPKIN);
    expect(pumpkinOf(renderer)).toBe(Texture.WHITE);
    expect(warn).not.toHaveBeenCalled();
  });

  it("gives up after five tries, and a season switched back meanwhile does not ask twice", async () => {
    const load = vi
      .spyOn(Assets, "load")
      .mockImplementation((() => Promise.reject(new Error("gone"))) as typeof Assets.load);
    const renderer = new YardRenderer();

    renderer.setSeason("halloween");
    await vi.advanceTimersByTimeAsync(0);
    renderer.setSeason("normal");
    renderer.setSeason("halloween");
    await waitAll();

    expect(load).toHaveBeenCalledTimes(LOAD_TRIES);
    expect(pumpkinOf(renderer)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("stops asking once the yard is gone", async () => {
    const load = vi
      .spyOn(Assets, "load")
      .mockImplementation((() => Promise.reject(new Error("gone"))) as typeof Assets.load);
    const renderer = new YardRenderer();

    renderer.setSeason("halloween");
    await vi.advanceTimersByTimeAsync(0);
    renderer.destroy();
    await waitAll();

    expect(load).toHaveBeenCalledOnce();
  });
});
