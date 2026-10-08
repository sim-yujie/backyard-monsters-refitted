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

/**
 * Texels per world pixel for the protection art (#338): drawn small but shown
 * large and zoomed in, so it is baked at four times the density of the hexes.
 * A handful of tiny textures, so the memory cost is trivial.
 */
const DETAIL_RESOLUTION = 8;

/** The dome's drawing size in world units (Flash's 80 x 64), bottom-centre at the origin. */
export const DOME_WIDTH = 80;
export const DOME_HEIGHT = 64;
export const TICK_WIDTH = 21;
export const TICK_HEIGHT = 17;
export const WORKER_SIZE = 28;

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
   * Flash's glass protection dome (#338): a translucent green-white
   * half-sphere with a soft highlight, a bright rim and an arc line, flat
   * along the bottom. Drawn in code at {@link DETAIL_RESOLUTION} so it stays
   * sharp when zoomed in; sized by `DOME_WIDTH` x `DOME_HEIGHT` units.
   */
  readonly protectionDome: Texture;
  /** Flash's green truce tick, a small tile with a white check (#338). */
  readonly truceTick: Texture;
  /** Flash's idle worker, a little blue creature looking right (#338). */
  readonly idleWorker: Texture;

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

    this.protectionDome = bake(
      renderer,
      new Rectangle(-DOME_WIDTH / 2 - 2, -DOME_HEIGHT - 2, DOME_WIDTH + 4, DOME_HEIGHT + 4),
      drawDome,
      DETAIL_RESOLUTION,
    );
    this.truceTick = bake(
      renderer,
      new Rectangle(-TICK_WIDTH / 2 - 1, -TICK_HEIGHT / 2 - 1, TICK_WIDTH + 2, TICK_HEIGHT + 2),
      drawTick,
      DETAIL_RESOLUTION,
    );
    this.idleWorker = bake(
      renderer,
      new Rectangle(-WORKER_SIZE / 2 - 2, -WORKER_SIZE / 2 - 2, WORKER_SIZE + 4, WORKER_SIZE + 4),
      drawWorker,
      DETAIL_RESOLUTION,
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
      this.protectionDome,
      this.truceTick,
      this.idleWorker,
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
const bake = (
  renderer: Renderer,
  region: Rectangle,
  draw: (g: Graphics) => void,
  resolution: number = ATLAS_RESOLUTION,
): Texture => {
  const graphics = new Graphics();
  draw(graphics);
  const texture = renderer.generateTexture({
    target: graphics,
    frame: region,
    resolution,
    antialias: true,
  });
  graphics.destroy();
  return texture;
};

/** The points of the dome's outline: a half-ellipse from the left foot over the top to the right. */
const domeArc = (halfWidth: number, height: number, steps = 48): number[] => {
  const points: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = Math.PI - (Math.PI * i) / steps;
    points.push(Math.cos(angle) * halfWidth, -Math.sin(angle) * height);
  }
  return points;
};

/** Flash's glass dome: pale green-white body, top-left highlight, bright rim and arc line. */
const drawDome = (g: Graphics): void => {
  const halfWidth = DOME_WIDTH / 2;
  g.poly(domeArc(halfWidth, DOME_HEIGHT)).fill({ color: 0xd6ffe4, alpha: 0.32 });
  // A deeper tint toward the foot, so the glass reads as a volume.
  g.poly(domeArc(halfWidth * 0.98, DOME_HEIGHT * 0.5)).fill({ color: 0x9fe8bc, alpha: 0.12 });
  // The soft highlight, upper left.
  g.ellipse(-halfWidth * 0.38, -DOME_HEIGHT * 0.68, halfWidth * 0.3, DOME_HEIGHT * 0.17)
    .fill({ color: 0xffffff, alpha: 0.38 });
  // The arc line just inside the rim, and the rim itself.
  g.poly(domeArc(halfWidth * 0.9, DOME_HEIGHT * 0.9).slice(6, -6), false)
    .stroke({ width: 0.9, color: 0xffffff, alpha: 0.5 });
  g.poly(domeArc(halfWidth, DOME_HEIGHT)).stroke({ width: 1.6, color: 0xf2fff6, alpha: 0.9 });
};

/** Flash's truce marker: a green tile with a white check. */
const drawTick = (g: Graphics): void => {
  g.roundRect(-TICK_WIDTH / 2, -TICK_HEIGHT / 2, TICK_WIDTH, TICK_HEIGHT, 4)
    .fill(0x2f9e44)
    .stroke({ width: 1.2, color: 0xffffff });
  g.moveTo(-5, 0.5).lineTo(-1.5, 4).lineTo(5.5, -4)
    .stroke({ width: 2.4, color: 0xffffff, cap: "round", join: "round" });
};

/** Flash's idle worker: a blue teardrop with two big eyes, looking right. */
const drawWorker = (g: Graphics): void => {
  const r = WORKER_SIZE / 2;
  // A soft ground shadow.
  g.ellipse(1, r * 0.8, r * 0.7, r * 0.22).fill({ color: 0x000000, alpha: 0.22 });
  // The body: a round blue drop with a little point at the top.
  g.moveTo(-r * 0.15, -r * 0.95)
    .bezierCurveTo(r * 0.7, -r * 0.5, r * 0.8, r * 0.2, 0, r * 0.75)
    .bezierCurveTo(-r * 0.8, r * 0.3, -r * 0.8, -r * 0.4, -r * 0.15, -r * 0.95)
    .fill(0x2f7de1)
    .stroke({ width: 1, color: 0x1a4f9e });
  g.ellipse(-r * 0.3, -r * 0.1, r * 0.14, r * 0.3).fill({ color: 0xa9d0ff, alpha: 0.55 });
  // Two eyes, pupils to the right.
  for (const eyeX of [-r * 0.05, r * 0.42]) {
    g.ellipse(eyeX, -r * 0.18, r * 0.24, r * 0.3).fill(0xffffff).stroke({ width: 0.6, color: 0x1a4f9e });
    g.circle(eyeX + r * 0.08, -r * 0.14, r * 0.1).fill(0x10213f);
  }
};
