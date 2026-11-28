// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Texture } from "pixi.js";
import { GLOW_HIGH, GLOW_LOW, GLOW_PERIOD, GLOW_WIDTH, glowAlpha, PresentGlows } from "./presentGlow";

/** The hunt presents' gold glow (neon, 28 Nov 2026). */
describe("glowAlpha", () => {
  it("breathes between its low and high once a period, and holds high when still", () => {
    expect(glowAlpha(0)).toBeCloseTo(GLOW_LOW);
    expect(glowAlpha(GLOW_PERIOD / 2)).toBeCloseTo(GLOW_HIGH);
    expect(glowAlpha(GLOW_PERIOD)).toBeCloseTo(GLOW_LOW);
    expect(glowAlpha(0.3, true)).toBe(GLOW_HIGH);
  });
});

describe("PresentGlows", () => {
  it("lays one oval per present, grows it with the pop and clears them all", () => {
    const glows = new PresentGlows(Texture.WHITE);
    glows.add("a", 10, 20);
    glows.add("a", 10, 20);
    glows.add("b", 30, 40);
    expect(glows.count).toBe(2);
    const first = glows.root.children[0]!;
    expect(first.position.x).toBe(10);
    // Texture.WHITE is 1 px: the scale is the glow's world width, half as tall.
    expect(first.scale.x * Texture.WHITE.width).toBeCloseTo(GLOW_WIDTH / 64);
    expect(first.scale.y).toBeLessThan(first.scale.x);
    glows.scale("a", 0.5);
    expect(first.scale.x).toBeCloseTo(GLOW_WIDTH / 64 / 2);
    for (let step = 0; step < 9; step++) glows.update(GLOW_PERIOD / 18);
    expect(glows.root.alpha).toBeCloseTo(GLOW_HIGH);
    glows.clear();
    expect(glows.count).toBe(0);
    glows.destroy();
  });
});
