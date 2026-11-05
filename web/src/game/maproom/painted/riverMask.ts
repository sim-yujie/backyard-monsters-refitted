import type { RiverPath } from "./riverPaths";

/**
 * Map Room 2 rivers as a picture the painted ground's shader reads (look plan step 7, round 2).
 *
 * The first rivers were a flat blue ribbon drawn over the painted ground, and looked pasted on. Now
 * the ground shader paints them itself, with the sea's own water textures, its shallows colour and
 * soft edges, so a river is the same water as the coast it runs into. The shader needs to know, per
 * pixel, how far it is from the river; this builds that as a small texture over the cells round the
 * view (a distance field: smooth when the GPU blends between texels, so the banks stay sharp at any
 * zoom with only a few dozen texels a cell).
 *
 * Channels, each 0..255 (`groundShader.ts` `riverAt` reads them back):
 * - R: depth, 1 in mid-stream falling to 0 at the water's edge (0 outside).
 * - G: the signed distance to the water's edge, + inside the water, in cell widths, over
 *   +-{@link EDGE_RANGE} (0.5 on the edge itself; 0 means "no river near").
 * - B: how much of a mouth (`RiverPoint.mouth`): the estuary widening and its fade into the sea.
 * - A: the river's half width there, in cell widths, over {@link HALF_RANGE} (narrow streams are
 *   painted lighter and with narrower banks).
 * Where rivers meet, the one whose water reaches furthest wins each texel, so junctions and a river
 * running into a lake join with no seam.
 *
 * Pure (no Pixi, no canvas), so it is tested on its own.
 */

/** Cell widths each side of the water's edge that the distance channel covers. */
export const EDGE_RANGE = 0.16;
/** Cell widths that the half-width channel covers. */
export const HALF_RANGE = 0.4;
/** The largest texture side. */
export const MAX_SIDE = 2048;

/** A world rectangle, in world points. */
export interface WorldRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The river picture and where it lies in the world. */
export interface RiverMask {
  width: number;
  height: number;
  /** RGBA bytes, row by row from the top. */
  bytes: Uint8Array;
  /** The world rectangle the texture covers (texel centres sit half a texel in from its sides). */
  rect: WorldRect;
  /** Whether any river touches it. */
  any: boolean;
}

const byte = (value: number): number => Math.max(0, Math.min(255, Math.round(value * 255)));

/**
 * Draws `paths` into a texture over `rect` at about `texelsPerCell` texels a cell (fewer when that
 * would pass {@link MAX_SIDE}).
 */
export const buildRiverMask = (
  paths: readonly RiverPath[],
  rect: WorldRect,
  cellWidth: number,
  texelsPerCell: number,
): RiverMask => {
  const spanX = Math.max(1, rect.x1 - rect.x0);
  const spanY = Math.max(1, rect.y1 - rect.y0);
  let scale = texelsPerCell / cellWidth;
  scale = Math.min(scale, MAX_SIDE / spanX, MAX_SIDE / spanY);
  const width = Math.max(1, Math.ceil(spanX * scale));
  const height = Math.max(1, Math.ceil(spanY * scale));
  // The texture spans exactly the rectangle, so its sides line up with the uniform the shader gets.
  const texelX = spanX / width;
  const texelY = spanY / height;

  const edgeRange = EDGE_RANGE * cellWidth;
  const best = new Float32Array(width * height).fill(-Infinity);
  const bytes = new Uint8Array(width * height * 4);
  let any = false;

  for (const path of paths) {
    const points = path.points;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const reach = Math.max(a.half, b.half) + edgeRange;
      const cx0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach - rect.x0) / texelX));
      const cx1 = Math.min(width - 1, Math.ceil((Math.max(a.x, b.x) + reach - rect.x0) / texelX));
      const cy0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - reach - rect.y0) / texelY));
      const cy1 = Math.min(height - 1, Math.ceil((Math.max(a.y, b.y) + reach - rect.y0) / texelY));
      if (cx1 < cx0 || cy1 < cy0) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length2 = dx * dx + dy * dy;
      for (let ty = cy0; ty <= cy1; ty++) {
        const py = rect.y0 + (ty + 0.5) * texelY;
        for (let tx = cx0; tx <= cx1; tx++) {
          const px = rect.x0 + (tx + 0.5) * texelX;
          const t = length2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / length2)) : 0;
          const distance = Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
          const half = a.half + (b.half - a.half) * t;
          const inside = half - distance;
          if (inside < -edgeRange) continue;
          const index = ty * width + tx;
          if (inside <= best[index]!) continue;
          best[index] = inside;
          any = true;
          const o = index * 4;
          bytes[o] = byte(half > 0 ? 1 - distance / half : 0);
          bytes[o + 1] = byte(0.5 + (0.5 * inside) / edgeRange);
          bytes[o + 2] = byte(a.mouth + (b.mouth - a.mouth) * t);
          bytes[o + 3] = byte(half / (HALF_RANGE * cellWidth));
        }
      }
    }
  }
  return { width, height, bytes, rect, any };
};
