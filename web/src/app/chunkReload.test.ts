import { describe, expect, it, vi } from "vitest";
import { CHUNK_RELOAD_GAP_MS, installChunkErrorReload, reloadForMissingChunk, type ChunkReloadDeps } from "./chunkReload";

/** A tab older than the live release reloads once for a missing script piece, never in a loop. */

const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
};

const deps = (now: () => number, storage = memoryStorage()): ChunkReloadDeps & { reload: ReturnType<typeof vi.fn> } => ({
  storage: () => storage,
  now,
  reload: vi.fn(),
});

describe("reloadForMissingChunk", () => {
  it("reloads the first time", () => {
    const d = deps(() => 1_000_000);
    expect(reloadForMissingChunk(d)).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload again within a minute of the last reload (no loop)", () => {
    let now = 1_000_000;
    const storage = memoryStorage();
    const first = deps(() => now, storage);
    expect(reloadForMissingChunk(first)).toBe(true);
    // The reloaded page fails again 5 s later: it shows its error instead.
    now += 5_000;
    const second = deps(() => now, storage);
    expect(reloadForMissingChunk(second)).toBe(false);
    expect(second.reload).not.toHaveBeenCalled();
    // A later release, long after: allowed once more.
    now += CHUNK_RELOAD_GAP_MS;
    const third = deps(() => now, storage);
    expect(reloadForMissingChunk(third)).toBe(true);
  });

  it("does not reload when session storage cannot be used (it could not count)", () => {
    const d: ChunkReloadDeps & { reload: ReturnType<typeof vi.fn> } = {
      storage: () => {
        throw new Error("SecurityError");
      },
      now: () => 1,
      reload: vi.fn(),
    };
    expect(reloadForMissingChunk(d)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
  });
});

describe("installChunkErrorReload", () => {
  const fire = (target: EventTarget) => target.dispatchEvent(new Event("vite:preloadError"));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("reloads when the live page names another release", async () => {
    const target = new EventTarget();
    const reload = deps(() => 1_000_000);
    installChunkErrorReload(
      { running: "/static/index-old.js", liveBundle: async () => "/static/index-new.js", reload },
      target as unknown as Window,
    );
    fire(target);
    await settle();
    expect(reload.reload).toHaveBeenCalledTimes(1);
  });

  it("leaves a dropped connection alone: same release, or the page could not be checked", async () => {
    for (const liveBundle of [async () => "/static/index-old.js", async () => null, () => Promise.reject(new Error("offline"))]) {
      const target = new EventTarget();
      const reload = deps(() => 1_000_000);
      installChunkErrorReload({ running: "/static/index-old.js", liveBundle, reload }, target as unknown as Window);
      fire(target);
      await settle();
      expect(reload.reload).not.toHaveBeenCalled();
    }
  });

  it("does nothing in a dev build and stops listening when removed", async () => {
    const target = new EventTarget();
    const liveBundle = vi.fn(async () => "/static/index-new.js");
    const reload = deps(() => 1_000_000);
    installChunkErrorReload({ running: null, liveBundle, reload }, target as unknown as Window);
    fire(target);
    await settle();
    expect(liveBundle).not.toHaveBeenCalled();

    const other = new EventTarget();
    const stop = installChunkErrorReload(
      { running: "/static/index-old.js", liveBundle, reload },
      other as unknown as Window,
    );
    stop();
    fire(other);
    await settle();
    expect(reload.reload).not.toHaveBeenCalled();
  });
});
