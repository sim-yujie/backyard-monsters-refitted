import { describe, expect, it, vi } from "vitest";
import type { Scene, SceneContext } from "./SceneManager";
import { withPresence } from "./presenceScene";

/** Every game screen holds the presence ping while it is up (#242). */

const fakePing = () => {
  let holders = 0;
  return {
    get holders() {
      return holders;
    },
    hold: vi.fn(() => {
      holders += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
      };
    }),
  };
};

const context = {} as SceneContext;

describe("withPresence", () => {
  it("holds the ping from enter to exit and passes every hook through", async () => {
    const ping = fakePing();
    const calls: string[] = [];
    const inner: Scene = {
      enter: async () => {
        calls.push(`enter:${ping.holders}`);
      },
      exit: () => calls.push(`exit:${ping.holders}`),
      update: (delta) => calls.push(`update:${delta}`),
      resize: (width, height) => calls.push(`resize:${width}x${height}`),
    };
    const scene = withPresence(() => inner, ping)();

    await scene.enter?.(context);
    scene.update?.(0.5);
    scene.resize?.(800, 600);
    expect(ping.holders).toBe(1);
    scene.exit?.();
    expect(ping.holders).toBe(0);
    // Held before the scene's own enter and still held through its exit.
    expect(calls).toEqual(["enter:1", "update:0.5", "resize:800x600", "exit:1"]);
  });

  it("keeps the inner scene's own `this`", async () => {
    class Counter implements Scene {
      ticks = 0;
      update(): void {
        this.ticks += 1;
      }
    }
    const inner = new Counter();
    const scene = withPresence(() => inner, fakePing())();
    await scene.enter?.(context);
    scene.update?.(1);
    expect(inner.ticks).toBe(1);
  });

  it("gives the hold back even when the scene's exit throws", () => {
    const ping = fakePing();
    const scene = withPresence(
      () => ({
        exit: () => {
          throw new Error("boom");
        },
      }),
      ping,
    )();
    void scene.enter?.(context);
    expect(() => scene.exit?.()).toThrow("boom");
    expect(ping.holders).toBe(0);
  });

  it("a scene with no hooks of its own still holds the ping", async () => {
    const ping = fakePing();
    const scene = withPresence(() => ({}), ping)();
    await scene.enter?.(context);
    expect(ping.holders).toBe(1);
    scene.exit?.();
    expect(ping.holders).toBe(0);
  });
});
