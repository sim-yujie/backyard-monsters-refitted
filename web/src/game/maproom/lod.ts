import { CELL_HEIGHT, CELL_WIDTH, LOD_BADGE_ZOOM, LOD_GLYPH_ZOOM, LOD_HEX_ZOOM, LOD_LABEL_ZOOM } from "@/config";
import { mapRoomGrid } from "@/game/HexGrid";
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
  /**
   * Once owner and tribe names; since the calm map (#176) nothing is added
   * here, and the tier only marks the closest zooms.
   */
  LABELS: 3,
} as const;
export type LodTier = (typeof LodTier)[keyof typeof LodTier];

/**
 * How far the two cell-count thresholds (`LOD_HEX_ZOOM`, `LOD_GLYPH_ZOOM`) move
 * for the world grid's shape: exactly 1 on flat-top (today's numbers), less on
 * pointy-top, whose cells take more room (MR2 look plan step 1: 2x the area in
 * Modern, 4/3 in Classic), so the same number of cells is on screen when the
 * raster gives way to hexes and when the glyphs appear. The badge and label
 * thresholds stay: they are about whether a marker is legible, and markers are
 * the same size on both shapes (`MapChunk.ts`).
 */
export const lodScale = (): number => {
  const flatArea = CELL_WIDTH * 0.75 * CELL_HEIGHT;
  const area = mapRoomGrid.colStep * mapRoomGrid.rowStep;
  return area > flatArea ? Math.sqrt(flatArea / area) : 1;
};

/** Below this zoom the map is the one-texel raster (`LOD_HEX_ZOOM`, moved for the hex shape). */
export const hexZoom = (): number => LOD_HEX_ZOOM * lodScale();

/** From this zoom camp glyphs and hex outlines show (`LOD_GLYPH_ZOOM`, moved for the hex shape). */
export const glyphZoom = (): number => LOD_GLYPH_ZOOM * lodScale();

export const tierForZoom = (zoom: number): LodTier => {
  if (zoom < hexZoom()) return LodTier.RASTER;
  if (zoom < LOD_BADGE_ZOOM) return LodTier.SHAPES;
  if (zoom < LOD_LABEL_ZOOM) return LodTier.BADGES;
  return LodTier.LABELS;
};

/**
 * Which of a chunk's layers the current zoom should show.
 *
 * Nothing here rebuilds anything: every field ends up as a `visible` flag or,
 * for the outline, a choice between two textures that were baked at startup.
 * That is what lets a zoom change inside or across a tier cost nothing.
 */
export const viewFor = (tier: LodTier, zoom: number, atlas: MapAtlas): ChunkView => ({
  outline:
    // Below the glyph zoom the hairline between cells has merged into a grey
    // wash, and drawing it was six segments per hex for nothing.
    zoom < glyphZoom()
      ? null
      : // A stroke baked at one width reads too faintly once a cell is only
        // sixty pixels across, so the far band gets its own heavier texture
        // rather than a redraw.
        zoom < LOD_BADGE_ZOOM
        ? atlas.outlineBold
        : atlas.outlineFine,
  details: zoom >= glyphZoom(),
  // A cell is about 62 screen pixels across at the badge threshold, so a
  // portrait is finally big enough to tell one creature from another. Below
  // it the tent glyph reads better than a 20 pixel monster would.
  avatars: tier >= LodTier.BADGES,
  // Camps' level badges and players' name plates (#176).
  badges: tier >= LodTier.BADGES,
});

export const sameView = (a: ChunkView, b: ChunkView | null): boolean =>
  b !== null &&
  a.outline === b.outline &&
  a.details === b.details &&
  a.avatars === b.avatars &&
  a.badges === b.badges;
