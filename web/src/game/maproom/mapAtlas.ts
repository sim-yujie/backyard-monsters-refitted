import { Graphics, Rectangle, type Renderer, type Texture } from "pixi.js";
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

/** Radius the disc and ring are baked at; a sprite scales them to its size. */
export const MARKER_UNIT = 32;
/** The ring's width at {@link MARKER_UNIT}. */
const RING_WIDTH = 6;
/** Half the height of a name plate, and the radius of its ends. */
export const PLATE_HALF_HEIGHT = 11;

/** Half-width the level star and the relation icons are baked at. */
export const ICON_UNIT = 32;

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
  /** The cross over a destroyed camp. */
  readonly cross: Texture;
  /**
   * A filled circle of radius {@link MARKER_UNIT}: a player's marker and a
   * camp's level badge (#176), scaled and tinted dark.
   */
  readonly disc: Texture;
  /** The ring round a disc, tinted white, cyan or the tribe's colour. */
  readonly ring: Texture;
  /**
   * A rounded bar for a player's name plate, stretched sideways by a
   * nine-slice sprite so its round ends keep their shape.
   */
  readonly plate: Texture;
  /** The gold level badge drawn on every player cell (#334). */
  readonly star: Texture;
  /** Relation icon: a house, for the viewer's own cell (#334). */
  readonly houseIcon: Texture;
  /** Relation icon: a shield, for an alliance-mate's cell (#334). */
  readonly shieldIcon: Texture;
  /** Relation icon: crossed swords, for a cell that attacked the viewer (#334). */
  readonly swordsIcon: Texture;
  /**
   * A faint circular bubble drawn over a player cell's building while it has
   * damage protection or an active truce (#334). Replaces the vector ring the
   * old map drew round a protected base; a sprite scales and tints it to sit
   * over the building picture instead.
   */
  readonly shieldBubble: Texture;

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

    this.disc = bake(renderer, frame(MARKER_UNIT + 1, MARKER_UNIT + 1), (g) =>
      g.circle(0, 0, MARKER_UNIT).fill(0xffffff),
    );
    this.ring = bake(renderer, frame(MARKER_UNIT + 1, MARKER_UNIT + 1), (g) =>
      g
        .circle(0, 0, MARKER_UNIT - RING_WIDTH / 2)
        .stroke({ width: RING_WIDTH, color: 0xffffff, alignment: 0.5 }),
    );
    this.plate = bake(renderer, frame(PLATE_HALF_HEIGHT * 2, PLATE_HALF_HEIGHT), (g) =>
      g
        .roundRect(
          -PLATE_HALF_HEIGHT * 2,
          -PLATE_HALF_HEIGHT,
          PLATE_HALF_HEIGHT * 4,
          PLATE_HALF_HEIGHT * 2,
          PLATE_HALF_HEIGHT,
        )
        .fill(0xffffff),
    );

    // The gold level badge: a five-point star, outer radius ICON_UNIT.
    const starOuter = ICON_UNIT;
    const starInner = ICON_UNIT * 0.5;
    const starPoints: number[] = [];
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 === 0 ? starOuter : starInner;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      starPoints.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    this.star = bake(renderer, frame(ICON_UNIT + 1, ICON_UNIT + 1), (g) =>
      g.poly(starPoints).fill(0xffffff),
    );

    // Relation icons, baked small - a sprite scales and tints each at the cell.
    const iconHalf = ICON_UNIT * 0.6;
    this.houseIcon = bake(renderer, frame(iconHalf + 1, iconHalf + 1), (g) =>
      g
        .poly([
          0,
          -iconHalf,
          iconHalf,
          0,
          iconHalf * 0.7,
          0,
          iconHalf * 0.7,
          iconHalf,
          -iconHalf * 0.7,
          iconHalf,
          -iconHalf * 0.7,
          0,
          -iconHalf,
          0,
        ])
        .fill(0xffffff),
    );
    this.shieldIcon = bake(renderer, frame(iconHalf + 1, iconHalf + 1), (g) =>
      g
        .poly([
          -iconHalf,
          -iconHalf,
          iconHalf,
          -iconHalf,
          iconHalf,
          iconHalf * 0.2,
          0,
          iconHalf,
          -iconHalf,
          iconHalf * 0.2,
        ])
        .fill(0xffffff),
    );
    const swordArm = iconHalf * 0.8;
    const swordWidth = ICON_UNIT * 0.12;
    this.swordsIcon = bake(renderer, frame(swordArm + swordWidth, swordArm + swordWidth), (g) =>
      g
        .moveTo(-swordArm, -swordArm)
        .lineTo(swordArm, swordArm)
        .moveTo(swordArm, -swordArm)
        .lineTo(-swordArm, swordArm)
        .stroke({ width: swordWidth, color: 0xffffff, cap: "round" }),
    );

    this.shieldBubble = bake(renderer, frame(MARKER_UNIT + 1, MARKER_UNIT + 1), (g) =>
      g.circle(0, 0, MARKER_UNIT).fill(0xffffff),
    );

    this.owned = [
      this.hex,
      this.outlineFine,
      this.outlineBold,
      this.tent,
      this.tentDestroyed,
      this.cross,
      this.disc,
      this.ring,
      this.plate,
      this.star,
      this.houseIcon,
      this.shieldIcon,
      this.swordsIcon,
      this.shieldBubble,
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
