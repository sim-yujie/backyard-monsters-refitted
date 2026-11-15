import { describe, expect, it } from "vitest";
import { FRAME_MARGIN, frameHelpMarks, marksInBand, type ClearBand, type WorldBox } from "./helpFrame";
import { MARK_HEADROOM } from "./YardHelpMarks";

/**
 * A friend's yard opens with no wrench under the HUD or the top column
 * (beta 8, lead's check 15 Nov 2026): the camera moves, and zooms out only
 * as far as it must, when a mark would be covered.
 */

/** 1600 x 900, the HUD and the column covering the top 170 px. */
const band: ClearBand = { width: 1600, top: 170, bottom: 900 };

const onScreen = (box: WorldBox, camera: { zoom: number; x: number; y: number }) => ({
  top: (box.top - camera.y) * camera.zoom - MARK_HEADROOM * Math.max(1, camera.zoom),
  bottom: (box.bottom - camera.y) * camera.zoom,
});

describe("frameHelpMarks", () => {
  it("leaves the camera alone when every mark is in the clear", () => {
    const box = { left: 600, top: 500, right: 1000, bottom: 700 };
    const camera = { zoom: 1, minZoom: 0.3, x: 0, y: 0 };
    expect(marksInBand(box, band, camera)).toBe(true);
    expect(frameHelpMarks(box, band, camera)).toBeNull();
  });

  it("brings a wrench out from under the top column, keeping the zoom when they fit", () => {
    // The lead's picture: a wrench anchor at screen y ~100, under the column.
    const box = { left: 300, top: 100, right: 900, bottom: 400 };
    const camera = { zoom: 0.9, minZoom: 0.3, x: 0, y: 0 };
    expect(marksInBand(box, band, camera)).toBe(false);
    const next = frameHelpMarks(box, band, camera)!;
    expect(next.zoom).toBe(0.9);
    const shown = onScreen(box, next);
    expect(shown.top).toBeGreaterThanOrEqual(band.top + FRAME_MARGIN - 0.001);
    expect(shown.bottom).toBeLessThanOrEqual(band.bottom - FRAME_MARGIN + 0.001);
    expect(marksInBand(box, band, next)).toBe(true);
  });

  it("zooms out as far as the marks need, and no further than the floor", () => {
    const box = { left: 100, top: 0, right: 1500, bottom: 1200 };
    const camera = { zoom: 0.9, minZoom: 0.2, x: 0, y: 0 };
    const next = frameHelpMarks(box, band, camera)!;
    expect(next.zoom).toBeLessThan(0.9);
    expect(marksInBand(box, band, next)).toBe(true);

    const floored = frameHelpMarks(box, band, { ...camera, minZoom: 0.6 })!;
    expect(floored.zoom).toBe(0.6);
  });
});
