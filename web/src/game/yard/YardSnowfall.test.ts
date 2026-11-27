// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Texture } from "pixi.js";
import { flakeCount, MAX_FLAKES, YardSnowfall } from "./YardSnowfall";

/** The Christmas snowfall (owner, 27 Nov 2026): off on Low, half on Medium, a fixed pool for the screen. */
describe("flakeCount", () => {
  it("is about one flake per 9,000 screen px on High, half on Medium, none on Low", () => {
    expect(flakeCount(1366, 768, "high")).toBe(117);
    expect(flakeCount(1366, 768, "medium")).toBe(59);
    expect(flakeCount(1366, 768, "low")).toBe(0);
    expect(flakeCount(390, 844, "high")).toBe(37);
    expect(flakeCount(390, 844, "medium")).toBe(19);
    expect(flakeCount(390, 844, "low")).toBe(0);
  });

  it("never passes the cap, and an empty screen has none", () => {
    expect(flakeCount(3840, 2160, "high")).toBe(MAX_FLAKES);
    expect(flakeCount(0, 800, "high")).toBe(0);
  });
});

describe("YardSnowfall", () => {

  it("makes its flakes once and keeps them while the count stays the same", () => {
    const snow = new YardSnowfall(Texture.WHITE);
    snow.setFlakes(40);
    const first = snow.root.children[0];
    snow.setFlakes(40);
    expect(snow.count).toBe(40);
    expect(snow.root.children[0]).toBe(first);
    expect(snow.root.visible).toBe(true);
    snow.setFlakes(0);
    expect(snow.count).toBe(0);
    expect(snow.root.visible).toBe(false);
    snow.destroy();
  });

  it("falls inside the world rectangle on screen, the same screen size at any zoom", () => {
    const snow = new YardSnowfall(Texture.WHITE);
    snow.setFlakes(30);
    const view = { x: 500, y: 200, width: 1000, height: 500 };
    for (let frame = 0; frame < 120; frame++) snow.update(view, 1000, 500, 1 / 60);
    for (const flake of snow.root.children) {
      expect(flake.x).toBeGreaterThanOrEqual(500);
      expect(flake.x).toBeLessThanOrEqual(1500);
      expect(flake.y).toBeGreaterThanOrEqual(200 - 0.03 * 500);
      expect(flake.y).toBeLessThanOrEqual(700 + 0.03 * 500);
    }
    // Zoomed out twice as far: twice the world size per flake.
    const near = snow.root.children[0]!.scale.x;
    snow.update({ ...view, width: 2000, height: 1000 }, 1000, 500, 0);
    expect(snow.root.children[0]!.scale.x).toBeCloseTo(near * 2);
    snow.destroy();
  });
});
