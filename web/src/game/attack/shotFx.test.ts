import { describe, expect, it } from "vitest";
import { Container, Texture, TextureSource } from "pixi.js";
import { LOW_SHOT_BITS, MAX_SHOT_BITS, ShotFx } from "./shotFx";

/**
 * The towers' painted bits (beta.5 tower attack effects): pooled sprites off
 * one sheet, a hard cap, fewer on low, and glows that last a frame unless lit again.
 */

const fakeSheet = (): Promise<Texture> =>
  Promise.resolve(new Texture({ source: new TextureSource({ width: 768, height: 576 }) }));

const ready = async (low = false) => {
  const layer = new Container();
  const fx = new ShotFx(layer, low, fakeSheet);
  fx.preload();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { fx, layer };
};

describe("ShotFx", () => {
  it("throws nothing before the sheet is in", () => {
    const fx = new ShotFx(new Container(), false, () => new Promise<Texture>(() => undefined));
    expect(fx.emit(0, { look: "spark", at: { x: 0, y: 0 } })).toBe(false);
    expect(fx.ready).toBe(false);
  });

  it("stops at its cap, full and low", async () => {
    for (const [low, cap] of [
      [false, MAX_SHOT_BITS],
      [true, LOW_SHOT_BITS],
    ] as const) {
      const { fx } = await ready(low);
      for (let index = 0; index < cap + 50; index += 1) fx.emit(0, { look: "spark", at: { x: 0, y: 0 } });
      expect(fx.bitCount).toBe(cap);
      fx.destroy();
    }
  });

  it("keeps fewer of a burst on low, and fewer again once the yard is busy", async () => {
    const full = await ready(false);
    const low = await ready(true);
    expect(low.fx.many(10)).toBeLessThan(full.fx.many(10));
    for (let index = 0; index < MAX_SHOT_BITS / 2 + 1; index += 1) full.fx.emit(0, { look: "glow", at: { x: 0, y: 0 } });
    expect(full.fx.many(10)).toBe(5);
    // Never none at all.
    expect(low.fx.many(1)).toBe(1);
  });

  it("gives its sprites back when the bits are spent and uses them again", async () => {
    const { fx, layer } = await ready();
    fx.emit(0, { look: "burst", at: { x: 0, y: 0 }, life: 5 });
    fx.update(1);
    expect(layer.children).toHaveLength(1);
    fx.update(10);
    expect(fx.bitCount).toBe(0);
    expect(layer.children).toHaveLength(0);
    fx.emit(10, { look: "burst", at: { x: 0, y: 0 } });
    expect(layer.children).toHaveLength(1);
    fx.destroy();
  });

  it("holds a lamp while it is lit each frame and takes it away the frame it is not", async () => {
    const { fx, layer } = await ready();
    const key = {};
    fx.lamp(key, { look: "glow", at: { x: 0, y: 0 }, size: 40, alpha: 0.8, tint: 0xffffff });
    fx.update(0);
    expect(layer.children).toHaveLength(1);
    fx.lamp(key, { look: "glow", at: { x: 0, y: 0 }, size: 40, alpha: 0.8, tint: 0xffffff });
    fx.update(1);
    expect(layer.children).toHaveLength(1);
    fx.update(2);
    expect(layer.children).toHaveLength(0);
    fx.destroy();
  });
});
