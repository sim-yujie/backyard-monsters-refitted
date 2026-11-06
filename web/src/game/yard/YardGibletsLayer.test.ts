import { Texture, type Sprite } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import {
  GIBLET_ANCHOR,
  juiceSpurtArt,
  SPLAT_ANCHOR,
  SPLAT_FRAMES,
  type JuiceSpurtArt,
} from "./juiceSpurtArt";
import { planGiblets } from "./juicerShow";
import { YardGibletsLayer } from "./YardGibletsLayer";

const seeded = (): (() => number) => {
  let s = 7;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
};

/** Art with a texture of its own per picture, so a test can tell which one a sprite shows. */
const fakeArt = (): JuiceSpurtArt & { readonly splats: Texture[] } => {
  const giblet = new Texture();
  const splats = Array.from({ length: SPLAT_FRAMES }, () => new Texture());
  return {
    giblet,
    splats,
    splat: (frame) => splats[frame - 1]!,
    destroy: vi.fn(),
  };
};

const shown = (container: { children: readonly unknown[] }): Sprite[] =>
  (container.children as Sprite[]).filter((sprite) => sprite.visible);

describe("YardGibletsLayer", () => {
  it("draws Flash's giblet in the air above the buildings and Flash's splats on the ground under them", () => {
    const landed: number[] = [];
    const art = fakeArt();
    const layer = new YardGibletsLayer(seeded(), () => landed.push(1), art);
    expect(layer.ground).not.toBe(layer.root);

    const giblets = planGiblets({ x: 0, y: 0 }, 5, 0, seeded());
    layer.throw(giblets);
    layer.update(0.05);
    expect(layer.inAir).toBe(5);
    const flying = shown(layer.root);
    expect(flying.length).toBeGreaterThan(0);
    for (const sprite of flying) {
      expect(sprite.texture).toBe(art.giblet);
      expect(sprite.anchor.x).toBeCloseTo(GIBLET_ANCHOR.x);
      expect(sprite.anchor.y).toBeCloseTo(GIBLET_ANCHOR.y);
      // The clip's size: GIBLETS.Create's 0.8 for a juice.
      expect(sprite.scale.x).toBeCloseTo(giblets[0]!.scale);
    }
    expect(shown(layer.ground)).toHaveLength(0);

    for (let i = 0; i < 40; i++) layer.update(0.05);
    expect(layer.inAir).toBe(0);
    expect(landed.length).toBe(5);
    expect(layer.splatCount).toBe(5);
    expect(shown(layer.root)).toHaveLength(0);
    const splats = shown(layer.ground);
    expect(splats).toHaveLength(5);
    for (const sprite of splats) {
      expect(art.splats).toContain(sprite.texture);
      expect(sprite.anchor.x).toBeCloseTo(SPLAT_ANCHOR.x);
    }
    // Each splat lies where its giblet came down.
    const spots = giblets
      .map((giblet) => `${giblet.toX.toFixed(2)},${giblet.toY.toFixed(2)}`)
      .sort();
    expect(
      splats.map((sprite) => `${sprite.x.toFixed(2)},${sprite.y.toFixed(2)}`).sort(),
    ).toEqual(spots);

    layer.destroy();
    expect(art.destroy).toHaveBeenCalled();
  });

  it("lifts a giblet off its line in the middle of its hop, as GIBLET's mcDot", () => {
    const layer = new YardGibletsLayer(seeded(), null, fakeArt());
    const [giblet] = planGiblets({ x: 0, y: 0 }, 1, 0, seeded());
    layer.throw([giblet!]);
    layer.update(giblet!.delay + giblet!.duration / 2);
    const [sprite] = shown(layer.root);
    const lineY = (giblet!.fromY + giblet!.toY) / 2;
    expect(sprite!.y).toBeLessThan(lineY - giblet!.hop / 2);
  });

  it("picks each of ParticleSplat's five frames, grows a splat for eleven frames, then fades it out", () => {
    const art = fakeArt();
    const layer = new YardGibletsLayer(seeded(), null, art);
    const used = new Set<Texture>();
    for (let round = 0; round < 12; round++) {
      layer.throw(planGiblets({ x: 0, y: 0 }, 5, 0, seeded()));
      for (let i = 0; i < 40; i++) layer.update(0.05);
      for (const sprite of shown(layer.ground)) used.add(sprite.texture);
    }
    expect(used.size).toBe(SPLAT_FRAMES);
    layer.clear();

    layer.throw(planGiblets({ x: 0, y: 0 }, 1, 0, seeded()));
    for (let i = 0; i < 400 && layer.splatCount === 0; i++) layer.update(0.005);
    const [splat] = shown(layer.ground);
    expect(splat!.scale.x).toBeGreaterThanOrEqual(20 / 32);
    layer.update(0.3);
    // Grown to Flash's 20/32 + 0.02 a frame for 11 frames, and no more.
    expect(splat!.scale.x).toBeCloseTo(20 / 32 + 0.22, 5);
    layer.update(1.5);
    expect(splat!.alpha).toBeGreaterThan(0.2);
    expect(splat!.alpha).toBeLessThan(0.8);
    layer.update(2);
    expect(layer.splatCount).toBe(0);
    expect(shown(layer.ground)).toHaveLength(0);
  });

  it("reuses its sprites for the next spurt and puts everything away on clear", () => {
    const layer = new YardGibletsLayer(seeded(), null, fakeArt());
    layer.throw(planGiblets({ x: 0, y: 0 }, 5, 0, seeded()));
    for (let i = 0; i < 100; i++) layer.update(0.05);
    const giblets = layer.root.children.length;
    const splats = layer.ground.children.length;
    layer.throw(planGiblets({ x: 0, y: 0 }, 5, 0, seeded()));
    for (let i = 0; i < 100; i++) layer.update(0.05);
    expect(layer.root.children.length).toBe(giblets);
    expect(layer.ground.children.length).toBe(splats);

    layer.throw(planGiblets({ x: 0, y: 0 }, 5, 0, seeded()));
    for (let i = 0; i < 15; i++) layer.update(0.05);
    layer.clear();
    expect(layer.inAir).toBe(0);
    expect(layer.splatCount).toBe(0);
    expect(shown(layer.root)).toHaveLength(0);
    expect(shown(layer.ground)).toHaveLength(0);
  });
});

describe("juiceSpurtArt", () => {
  it("has ParticleSplat's five frames and puts each picture's point inside it", () => {
    expect(SPLAT_FRAMES).toBe(5);
    for (const anchor of [GIBLET_ANCHOR, SPLAT_ANCHOR]) {
      expect(anchor.x).toBeGreaterThan(0);
      expect(anchor.x).toBeLessThan(1);
      expect(anchor.y).toBeGreaterThan(0);
      expect(anchor.y).toBeLessThan(1);
    }
    // No canvas outside a browser: the art falls back to a blank texture, any frame asked.
    const art = juiceSpurtArt();
    expect(art.giblet).toBe(Texture.WHITE);
    expect(art.splat(0)).toBe(Texture.WHITE);
    expect(art.splat(9)).toBe(Texture.WHITE);
    art.destroy();
  });
});
