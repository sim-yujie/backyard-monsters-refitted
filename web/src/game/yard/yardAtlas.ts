import { Graphics, Rectangle, type Renderer, type Texture } from "pixi.js";

/**
 * The yard's vector glyphs, baked once into textures.
 *
 * Three things on the yard screen have no bitmap on the game server: the
 * placeholder a building shows while its picture is in flight, the badge over
 * anything mid-build, and the mushrooms. Mushrooms in particular were an
 * embedded Flash `MovieClip` — `doodad_mushroom_mc`
 * (`client/scripts/BMUSHROOM.as:24-44`) — so there is no file to fetch and a
 * drawn stand-in is the only option short of re-exporting the SWF.
 *
 * Baking rather than re-stroking is the same bargain `maproom/mapAtlas.ts`
 * strikes: a `Graphics` re-tesselates whenever it is rebuilt, while a `Sprite`
 * pointing at a texture is a quad. Everything here is white so one texture can
 * serve every tint.
 */

/** Texels per world pixel. Matches the map atlas, for the same reason. */
const RESOLUTION = 2;

export interface YardArtAtlas {
  /** A unit diamond, stretched to a footprint. */
  readonly placeholder: Texture;
  /**
   * A yard mushroom. One glyph for all of them: whether a mushroom is golden
   * is rolled by the server when it is picked, and the original drew no
   * difference either (`docs/design/yard-buildings.md` §5.6).
   */
  readonly mushroom: Texture;
  /** The badge over a building with a countdown running. */
  readonly working: Texture;
  destroy(): void;
}

const bake = (renderer: Renderer, region: Rectangle, draw: (g: Graphics) => void): Texture => {
  const graphics = new Graphics();
  draw(graphics);
  const texture = renderer.generateTexture({
    target: graphics,
    frame: region,
    resolution: RESOLUTION,
    antialias: true,
  });
  graphics.destroy();
  return texture;
};

/** A mushroom: a stalk under a cap, drawn about its base. */
const mushroom = (renderer: Renderer, cap: number): Texture =>
  bake(renderer, new Rectangle(-14, -22, 28, 26), (g) =>
    g
      .rect(-3, -10, 6, 10)
      .fill({ color: 0xffffff, alpha: 0.85 })
      .ellipse(0, -10, 12, 8)
      .fill({ color: cap })
      .ellipse(-4, -13, 3, 2)
      .ellipse(5, -11, 2.5, 1.8)
      .fill({ color: 0xffffff, alpha: 0.9 }),
  );

export const yardArtAtlas = (renderer: Renderer): YardArtAtlas => {
  // A 2:1 diamond in a 128 x 64 frame: a sprite scaled to a footprint box lands
  // exactly on the footprint's four corners.
  const placeholder = bake(renderer, new Rectangle(0, 0, 128, 64), (g) =>
    g
      .poly([64, 0, 128, 32, 64, 64, 0, 32])
      .fill({ color: 0xffffff, alpha: 0.55 })
      .stroke({ width: 2, color: 0xffffff, alignment: 1 }),
  );

  const working = bake(renderer, new Rectangle(-13, -26, 26, 26), (g) =>
    g
      .circle(0, -13, 11)
      .stroke({ width: 3, color: 0xffffff })
      .moveTo(0, -13)
      .lineTo(0, -20)
      .moveTo(0, -13)
      .lineTo(6, -13)
      .stroke({ width: 3, color: 0xffffff, cap: "round" }),
  );

  const cap = mushroom(renderer, 0xd2694a);

  return {
    placeholder,
    mushroom: cap,
    working,
    destroy() {
      for (const texture of [placeholder, working, cap]) texture.destroy(true);
    },
  };
};
