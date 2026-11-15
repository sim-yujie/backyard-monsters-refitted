import { describe, expect, it } from "vitest";
import { FRAME_MARGIN, frameHelpMarks, marksInBand, type ClearBand, type WorldBox } from "./helpFrame";
import { MARK_HEADROOM } from "./YardHelpMarks";

/**
 * A friend's yard opens with no wrench under the HUD or the top column
 * (beta 8, lead's check 15 Nov 2026): the camera pans when a mark would be
 * covered, and never zooms out to fit them (that left the wrenches tiny on
 * a phone on its side).
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

  it("never zooms out: on a short band the lowest building sits on the band's bottom", () => {
    // A phone on its side: a band 218 px high; marks 300 world px from the top
    // anchor to the lowest foot, but the highest foot only 150 over the lowest.
    const short: ClearBand = { width: 844, top: 172, bottom: 390 };
    const box = { left: 100, top: 0, right: 1500, bottom: 300, footTop: 150 };
    const camera = { zoom: 0.9, minZoom: 0.2, x: 0, y: 0 };
    const next = frameHelpMarks(box, short, camera)!;
    expect(next.zoom).toBe(0.9);
    expect(onScreen(box, next).bottom).toBeCloseTo(short.bottom - FRAME_MARGIN, 6);
    // The highest foot is in the band, so its wrench slides down under the column.
    expect((box.footTop - next.y) * next.zoom).toBeGreaterThanOrEqual(short.top + FRAME_MARGIN - 0.001);
    // Centred across, though wider than the screen.
    expect(((box.left + box.right) / 2 - next.x) * next.zoom).toBeCloseTo(short.width / 2, 6);
  });

  it("shows as many wrenches as fit across on a narrow screen, rather than cutting them all", () => {
    // A phone upright: two wrenches close together on the right, one far left.
    const narrow: ClearBand = { width: 390, top: 200, bottom: 760 };
    const box = { left: 1400, top: 500, right: 2100, bottom: 700, xs: [1450, 1950, 2030] };
    const next = frameHelpMarks(box, narrow, { zoom: 0.9, minZoom: 0.2, x: 0, y: 0 })!;
    expect(next.zoom).toBe(0.9);
    const screenX = (x: number) => (x - next.x) * next.zoom;
    expect(screenX(1990)).toBeCloseTo(narrow.width / 2, 6);
    for (const x of [1950, 2030]) {
      expect(screenX(x)).toBeGreaterThan(FRAME_MARGIN);
      expect(screenX(x)).toBeLessThan(narrow.width - FRAME_MARGIN);
    }
  });

  it("puts the top row just under the column when not even the buildings fit", () => {
    const short: ClearBand = { width: 844, top: 172, bottom: 390 };
    const box = { left: 100, top: 0, right: 1500, bottom: 400 };
    const next = frameHelpMarks(box, short, { zoom: 0.9, minZoom: 0.2, x: 0, y: 0 })!;
    expect(next.zoom).toBe(0.9);
    expect(onScreen(box, next).top).toBeCloseTo(short.top + FRAME_MARGIN, 6);
  });
});
