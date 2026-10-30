import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Assets, Texture } from "pixi.js";
import { RETRY_DELAYS_MS, YardTextures } from "./YardTextures";
import type { ResolvedAnim, ResolvedImage } from "./buildingArt";

/**
 * A picture that fails to load is asked for again before the yard gives up on
 * it, as Flash's `ImageCache` did: one broken answer on a first load must not
 * leave a building without its picture until the page is reloaded.
 */

const wall: ResolvedImage = { url: "/assets/buildings/walls/top.1.png", x: 0, y: 0, frame: null };

const gun: ResolvedAnim = {
  url: "/assets/buildings/lasertower/anim.png",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  frames: 4,
  columns: 2,
};

/** Every wait the retries make, run straight through. */
const waitAll = async () => {
  for (const delay of RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(delay);
};

describe("YardTextures: a picture that does not load", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("is asked for again and used when a later try works", async () => {
    let calls = 0;
    vi.spyOn(Assets, "load").mockImplementation((() => {
      calls++;
      return calls < 3 ? Promise.reject(new Error("broken answer")) : Promise.resolve(Texture.WHITE);
    }) as typeof Assets.load);
    const arrived: string[] = [];
    const textures = new YardTextures((key) => arrived.push(key));

    expect(textures.get(wall)).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    // Failed once and waiting to ask again: still on its way, not missing.
    expect(textures.isMissing(wall)).toBe(false);
    expect(arrived).toEqual([]);

    await waitAll();
    expect(calls).toBe(3);
    expect(textures.get(wall)).toBe(Texture.WHITE);
    expect(arrived).toEqual([wall.url]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("counts as missing only after five tries, and is not asked for again after that", async () => {
    const load = vi
      .spyOn(Assets, "load")
      .mockImplementation((() => Promise.reject(new Error("gone"))) as typeof Assets.load);
    const arrived: string[] = [];
    const textures = new YardTextures((key) => arrived.push(key));

    textures.get(wall);
    // Asking every frame while the retries wait does not start another fetch.
    for (let frame = 0; frame < 10; frame++) textures.get(wall);
    await vi.advanceTimersByTimeAsync(0);
    for (const delay of RETRY_DELAYS_MS.slice(0, -1)) {
      await vi.advanceTimersByTimeAsync(delay);
      expect(textures.isMissing(wall)).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS.at(-1)!);

    expect(load).toHaveBeenCalledTimes(5);
    expect(textures.isMissing(wall)).toBe(true);
    expect(arrived).toEqual([wall.url]);
    expect(warn).toHaveBeenCalledOnce();

    expect(textures.get(wall)).toBeNull();
    await waitAll();
    expect(load).toHaveBeenCalledTimes(5);
  });

  it("knows a failed strip with columns is missing", async () => {
    vi.spyOn(Assets, "load").mockImplementation((() => Promise.reject(new Error("gone"))) as typeof Assets.load);
    const textures = new YardTextures(() => {});

    expect(textures.strip(gun)).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    await waitAll();
    expect(textures.isStripMissing(gun)).toBe(true);
  });

  it("stops asking once the yard is gone", async () => {
    const load = vi
      .spyOn(Assets, "load")
      .mockImplementation((() => Promise.reject(new Error("gone"))) as typeof Assets.load);
    const textures = new YardTextures(() => {});

    textures.get(wall);
    await vi.advanceTimersByTimeAsync(0);
    textures.destroy();
    await waitAll();
    expect(load).toHaveBeenCalledOnce();
  });
});
