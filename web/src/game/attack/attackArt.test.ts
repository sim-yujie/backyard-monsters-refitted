import { afterEach, describe, expect, it } from "vitest";
import {
  freeAttackArt,
  noteAttackEnd,
  resetAttackArt,
  UNUSED_MS,
  type TextureCollector,
} from "./attackArt";

const collector = () => {
  const seen: number[] = [];
  const gc: TextureCollector = {
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
    expect(freeAttackArt(gc)).toBe(false);
    noteAttackEnd();
    expect(freeAttackArt(gc)).toBe(true);
    expect(seen).toEqual([UNUSED_MS]);
    expect(gc.maxUnusedTime).toBe(60_000);
    // Once only: the next yard visit leaves the collector to its own pace.
    expect(freeAttackArt(gc)).toBe(false);
  });

  it("puts the window back even when the collector throws, and copes with no collector", () => {
    noteAttackEnd();
    expect(freeAttackArt(undefined)).toBe(false);
    const gc: TextureCollector = {
      maxUnusedTime: 60_000,
      run() {
        throw new Error("lost context");
      },
    };
    expect(() => freeAttackArt(gc)).toThrow("lost context");
    expect(gc.maxUnusedTime).toBe(60_000);
  });
});
