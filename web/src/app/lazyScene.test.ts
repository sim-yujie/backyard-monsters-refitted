// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createOverlay } from "@/ui/overlay";
import type { Scene, SceneContext } from "./SceneManager";
import { GAME_LOAD_FAILED_TEXT, GAME_LOADING_TEXT, lazyScene, type LazySource } from "./lazyScene";

vi.mock("@/game/bugReport/errorReporter", () => ({ reportCaughtError: vi.fn() }));

/** A screen whose code is fetched on demand behaves as the screen itself once it is in. */

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const recordingScene = (calls: string[]): Scene => ({
  enter: async () => void calls.push("enter"),
  exit: () => void calls.push("exit"),
  update: (delta) => void calls.push(`update:${delta}`),
  resize: (width, height) => void calls.push(`resize:${width}x${height}`),
});

const contextOn = () => {
  const overlay = createOverlay(document.createElement("div"));
  return { overlay, context: { overlay } as unknown as SceneContext };
};

describe("lazyScene", () => {
  it("hands every hook to the real scene when the code is already in", async () => {
    const calls: string[] = [];
    const source: LazySource<string> = { ready: () => "code", load: vi.fn() };
    const make = vi.fn(() => recordingScene(calls));
    const scene = lazyScene(source, make);
    const { overlay, context } = contextOn();
    await scene.enter?.(context);
    scene.update?.(0.5);
    scene.resize?.(10, 20);
    scene.exit?.();
    expect(make).toHaveBeenCalledWith("code");
    expect(source.load).not.toHaveBeenCalled();
    expect(calls).toEqual(["enter", "update:0.5", "resize:10x20", "exit"]);
    expect(overlay.content.textContent).not.toContain(GAME_LOADING_TEXT);
  });

  it("shows the loading window while the code is on its way, then removes it", async () => {
    const calls: string[] = [];
    const wait = deferred<string>();
    const scene = lazyScene({ ready: () => null, load: () => wait.promise }, () => recordingScene(calls));
    const { overlay, context } = contextOn();
    const entering = scene.enter?.(context);
    expect(overlay.content.textContent).toContain(GAME_LOADING_TEXT);
    // Frames before the code is in go nowhere.
    scene.update?.(0.1);
    wait.resolve("code");
    await entering;
    expect(overlay.content.textContent).not.toContain(GAME_LOADING_TEXT);
    expect(calls).toEqual(["enter"]);
  });

  it("never makes the scene when it was left before the code came", async () => {
    const wait = deferred<string>();
    const make = vi.fn(() => recordingScene([]));
    const scene = lazyScene({ ready: () => null, load: () => wait.promise }, make);
    const entering = scene.enter?.(contextOn().context);
    scene.exit?.();
    wait.resolve("code");
    await entering;
    expect(make).not.toHaveBeenCalled();
  });

  it("says the game could not load when the code cannot be fetched", async () => {
    const scene = lazyScene({ ready: () => null, load: () => Promise.reject(new Error("offline")) }, () =>
      recordingScene([]),
    );
    const { overlay, context } = contextOn();
    await scene.enter?.(context);
    expect(overlay.content.textContent).toContain(GAME_LOAD_FAILED_TEXT);
  });
});
