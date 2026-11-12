import { afterEach, describe, expect, it } from "vitest";
import { RenderTexture, Sprite, Texture } from "pixi.js";
import { setClassicLook } from "@/game/classicLook";
import { CLASSIC_MUSHROOMS, MODERN_MUSHROOMS } from "./mushroomArt";
import type { YardArtAtlas } from "./yardAtlas";
import { YardRenderer } from "./YardRenderer";

/**
 * A mushroom's sprite shows its painted picture for its variant, standing on
 * its spot; the drawn glyph until that arrives; the pumpkin at Halloween.
 */

/** The renderer's private mushroom state, for setting up without a GPU. */
type Inside = {
  atlas: YardArtAtlas | null;
  mushroomArt: readonly (Texture | null)[] | null;
  pumpkin: Texture | null;
  season: string;
  dressMushroom(sprite: Sprite, variant: number, atlas: YardArtAtlas): void;
};

const GLYPH = Texture.EMPTY;
const atlas = { mushroom: GLYPH } as unknown as YardArtAtlas;
/** A texture of a picture's size in world px. */
const sized = (width: number, height: number): Texture => RenderTexture.create({ width, height });

const setUp = (art: readonly (Texture | null)[] | null): { renderer: Inside; sprite: Sprite } => {
  const renderer = new YardRenderer() as unknown as Inside;
  renderer.atlas = atlas;
  renderer.mushroomArt = art;
  return { renderer, sprite: new Sprite() };
};

describe("YardRenderer: the painted mushrooms", () => {
  afterEach(() => setClassicLook(false));

  it("shows each variant's picture, its spot on the mushroom's place", () => {
    const art = [sized(60, 54), sized(60, 43), sized(60, 54), sized(64, 52), sized(60, 55)];
    const { renderer, sprite } = setUp(art);

    renderer.dressMushroom(sprite, 4, atlas);

    expect(sprite.texture).toBe(art[3]);
    const [, x, y] = MODERN_MUSHROOMS[3]!;
    expect(sprite.anchor.x).toBeCloseTo(-x / 64);
    expect(sprite.anchor.y).toBeCloseTo(-y / 52);
    expect(sprite.scale.x).toBe(1);
  });

  it("uses Flash's pictures' offsets with the Classic look", () => {
    setClassicLook(true);
    const art = [sized(62, 52), null, null, null, null];
    const { renderer, sprite } = setUp(art);

    renderer.dressMushroom(sprite, 1, atlas);

    const [, x, y] = CLASSIC_MUSHROOMS[0]!;
    expect(sprite.anchor.x).toBeCloseTo(-x / 62);
    expect(sprite.anchor.y).toBeCloseTo(-y / 52);
  });

  it("keeps the drawn glyph while the pictures load, and for one that never came", () => {
    const loading = setUp([]);
    loading.renderer.dressMushroom(loading.sprite, 2, atlas);
    expect(loading.sprite.texture).toBe(GLYPH);
    expect(loading.sprite.anchor.y).toBeCloseTo(0.85);

    const missing = setUp([sized(60, 54), null, sized(60, 54), sized(64, 52), sized(60, 55)]);
    missing.renderer.dressMushroom(missing.sprite, 2, atlas);
    expect(missing.sprite.texture).toBe(GLYPH);
  });

  it("stands the Halloween pumpkin in for every variant", () => {
    const pumpkin = sized(25, 22);
    const { renderer, sprite } = setUp([sized(60, 54), sized(60, 43), sized(60, 54), sized(64, 52), sized(60, 55)]);
    renderer.season = "halloween";
    renderer.pumpkin = pumpkin;

    renderer.dressMushroom(sprite, 3, atlas);

    expect(sprite.texture).toBe(pumpkin);
    expect(sprite.anchor.x).toBeCloseTo(0.5);
    expect(sprite.scale.x).toBeGreaterThan(1);
  });
});
