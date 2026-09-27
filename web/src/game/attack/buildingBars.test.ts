import { describe, expect, it } from "vitest";
import type { Sprite } from "pixi.js";
import { BAR_OFFSET, BAR_WIDTH, BuildingBars, barColour, barVisible } from "./buildingBars";

/**
 * The building health bars (issue #64): shown only while a building is
 * between empty and full, at the Flash overlay's offset from the origin, and
 * never over a building the viewer cannot see.
 */

const setUp = () => {
  const anchors = new Map<number, { x: number; y: number }>([[1, { x: 100, y: 200 }]]);
  const maxHp = new Map<number, number>([
    [1, 1000],
    [2, 1000],
  ]);
  const bars = new BuildingBars(
    (id) => anchors.get(id) ?? null,
    (id) => maxHp.get(id),
  );
  return { bars, anchors, maxHp };
};

const sprites = (bars: BuildingBars): Sprite[] => bars.root.children as Sprite[];

describe("barVisible", () => {
  it("shows a bar strictly between empty and full", () => {
    expect(barVisible(1)).toBe(false);
    expect(barVisible(0)).toBe(false);
    expect(barVisible(0.999)).toBe(true);
    expect(barVisible(0.001)).toBe(true);
    expect(barVisible(Number.NaN)).toBe(false);
  });
});

describe("barColour", () => {
  it("runs green at full through amber to red near empty", () => {
    const channels = (colour: number) => ({
      red: (colour >> 16) & 0xff,
      green: (colour >> 8) & 0xff,
    });
    const full = channels(barColour(0.99));
    const half = channels(barColour(0.5));
    const low = channels(barColour(0.05));
    expect(full.green).toBeGreaterThan(full.red);
    expect(Math.abs(half.green - half.red)).toBeLessThan(0x30);
    expect(low.red).toBeGreaterThan(low.green);
  });
});

describe("BuildingBars", () => {
  it("draws nothing for a yard with nothing damaged", () => {
    const { bars } = setUp();
    bars.sync({});
    expect(bars.visibleCount).toBe(0);
    expect(sprites(bars)).toHaveLength(0);
    bars.destroy();
  });

  it("shows a bar at (-26, -14) from the origin, as long as the health left", () => {
    const { bars } = setUp();
    bars.sync({ "1": 500 });
    expect(bars.visibleCount).toBe(1);
    const [back, front] = sprites(bars);
    if (!back || !front) throw new Error("no bar sprites");
    expect(back.x).toBe(100 + BAR_OFFSET.x);
    expect(back.y).toBe(200 + BAR_OFFSET.y);
    expect(back.width).toBe(BAR_WIDTH);
    expect(front.width).toBeCloseTo((BAR_WIDTH - 2) / 2);
    bars.destroy();
  });

  it("hides the bar again at zero health and at full, keeping the sprites", () => {
    const { bars } = setUp();
    bars.sync({ "1": 250 });
    expect(bars.visibleCount).toBe(1);
    bars.sync({ "1": 0 });
    expect(bars.visibleCount).toBe(0);
    expect(sprites(bars)).toHaveLength(2);
    bars.sync({ "1": 1000 });
    expect(bars.visibleCount).toBe(0);
    bars.sync({});
    expect(bars.visibleCount).toBe(0);
    bars.sync({ "1": 100 });
    expect(bars.visibleCount).toBe(1);
    expect(sprites(bars)).toHaveLength(2);
    bars.destroy();
  });

  it("never draws over a building the viewer cannot see, or one with no health ladder", () => {
    const { bars } = setUp();
    // Id 2 has health but no anchor: a concealed trap. Id 3 has no max health.
    bars.sync({ "2": 5, "3": 40 });
    expect(bars.visibleCount).toBe(0);
    expect(sprites(bars)).toHaveLength(0);
    bars.destroy();
  });
});
