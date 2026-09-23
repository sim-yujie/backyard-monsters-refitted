import { Graphics, Rectangle, Texture, type Renderer } from "pixi.js";
import { CELL_HEIGHT, CELL_WIDTH } from "@/config";

/**
 * The map's art, baked once into textures at startup.
 *
 * Every shape the map draws used to be re-stroked by `Graphics` on each
 * rebuild. Here each one is drawn exactly once, into a texture, and the map is
 * then sprites: panning moves a transform and nothing re-tesselates.
 *
 * Everything is white and tinted at the sprite, so one hexagon texture serves
 * all eleven terrain bands and one tent serves all four tribes. That keeps the
 * whole atlas inside Pixi's multi-texture batch limit, so a screen of several
 * thousand sprites is still a couple of draw calls.
 *
 * Shapes are drawn about the origin in world units and the frame is symmetric,
 * so a sprite with `anchor 0.5` sits exactly on its cell centre. Sizes are the
 * ones the vector renderer used, so the map looks the same.
 */

/**
 * Texels per world pixel in the atlas.
 *
 * 2 rather than 1 because MAX_ZOOM is 2.5: a hex drawn at native size would be
 * resampled up by two and a half at the closest zoom. Two covers all but the
 * last half step, and the whole atlas is a dozen small textures, so the cost is
 * under a megabyte of video memory.
 */
const ATLAS_RESOLUTION = 2;

const HALF_WIDTH = CELL_WIDTH / 2;
const QUARTER_WIDTH = CELL_WIDTH / 4;
const HALF_HEIGHT = CELL_HEIGHT / 2;

/**
 * How much the hex fill is grown before baking.
 *
 * Neighbouring hexes share an edge exactly. Two sprites meeting on that edge
 * each fade their last texel to transparent, so the background shows through as
 * a hairline seam. Growing the fill by a texel makes them overlap instead.
 */
const FILL_BLEED = 1;

/** Outline stroke widths in world pixels, one per tier band. */
const OUTLINE_FINE = 1.5;
const OUTLINE_BOLD = 4;

const hexPoints = (scale: number): number[] => [
  -HALF_WIDTH * scale,
  0,
  -QUARTER_WIDTH * scale,
  -HALF_HEIGHT * scale,
  QUARTER_WIDTH * scale,
  -HALF_HEIGHT * scale,
  HALF_WIDTH * scale,
  0,
  QUARTER_WIDTH * scale,
  HALF_HEIGHT * scale,
  -QUARTER_WIDTH * scale,
  HALF_HEIGHT * scale,
];

/** A symmetric frame of the given half-extents. */
const frame = (halfX: number, halfY: number): Rectangle =>
  new Rectangle(-halfX, -halfY, halfX * 2, halfY * 2);

export class MapAtlas {
  /** Filled hexagon, grown by a texel so neighbours do not show a seam. */
  readonly hex: Texture;
  /** Hex outline for the close tiers, one screen pixel or so. */
  readonly outlineFine: Texture;
  /** Hex outline for the far tier, where a fine line disappears. */
  readonly outlineBold: Texture;
  /** Wild monster camp. */
  readonly tent: Texture;
  /** A razed camp: the tent with its ridge caved in. */
  readonly tentDestroyed: Texture;
  /** A player's main yard. */
  readonly house: Texture;
  /** A player's outpost, deliberately smaller than a yard. */
  readonly outpost: Texture;
  /** The cross over a destroyed camp. */
  readonly cross: Texture;
  /** Ring on the cell that belongs to the player. */
  readonly ownRing: Texture;
  /** Ring for damage protection or an active truce. */
  readonly shieldRing: Texture;
  /** One damage bar segment, stretched by the sprite. */
  readonly bar: Texture;

  private readonly owned: Texture[];

  constructor(renderer: Renderer) {
    this.hex = bake(renderer, frame(HALF_WIDTH + FILL_BLEED, HALF_HEIGHT + FILL_BLEED), (g) =>
      g.poly(hexPoints(1 + FILL_BLEED / HALF_WIDTH)).fill(0xffffff),
    );

    this.outlineFine = this.bakeOutline(renderer, OUTLINE_FINE);
    this.outlineBold = this.bakeOutline(renderer, OUTLINE_BOLD);

    // A tent: a squat triangle sitting on the cell's centre line.
    const tentHalf = CELL_WIDTH * 0.15;
    const tentRise = CELL_HEIGHT * 0.3;
    this.tent = bake(renderer, frame(tentHalf + 1, tentRise + 1), (g) =>
      g
        .poly([-tentHalf, tentRise * 0.6, 0, -tentRise, tentHalf, tentRise * 0.6])
        .fill(0xffffff),
    );

    // The same tent with a collapsed ridge, so a razed camp reads without colour.
    this.tentDestroyed = bake(renderer, frame(tentHalf + 1, tentRise + 1), (g) =>
      g
        .poly([
          -tentHalf,
          tentRise * 0.6,
          -tentHalf * 0.45,
          -tentRise * 0.15,
          0,
          tentRise * 0.15,
          tentHalf * 0.45,
          -tentRise * 0.35,
          tentHalf,
          tentRise * 0.6,
        ])
        .fill(0xffffff),
    );

    // A house: a square with a roof, the silhouette of a main yard.
    const houseHalf = CELL_WIDTH * 0.14;
    const eaves = CELL_HEIGHT * 0.1;
    const ridge = CELL_HEIGHT * 0.32;
    this.house = bake(renderer, frame(houseHalf + 1, ridge + 1), (g) =>
      g
        .poly([
          -houseHalf,
          ridge * 0.7,
          -houseHalf,
          -eaves,
          0,
          -ridge,
          houseHalf,
          -eaves,
          houseHalf,
          ridge * 0.7,
        ])
        .fill(0xffffff),
    );

    // A diamond, deliberately smaller than a main yard.
    const postHalf = CELL_WIDTH * 0.11;
    const postRise = CELL_HEIGHT * 0.24;
    this.outpost = bake(renderer, frame(postHalf + 1, postRise + 1), (g) =>
      g.poly([0, -postRise, postHalf, 0, 0, postRise, -postHalf, 0]).fill(0xffffff),
    );

    const arm = CELL_WIDTH * 0.1;
    const crossWidth = CELL_HEIGHT * 0.05;
    this.cross = bake(renderer, frame(arm + crossWidth, arm + crossWidth), (g) =>
      g
        .moveTo(-arm, -arm)
        .lineTo(arm, arm)
        .moveTo(arm, -arm)
        .lineTo(-arm, arm)
        .stroke({ width: crossWidth, color: 0xffffff, cap: "round" }),
    );

    const ownWidth = CELL_HEIGHT * 0.05;
    this.ownRing = bake(
      renderer,
      frame(HALF_WIDTH + ownWidth, HALF_HEIGHT + ownWidth),
      (g) => g.poly(hexPoints(1)).stroke({ width: ownWidth, color: 0xffffff }),
    );

    const shieldWidth = CELL_HEIGHT * 0.028;
    this.shieldRing = bake(
      renderer,
      frame(HALF_WIDTH * 0.72 + shieldWidth, HALF_HEIGHT * 0.72 + shieldWidth),
      (g) => g.poly(hexPoints(0.72)).stroke({ width: shieldWidth, color: 0xffffff }),
    );

    // A plain white quad. The bar is two of these, scaled and tinted.
    this.bar = Texture.WHITE;

    this.owned = [
      this.hex,
      this.outlineFine,
      this.outlineBold,
      this.tent,
      this.tentDestroyed,
      this.house,
      this.outpost,
      this.cross,
      this.ownRing,
      this.shieldRing,
    ];
  }

  destroy(): void {
    for (const texture of this.owned) texture.destroy(true);
  }

  private bakeOutline(renderer: Renderer, width: number): Texture {
    return bake(renderer, frame(HALF_WIDTH + width, HALF_HEIGHT + width), (g) =>
      g.poly(hexPoints(1)).stroke({ width, color: 0xffffff, alignment: 0.5 }),
    );
  }
}

/** Draws one shape and hands back the texture, discarding the Graphics. */
const bake = (renderer: Renderer, region: Rectangle, draw: (g: Graphics) => void): Texture => {
  const graphics = new Graphics();
  draw(graphics);
  const texture = renderer.generateTexture({
    target: graphics,
    frame: region,
    resolution: ATLAS_RESOLUTION,
    antialias: true,
  });
  graphics.destroy();
  return texture;
};
