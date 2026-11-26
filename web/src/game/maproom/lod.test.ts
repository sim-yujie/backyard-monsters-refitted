import { afterEach, describe, expect, it } from "vitest";
import { LOD_BADGE_ZOOM, LOD_GLYPH_ZOOM, LOD_HEX_ZOOM, LOD_LABEL_ZOOM, MAX_ZOOM, MIN_ZOOM } from "@/config";
import { mapRoomGrid, setHexShape } from "@/game/HexGrid";
import { glyphZoom, hexZoom, lodScale, LodTier, tierForZoom, viewFor } from "./lod";
import { CAMPS_SHOWN_FROM } from "./cluster/clusterRules";
import type { MapAtlas } from "./mapAtlas";

describe("tierForZoom", () => {
  it("uses the raster below the hex threshold and shapes at it", () => {
    expect(tierForZoom(MIN_ZOOM)).toBe(LodTier.RASTER);
    expect(tierForZoom(LOD_HEX_ZOOM - 0.001)).toBe(LodTier.RASTER);
    expect(tierForZoom(LOD_HEX_ZOOM)).toBe(LodTier.SHAPES);
  });

  it("adds badges at the badge threshold", () => {
    expect(tierForZoom(LOD_BADGE_ZOOM - 0.001)).toBe(LodTier.SHAPES);
    expect(tierForZoom(LOD_BADGE_ZOOM)).toBe(LodTier.BADGES);
  });

  it("adds names at the label threshold and keeps them to the top", () => {
    expect(tierForZoom(LOD_LABEL_ZOOM - 0.001)).toBe(LodTier.BADGES);
    expect(tierForZoom(LOD_LABEL_ZOOM)).toBe(LodTier.LABELS);
    expect(tierForZoom(MAX_ZOOM)).toBe(LodTier.LABELS);
  });

  it("never skips a tier as the zoom rises", () => {
    let previous = tierForZoom(MIN_ZOOM);
    for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom += 0.005) {
      const tier = tierForZoom(zoom);
      expect(tier - previous).toBeLessThanOrEqual(1);
      expect(tier).toBeGreaterThanOrEqual(previous);
      previous = tier;
    }
  });
});

describe("lodScale (MR2_HEX_SHAPE)", () => {
  afterEach(() => {
    setHexShape("flat");
  });

  it("leaves today's thresholds alone on flat-top", () => {
    expect(lodScale()).toBe(1);
    expect(hexZoom()).toBe(LOD_HEX_ZOOM);
    expect(glyphZoom()).toBe(LOD_GLYPH_ZOOM);
  });

  it("moves the cell-count thresholds so the same number of cells is on screen", () => {
    const flatCells = 1 / (mapRoomGrid.colStep * mapRoomGrid.rowStep * LOD_HEX_ZOOM ** 2);
    for (const classic of [false, true]) {
      setHexShape("pointy", classic);
      const cells = 1 / (mapRoomGrid.colStep * mapRoomGrid.rowStep * hexZoom() ** 2);
      expect(cells).toBeCloseTo(flatCells, 10);
      expect(tierForZoom(hexZoom())).toBe(LodTier.SHAPES);
      expect(tierForZoom(LOD_BADGE_ZOOM)).toBe(LodTier.BADGES);
    }
  });
});

describe("viewFor: wild monster camps when zoomed out (map pin clustering)", () => {
  const atlas = { outlineBold: {}, outlineFine: {} } as unknown as MapAtlas;
  it("leaves camps out below where plaques start, and shows them from there", () => {
    expect(viewFor(tierForZoom(CAMPS_SHOWN_FROM - 0.01), CAMPS_SHOWN_FROM - 0.01, atlas).details).toBe(false);
    expect(viewFor(tierForZoom(CAMPS_SHOWN_FROM), CAMPS_SHOWN_FROM, atlas).details).toBe(true);
    expect(viewFor(tierForZoom(0.6), 0.6, atlas).details).toBe(true);
  });
});
