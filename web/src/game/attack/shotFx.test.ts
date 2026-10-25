import { describe, expect, it } from "vitest";
import { Container, Texture, TextureSource, TilingSprite } from "pixi.js";
import { boltLook, LOW_SHOT_BITS, MAX_SHOT_BITS, ShotFx } from "./shotFx";

/**
 * The towers' painted bits (beta.5 tower attack effects): pooled sprites off
 * one sheet, a hard cap, fewer on low, and glows that last a frame unless lit again.
 */

const fakeSheet = (): Promise<Texture> =>
  Promise.resolve(new Texture({ source: new TextureSource({ width: 768, height: 1248 }) }));

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

  it("lays a strip along a line for one frame, and gives it back on the next", async () => {
    const { fx, layer } = await ready();
    expect(fx.line({ look: "ray", from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, width: 10, alpha: 1, tint: 0xffffff })).toBe(true);
    fx.line({ look: boltLook(3), from: { x: 0, y: 0 }, to: { x: 0, y: 50 }, width: 12, alpha: 1, tint: 0xffffff, flip: true });
    fx.spot({ look: "orb", at: { x: 5, y: 5 }, size: 16, alpha: 1, tint: 0xffffff });
    expect(fx.drawnCount).toBe(3);
    const [ray, bolt] = layer.children;
    expect(ray?.width).toBeCloseTo(100);
    expect(ray?.height).toBeCloseTo(10);
    expect(ray?.position.x).toBe(50);
    // Laid down the line, turned over.
    expect(bolt?.rotation).toBeCloseTo(Math.PI / 2);
    expect(bolt?.scale.y).toBeLessThan(0);
    fx.begin();
    expect(fx.drawnCount).toBe(0);
    expect(layer.children).toHaveLength(0);
    fx.destroy();
  });

  it("lays a flow along a line, slid down it, for one frame; never on low", async () => {
    const { fx, layer } = await ready();
    const spec = { look: "energy", from: { x: 0, y: 0 }, to: { x: 0, y: 200 }, width: 16, alpha: 1, tint: 0xffaa00 } as const;
    expect(fx.flow({ ...spec, offset: 0 })).toBe(true);
    const [tiles] = layer.children;
    expect(tiles).toBeInstanceOf(TilingSprite);
    expect(tiles?.width).toBeCloseTo(200);
    expect(tiles?.rotation).toBeCloseTo(Math.PI / 2);
    expect(fx.flowCount).toBe(1);
    fx.begin();
    expect(layer.children).toHaveLength(0);
    // The same sprite again next frame, slid further along.
    fx.flow({ ...spec, offset: 30 });
    expect(layer.children[0]).toBe(tiles);
    expect((tiles as TilingSprite).tilePosition.x).toBe(30);
    fx.destroy();

    const low = await ready(true);
    expect(low.fx.flow({ ...spec, offset: 0 })).toBe(false);
    expect(low.layer.children).toHaveLength(0);
  });

  it("names the bolts round and round, each with its core", () => {
    expect(boltLook(0)).toBe("bolt1");
    expect(boltLook(7)).toBe("bolt2");
    expect(boltLook(-1, true)).toBe("core6");
  });
});
