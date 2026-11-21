import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Assets, Texture } from "pixi.js";
import { BUILDING_ART_VERSION, COPY_TRIES, LOAD_TRIES, loadWithRetries, RETRY_DELAYS_MS, versionedArt } from "./retryLoad";
import { setQuality } from "@/game/quality";

/** Every wait the retries make, run straight through. */
const waitAll = async () => {
  for (const delay of RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(delay);
};

describe("versionedArt", () => {
  it("asks for a building picture by version, so a release's positions meet its pictures", () => {
    expect(versionedArt("/assets/buildings/snipertower/turret.t2@2x.webp")).toBe(
      `/assets/buildings/snipertower/turret.t2@2x.webp?v=${BUILDING_ART_VERSION}`,
    );
  });

  it("leaves every other address as it is", () => {
    expect(versionedArt("/assets/monsters/pokey-anim@4x.png?v=feco")).toBe("/assets/monsters/pokey-anim@4x.png?v=feco");
  });
});

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

  it("asks for the Quality copy of a building picture twice, then for its @2x (beta 9)", async () => {
    setQuality("low", null);
    const asked: string[] = [];
    vi.spyOn(Assets, "load").mockImplementation(((url: string) => {
      asked.push(url);
      return url.includes("@2x") ? Promise.resolve(Texture.WHITE) : Promise.reject(new Error("404"));
    }) as typeof Assets.load);
    try {
      const loaded = loadWithRetries("/assets/buildings/snipertower/turret.t2@2x.webp");
      await waitAll();
      await expect(loaded).resolves.toBe(Texture.WHITE);
      expect(asked).toEqual([
        `/assets/buildings/snipertower/turret.t2@1x.webp?v=${BUILDING_ART_VERSION}`,
        `/assets/buildings/snipertower/turret.t2@1x.webp?v=${BUILDING_ART_VERSION}`,
        `/assets/buildings/snipertower/turret.t2@2x.webp?v=${BUILDING_ART_VERSION}`,
      ]);
      expect(COPY_TRIES).toBe(2);
    } finally {
      setQuality("high", null);
    }
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
