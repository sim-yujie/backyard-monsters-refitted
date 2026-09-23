import { LOD_BADGE_ZOOM, LOD_GLYPH_ZOOM, LOD_HEX_ZOOM, LOD_LABEL_ZOOM } from "@/config";
import type { ChunkView } from "./MapChunk";
import type { MapAtlas } from "./mapAtlas";

/**
 * How zoom maps to detail.
 *
 * Kept apart from the renderer because it is the one part of the map's
 * behaviour that is pure policy: a number in, a description of what should be
 * on screen out. The thresholds themselves live in config.ts, with the
 * reasoning for each.
 */

/** How much detail the current zoom earns. */
export const LodTier = {
  /** One texel per cell: the whole world at once. */
  RASTER: 0,
  /** Hexagons and glyphs, no text. */
  SHAPES: 1,
  /** Plus level badges. */
  BADGES: 2,
  /** Plus owner and tribe names. */
  LABELS: 3,
} as const;
export type LodTier = (typeof LodTier)[keyof typeof LodTier];

export const tierForZoom = (zoom: number): LodTier => {
  if (zoom < LOD_HEX_ZOOM) return LodTier.RASTER;
  if (zoom < LOD_BADGE_ZOOM) return LodTier.SHAPES;
  if (zoom < LOD_LABEL_ZOOM) return LodTier.BADGES;
  return LodTier.LABELS;
};

/**
 * Below this the hairline between cells has merged into a grey wash, and
 * drawing it was six segments per hex for nothing.
 */
const OUTLINE_MIN_ZOOM = LOD_GLYPH_ZOOM;

/**
 * Which of a chunk's layers the current zoom should show.
 *
 * Nothing here rebuilds anything: every field ends up as a `visible` flag or,
 * for the outline, a choice between two textures that were baked at startup.
 * That is what lets a zoom change inside or across a tier cost nothing.
 */
export const viewFor = (tier: LodTier, zoom: number, atlas: MapAtlas): ChunkView => ({
  outline:
    zoom < OUTLINE_MIN_ZOOM
      ? null
      : // A stroke baked at one width reads too faintly once a cell is only
        // sixty pixels across, so the far band gets its own heavier texture
        // rather than a redraw.
        zoom < LOD_BADGE_ZOOM
        ? atlas.outlineBold
        : atlas.outlineFine,
  details: zoom >= LOD_GLYPH_ZOOM,
  badges: tier >= LodTier.BADGES,
  names: tier >= LodTier.LABELS,
});

export const sameView = (a: ChunkView, b: ChunkView | null): boolean =>
  b !== null &&
  a.outline === b.outline &&
  a.details === b.details &&
  a.badges === b.badges &&
  a.names === b.names;
