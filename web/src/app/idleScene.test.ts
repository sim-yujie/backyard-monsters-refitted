import { describe, expect, it, vi } from "vitest";
import { IdleState } from "@/game/presence/idleWatch";
import type { Scene, SceneContext } from "./SceneManager";
import { withIdle } from "./idleScene";

/** Every game screen holds the idle watch; an attack or a replay also defers the disconnect (#271). */

const fakeIdle = () => {
  const log: string[] = [];
  let state: IdleState = IdleState.WATCHING;
  const counted = (name: string) =>
    vi.fn(() => {
      log.push(`${name}+`);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        log.push(`${name}-`);
      };
    });
  return {
    log,
    hold: counted("hold"),
    defer: counted("defer"),
    get state() {
      return state;
    },
    set state(next: IdleState) {
      state = next;
    },
  };
};

const context = {} as SceneContext;

const recording = (log: string[]): Scene => ({
  enter: () => void log.push("enter"),
  exit: () => void log.push("exit"),
  update: () => void log.push("update"),
  resize: () => void log.push("resize"),
});

describe("withIdle", () => {
  it("holds the watch from before enter to after exit", async () => {
    const idle = fakeIdle();
    const scene = withIdle(() => recording(idle.log), idle)();
    await scene.enter?.(context);
    scene.update?.(0.016);
    scene.exit?.();
    expect(idle.log).toEqual(["hold+", "enter", "update", "exit", "hold-"]);
    expect(idle.defer).not.toHaveBeenCalled();
  });

  it("defers for an attack and gives the deferral back before the hold", async () => {
    const idle = fakeIdle();
    const scene = withIdle(() => recording(idle.log), idle, { defer: true })();
    await scene.enter?.(context);
    scene.exit?.();
    expect(idle.log).toEqual(["hold+", "defer+", "enter", "exit", "defer-", "hold-"]);
  });

  it("gives everything back when the scene's exit throws", async () => {
    const idle = fakeIdle();
    const scene = withIdle(
      () => ({
        exit: () => {
          throw new Error("boom");
        },
      }),
      idle,
      { defer: true },
    )();
    await scene.enter?.(context);
    expect(() => scene.exit?.()).toThrow("boom");
    expect(idle.log).toEqual(["hold+", "defer+", "defer-", "hold-"]);
  });

  it("never starts a screen opened after the disconnect", async () => {
    const idle = fakeIdle();
    idle.state = IdleState.DISCONNECTED;
    const scene = withIdle(() => recording(idle.log), idle)();
    await scene.enter?.(context);
    scene.update?.(0.016);
    scene.resize?.(800, 600);
    scene.exit?.();
    expect(idle.log).toEqual(["hold+", "hold-"]);
  });
});
