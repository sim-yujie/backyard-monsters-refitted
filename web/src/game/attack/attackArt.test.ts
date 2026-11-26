import { afterEach, describe, expect, it } from "vitest";
import {
  FRESH_FRAME_MS,
  freeAttackArt,
  noteAttackEnd,
  resetAttackArt,
  UNUSED_MS,
  type TextureCollector,
} from "./attackArt";

const collector = () => {
  const seen: number[] = [];
  const gc: TextureCollector = {
    now: 1000,
    maxUnusedTime: 60_000,
    run() {
      seen.push(this.maxUnusedTime);
    },
  };
  return { gc, seen };
};

describe("attackArt (beta 9: an attack's pictures off the graphics card once home)", () => {
  afterEach(() => resetAttackArt());

  it("runs Pixi's collector once after an attack, with the short window, and puts its own back", () => {
    const { gc, seen } = collector();
    expect(freeAttackArt(gc, 1100)).toBe("nothing");
    noteAttackEnd();
    expect(freeAttackArt(gc, 1100)).toBe("ran");
    expect(seen).toEqual([UNUSED_MS]);
    expect(gc.maxUnusedTime).toBe(60_000);
    // Once only: the next yard visit leaves the collector to its own pace.
    expect(freeAttackArt(gc, 1100)).toBe("nothing");
  });

  it("waits while no frame is being drawn, so the yard's own pictures never look unused", () => {
    const { gc, seen } = collector();
    noteAttackEnd();
    expect(freeAttackArt(gc, 1000 + FRESH_FRAME_MS + 1)).toBe("wait");
    expect(seen).toEqual([]);
    expect(freeAttackArt(gc, 1000 + FRESH_FRAME_MS)).toBe("ran");
  });

  it("puts the window back even when the collector throws, and copes with no collector", () => {
    noteAttackEnd();
    expect(freeAttackArt(undefined)).toBe("nothing");
    const gc: TextureCollector = {
      now: 1000,
      maxUnusedTime: 60_000,
      run() {
        throw new Error("lost context");
      },
    };
    expect(() => freeAttackArt(gc, 1000)).toThrow("lost context");
    expect(gc.maxUnusedTime).toBe(60_000);
  });
});
