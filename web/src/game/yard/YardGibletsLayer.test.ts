import { describe, expect, it } from "vitest";
import { planGiblets } from "./juicerShow";
import { YardGibletsLayer } from "./YardGibletsLayer";

const seeded = (): (() => number) => {
  let s = 7;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
};

const drawn = (layer: { children: readonly unknown[] }): number => {
  const paint = layer.children[0] as { bounds: { width: number } };
  return paint.bounds.width;
};

describe("YardGibletsLayer", () => {
  it("draws the giblets in the air above the buildings and their splats on the ground under them, as Flash's _RESOURCES and _EFFECTS", () => {
    const landed: number[] = [];
    const layer = new YardGibletsLayer(seeded(), () => landed.push(1));
    expect(layer.ground).not.toBe(layer.root);

    layer.throw(planGiblets({ x: 0, y: 0 }, 5, 0, seeded()));
    layer.update(0.05);
    expect(layer.inAir).toBe(5);
    expect(drawn(layer.root)).toBeGreaterThan(0);
    expect(drawn(layer.ground)).toBe(0);

    for (let i = 0; i < 60; i++) layer.update(0.05);
    expect(layer.inAir).toBe(0);
    expect(landed.length).toBe(5);
    expect(layer.splatCount).toBe(5);
    expect(drawn(layer.root)).toBe(0);
    expect(drawn(layer.ground)).toBeGreaterThan(0);

    layer.destroy();
  });
});
