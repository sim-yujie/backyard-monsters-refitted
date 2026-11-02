import { CanvasSource, Texture } from "pixi.js";

/**
 * Flash's own pictures for the Monster Juicer's spurt, from
 * `client/scripts/_assets/assets.swf`, redrawn from their vector data at
 * four times their size so they stay sharp at the closest zoom:
 *
 * - the giblet, `GIBLET_CLIP` (sprite 1709): one frame, its `mcDot` (sprite
 *   1708) holding shape 1707, a dark red blob 5 px across, set 2.55 px left
 *   and 2.8 px up of the clip's point. It does not spin.
 * - the splat, `ParticleSplat` (sprite 1819): five frames, picked at random
 *   (`EFFECTS.SplatParticle`). Frames 1-4 are morph shape 1817 at ratios 0,
 *   ¼, ½ and ¾; frame 5 is shape 1818, the morph's end. Each is a 15 × 8 px
 *   blot filled with a slanted radial gradient, red at 70% to a purple red
 *   at 25%.
 *
 * Both looks use them: there is no Modern giblet or splat.
 */
export interface JuiceSpurtArt {
  readonly giblet: Texture;
  /** A splat frame, 1 to {@link SPLAT_FRAMES}. */
  splat(frame: number): Texture;
  destroy(): void;
}

/** Shape 1707 in `mcDot`'s place, px from the giblet's point. */
const GIBLET_PATH =
  "M0.45 3.85Q0 3.25 0 2.45Q0 1.5 0.55 0.85Q1.45 -0.25 3.6 0.1L3.4 0.45L3 0.65L4.3 1.75L5.15 2.7L4.6 4Q4 5.1 3.45 5.1Q1.25 5.1 0.45 3.85Z";
const GIBLET_OFFSET = { x: -2.55, y: -2.8 } as const;
const GIBLET_COLOUR = "rgb(153,0,0)";
/** The blob's box in the clip, px, with a pixel spare all round. */
const GIBLET_BOX = { x: -3.6, y: -3.9, width: 7.2, height: 7.2 } as const;

interface SplatShape {
  /** The outline, px from the splat's point. */
  readonly path: string;
  /** The gradient's matrix, px: it maps the unit circle onto the blot. */
  readonly gradient: readonly [number, number, number, number, number, number];
  /** Gradient stops: [ratio 0..255, r, g, b, alpha 0..255]. */
  readonly stops: readonly (readonly [number, number, number, number, number])[];
}

const SPLATS: readonly SplatShape[] = [
  {
    path: "M-6.7 0.2Q-6.95 0.4 -6.8 0.55L-6.45 1.05L-5.5 1.6L-5.25 1.75L-3.95 2.65L-3.6 2.9L-0.9 3.45L1.2 3.15L1.8 2.85L2.3 2.8L2.5 2.8L2.55 2.85L3.3 2.9L4.25 2.75L5 2.4Q5.5 2 6 1.55L6 0.95L6.1 0.8Q6.4 0.5 6.65 0.2L6.85 -0.3L7.05 -0.55Q7.35 -1.2 7.05 -1.85L5.9 -2.35L5.7 -2.35L4 -3.15Q2.1 -3.9 1 -3.65L-0.55 -3.25L-0.75 -3.25L-2.45 -3.5L-3.2 -3.2L-4 -2.4Q-4.1 -1.9 -4.45 -1.75L-5 -1.55L-5.75 -1.3L-6.5 -0.8L-6.5 -0.75L-6.75 -0.1L-6.7 0.2Z",
    gradient: [5.9375, 2.75, -6.2625, 3.125, 0.8, -0.1],
    stops: [
      [0, 153, 0, 0, 180],
      [255, 153, 0, 51, 64],
    ],
  },
  {
    path: "M-6.9 0.1Q-7.1 0.3 -7 0.45L-6.65 1L-5.7 1.55L-5.45 1.7L-4.15 2.6L-3.75 2.9L-1.05 3.45L1.05 3.15L1.7 2.85L2.2 2.8L2.4 2.8L2.45 2.9L3.2 2.9L4.15 2.8L4.9 2.45Q5.55 2 5.95 1.6L5.95 1L6.05 0.8Q6.4 0.5 6.65 0.2L6.85 -0.3L7.05 -0.55Q7.35 -1.2 7.05 -1.85L5.9 -2.4L5.7 -2.4L4 -3.2Q2.1 -4 1 -3.75L-0.6 -3.35L-0.8 -3.35L-2.5 -3.6L-3.3 -3.3L-4.1 -2.5Q-4.2 -2 -4.55 -1.85L-5.15 -1.65L-5.9 -1.4L-6.65 -0.9L-6.65 -0.85L-6.9 -0.2L-6.9 0.1Z",
    gradient: [5.9688, 2.8375, -6.3844, 3.125, 0.7125, -0.1375],
    stops: [
      [0, 167, 0, 0, 180],
      [255, 161, 0, 57, 64],
    ],
  },
  {
    path: "M-7.05 0Q-7.2 0.2 -7.2 0.4L-6.8 0.9L-5.9 1.5L-5.65 1.6L-4.3 2.6L-3.9 2.9L-1.2 3.5L0.9 3.2L1.55 2.9L2.1 2.85L2.3 2.85L2.3 2.9L3.1 2.95L4.1 2.8L4.85 2.5Q5.6 2 5.9 1.6L5.9 1L6 0.8Q6.4 0.45 6.6 0.2L6.8 -0.3L7.05 -0.55Q7.4 -1.2 7.1 -1.9L5.9 -2.4L5.7 -2.4L4 -3.3Q2.1 -4.1 1 -3.8L-0.6 -3.4L-0.8 -3.4L-2.6 -3.7L-3.35 -3.4L-4.2 -2.6Q-4.3 -2.1 -4.7 -1.95L-5.3 -1.75L-6.05 -1.5L-6.8 -1L-6.8 -0.95L-7.1 -0.3L-7.05 0Z",
    gradient: [6.0, 2.925, -6.5063, 3.125, 0.625, -0.175],
    stops: [
      [0, 182, 1, 1, 180],
      [255, 170, 0, 63, 64],
    ],
  },
  {
    path: "M-7.2 -0.05Q-7.35 0.1 -7.35 0.3L-7 0.8L-6.1 1.45L-5.85 1.55L-4.5 2.55L-4.1 2.85L-1.4 3.5L0.8 3.2L1.4 2.9L1.95 2.9L2.15 2.9L2.2 2.9L3 3L4 2.85L4.8 2.5Q5.7 2.05 5.9 1.6L5.9 1L6 0.85Q6.4 0.4 6.6 0.25L6.8 -0.25L7.05 -0.55Q7.4 -1.2 7.1 -1.9L5.9 -2.45L5.75 -2.45L4 -3.35Q2.1 -4.15 0.95 -3.9L-0.65 -3.5L-0.85 -3.5L-2.65 -3.85L-3.4 -3.55L-4.35 -2.7Q-4.4 -2.2 -4.8 -2.05L-5.4 -1.85L-6.2 -1.6L-7 -1.1L-6.95 -1.05L-7.3 -0.35L-7.2 -0.05Z",
    gradient: [6.0312, 3.0125, -6.6281, 3.125, 0.5375, -0.2125],
    stops: [
      [0, 196, 2, 2, 180],
      [255, 178, 1, 69, 64],
    ],
  },
  {
    path: "M5.75 -2.5L5.9 -2.5L7.1 -1.9Q7.4 -1.2 7.05 -0.55L6.8 -0.25L6.6 0.25Q6.4 0.4 5.95 0.85L5.85 1.05L5.85 1.65Q5.75 2.05 4.7 2.55L3.9 2.9L2.9 3L2.1 2.95L2.05 2.9L1.85 2.9L1.3 2.9L0.65 3.2L-1.55 3.5L-4.25 2.85L-4.7 2.5L-6.05 1.5L-6.3 1.4L-7.2 0.75L-7.55 0.2L-7.4 -0.15L-7.45 -0.45L-7.1 -1.15L-7.15 -1.2L-6.35 -1.7L-5.55 -1.95L-4.9 -2.15Q-4.5 -2.3 -4.45 -2.8L-3.5 -3.65L-2.7 -3.95L-0.9 -3.6L-0.7 -3.6L0.95 -4Q2.1 -4.25 4 -3.4L5.75 -2.5Z",
    gradient: [6.0625, 3.1, -6.75, 3.125, 0.45, -0.25],
    stops: [
      [0, 210, 2, 2, 180],
      [255, 186, 1, 75, 64],
    ],
  },
];

export const SPLAT_FRAMES = SPLATS.length;
/** Every splat frame's box, px, with a pixel spare all round. */
const SPLAT_BOX = { x: -8.6, y: -5.1, width: 17, height: 9.8 } as const;

/** Canvas pixels per world pixel. */
const ART_RESOLUTION = 4;

const paint = (box: Box, draw: (context: CanvasRenderingContext2D) => void): Texture => {
  if (typeof document === "undefined" || typeof Path2D === "undefined") return Texture.WHITE;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(box.width * ART_RESOLUTION);
  canvas.height = Math.ceil(box.height * ART_RESOLUTION);
  const context = canvas.getContext("2d");
  if (!context) return Texture.WHITE;
  context.scale(ART_RESOLUTION, ART_RESOLUTION);
  context.translate(-box.x, -box.y);
  draw(context);
  return new Texture({
    source: new CanvasSource({ resource: canvas, resolution: ART_RESOLUTION }),
  });
};

type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};
/** Where a box's point lies in it, as a sprite anchor, so a sprite at (x, y) puts the shape where Flash did. */
const anchorOf = (box: Box): { readonly x: number; readonly y: number } => ({
  x: -box.x / box.width,
  y: -box.y / box.height,
});

const drawGiblet = (): Texture =>
  paint(GIBLET_BOX, (context) => {
    context.translate(GIBLET_OFFSET.x, GIBLET_OFFSET.y);
    context.fillStyle = GIBLET_COLOUR;
    context.fill(new Path2D(GIBLET_PATH));
  });

const drawSplat = (shape: SplatShape): Texture =>
  paint(SPLAT_BOX, (context) => {
    context.save();
    context.clip(new Path2D(shape.path));
    // Flash's radial gradient fills the unit circle in its own space, held
    // at the last stop outside it ("pad"): fill the clip in that space.
    const [a, b, c, d, e, f] = shape.gradient;
    context.transform(a, b, c, d, e, f);
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const [ratio, r, g, bl, alpha] of shape.stops) {
      gradient.addColorStop(ratio / 255, `rgba(${r},${g},${bl},${(alpha / 255).toFixed(3)})`);
    }
    context.fillStyle = gradient;
    context.fillRect(-20, -20, 40, 40);
    context.restore();
  });

export const GIBLET_ANCHOR = anchorOf(GIBLET_BOX);
export const SPLAT_ANCHOR = anchorOf(SPLAT_BOX);

/** The art drawn on first use. */
export const juiceSpurtArt = (): JuiceSpurtArt => {
  let giblet: Texture | null = null;
  const splats = new Map<number, Texture>();
  return {
    get giblet() {
      giblet ??= drawGiblet();
      return giblet;
    },
    splat(frame) {
      const index = Math.min(SPLAT_FRAMES, Math.max(1, Math.floor(frame))) - 1;
      let texture = splats.get(index);
      if (!texture) {
        texture = drawSplat(SPLATS[index]!);
        splats.set(index, texture);
      }
      return texture;
    },
    destroy() {
      for (const texture of [giblet, ...splats.values()]) {
        if (texture && texture !== Texture.WHITE) texture.destroy(true);
      }
      giblet = null;
      splats.clear();
    },
  };
};
