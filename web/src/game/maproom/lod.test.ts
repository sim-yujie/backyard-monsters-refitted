import { describe, expect, it } from "vitest";
import { LOD_BADGE_ZOOM, LOD_HEX_ZOOM, LOD_LABEL_ZOOM, MAX_ZOOM, MIN_ZOOM } from "@/config";
import { LodTier, tierForZoom } from "./lod";

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
