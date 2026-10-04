import { describe, expect, it } from "vitest";
import type { Container, Renderer } from "pixi.js";
import type { Overlay } from "@/ui/overlay";
import { SceneManager, type Scene } from "./SceneManager";

/** Scene switching: deferred to the next tick, and a switch asked for during an exit wins (#271). */

const manager = (): SceneManager =>
  new SceneManager(
    { removeChildren: () => [] } as unknown as Container,
    {} as Renderer,
    { clear: () => {} } as unknown as Overlay,
    {} as HTMLCanvasElement,
    800,
    600,
  );

const recording = (name: string, log: string[], onExit?: () => void): Scene => ({
  enter: () => void log.push(`enter:${name}`),
  exit: () => {
    log.push(`exit:${name}`);
    onExit?.();
  },
});

describe("SceneManager", () => {
  it("switches on the next tick", async () => {
    const log: string[] = [];
    const scenes = manager()
      .register("a", () => recording("a", log))
      .register("b", () => recording("b", log));
    await scenes.start("a");
    scenes.goTo("b");
    expect(log).toEqual(["enter:a"]);
    scenes.tick(0.016);
    await Promise.resolve();
    expect(log).toEqual(["enter:a", "exit:a", "enter:b"]);
    expect(scenes.activeScene).toBe("b");
  });

  it("opens the scene asked for during an exit in place of the one that was coming", async () => {
    const log: string[] = [];
    const scenes: SceneManager = manager();
    scenes
      .register("attack", () => recording("attack", log, () => scenes.goTo("away")))
      .register("yard", () => recording("yard", log))
      .register("away", () => recording("away", log));
    await scenes.start("attack");
    scenes.goTo("yard");
    scenes.tick(0.016);
    await Promise.resolve();
    expect(log).toEqual(["enter:attack", "exit:attack", "enter:away"]);
    expect(scenes.activeScene).toBe("away");
    // Nothing is left queued: the yard does not open after it.
    scenes.tick(0.016);
    await Promise.resolve();
    expect(scenes.activeScene).toBe("away");
  });
});
