import { describe, expect, it, vi } from "vitest";
import { makeGameLoader } from "./gameLoader";
import type { GameScenes } from "./gameScenes";

/** The game past sign-in is fetched once, early; a failed fetch can be tried again. */

const scenes = { yard: () => ({}) } as unknown as GameScenes;

describe("makeGameLoader", () => {
  it("fetches once for the preload and every later ask", async () => {
    const fetchModule = vi.fn(async () => ({ gameScenes: scenes }));
    const loader = makeGameLoader(fetchModule, vi.fn());
    expect(loader.ready()).toBeNull();
    loader.preload();
    await expect(loader.load()).resolves.toBe(scenes);
    await expect(loader.load()).resolves.toBe(scenes);
    expect(loader.ready()).toBe(scenes);
    expect(fetchModule).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed preload quiet and tries again on the next ask", async () => {
    const fetchModule = vi
      .fn<() => Promise<{ gameScenes: GameScenes }>>()
      .mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module"))
      .mockResolvedValueOnce({ gameScenes: scenes });
    const onFailedLoad = vi.fn();
    const loader = makeGameLoader(fetchModule, onFailedLoad);
    loader.preload();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onFailedLoad).not.toHaveBeenCalled();
    await expect(loader.load()).resolves.toBe(scenes);
    expect(fetchModule).toHaveBeenCalledTimes(2);
  });

  it("asks for the reload when a real ask fails, and still rejects", async () => {
    const error = new Error("Failed to fetch dynamically imported module");
    const onFailedLoad = vi.fn();
    const loader = makeGameLoader(() => Promise.reject(error), onFailedLoad);
    await expect(loader.load()).rejects.toBe(error);
    expect(onFailedLoad).toHaveBeenCalledTimes(1);
    expect(loader.ready()).toBeNull();
  });
});
