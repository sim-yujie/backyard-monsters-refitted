import { describe, expect, it, vi } from "vitest";
import { NEARBY_STROKE } from "../nearbyFootprints";
import type { Corners } from "./marquee";
import { heldCells, PlannerOverlay, type PlannerVisuals } from "./PlannerOverlay";

/** The nearby outlines' part of the planner's chrome (#231). */

const NONE: ReadonlySet<number> = new Set();
const visuals = (over: Partial<PlannerVisuals>): PlannerVisuals => ({
  selected: NONE,
  moved: NONE,
  invalid: NONE,
  marquee: null,
  plot: null,
  ...over,
});

const square = (x: number): Corners => [
  [x, 0],
  [x + 10, 0],
  [x + 10, 10],
  [x, 10],
];

describe("PlannerOverlay nearby outlines", () => {
  it("strokes every nearby footprint in one thin white line, with no fill", () => {
    const overlay = new PlannerOverlay();
    const poly = vi.spyOn(overlay.root, "poly");
    const stroke = vi.spyOn(overlay.root, "stroke");
    const fill = vi.spyOn(overlay.root, "fill");

    overlay.draw(visuals({ nearby: new Set([1, 2, 3]) }), (id) =>
      id === 3 ? null : square(id * 20),
    );

    expect(poly).toHaveBeenCalledTimes(2);
    expect(stroke).toHaveBeenCalledTimes(1);
    expect(stroke).toHaveBeenCalledWith(NEARBY_STROKE);
    expect(fill).not.toHaveBeenCalled();
    expect(NEARBY_STROKE).toMatchObject({ color: 0xffffff, pixelLine: true });
    overlay.destroy();
  });

  it("draws nothing for an empty set", () => {
    const overlay = new PlannerOverlay();
    const stroke = vi.spyOn(overlay.root, "stroke");
    overlay.draw(visuals({ nearby: NONE }), () => square(0));
    expect(stroke).not.toHaveBeenCalled();
    overlay.destroy();
  });
});

/** The wall line on each view (owner, 16 Nov 2026: "what about 2d blueprint view?"). */
describe("PlannerOverlay wall line", () => {
  const line = (flat: boolean): NonNullable<PlannerVisuals["line"]> => ({
    cells: [
      { corners: square(0), state: "build" },
      { corners: square(10), state: "short" },
      { corners: square(20), state: "blocked" },
    ],
    anchors: [[5, 5]],
    flat,
  });

  it("draws the isometric line as polygons", () => {
    const overlay = new PlannerOverlay();
    const poly = vi.spyOn(overlay.root, "poly");
    const rect = vi.spyOn(overlay.root, "rect");
    overlay.draw(visuals({ line: line(false) }), () => null);
    expect(poly).toHaveBeenCalledTimes(6);
    expect(rect).not.toHaveBeenCalled();
    overlay.destroy();
  });

  it("draws the blueprint line as squares: green and red filled, grey dashed and empty", () => {
    const overlay = new PlannerOverlay();
    const poly = vi.spyOn(overlay.root, "poly");
    const rect = vi.spyOn(overlay.root, "rect");
    const fill = vi.spyOn(overlay.root, "fill");
    const circle = vi.spyOn(overlay.root, "circle");
    overlay.draw(visuals({ line: line(true) }), () => null);
    expect(poly).not.toHaveBeenCalled();
    // Green and red: one square for the fill and under-edge, one for the coloured edge.
    expect(rect.mock.calls.map(([x]) => x)).toEqual([0, 0, 20, 20]);
    expect(fill.mock.calls.map(([style]) => (style as unknown as { color: number }).color)).toEqual([
      0x5cc26a,
      0xe05252,
      0xffffff,
    ]);
    expect(circle).toHaveBeenCalledTimes(1);
    expect(circle.mock.calls[0]?.[2]).toBeLessThan(5);
    overlay.destroy();
  });
});

/** Desk fix B (owner, 19 Nov 2026): what is in hand gets the yard's placing box. */
describe("PlannerOverlay in hand", () => {
  it("boxes each building green or red rather than in the orange selection outline", () => {
    expect(heldCells(new Set([1, 2, 3]), new Set([2]), (id) => (id === 3 ? null : square(id * 20)))).toEqual([
      { corners: square(20), state: "build" },
      { corners: square(40), state: "blocked" },
    ]);

    const overlay = new PlannerOverlay();
    const fill = vi.spyOn(overlay.root, "fill");
    const stroke = vi.spyOn(overlay.root, "stroke");
    overlay.draw(visuals({ selected: new Set([1, 2]), invalid: new Set([2]), inHand: true }), (id) => square(id * 20));
    const fills = fill.mock.calls.map(([style]) => (style as unknown as { color: number }).color);
    expect(fills).toEqual([0x5cc26a, 0xe05252]);
    // Red is crossed too: colour is never the only channel.
    const strokes = stroke.mock.calls.map(([style]) => (style as unknown as { color: number }).color);
    expect(strokes.filter((colour) => colour === 0xe05252).length).toBeGreaterThanOrEqual(2);
    overlay.destroy();
  });

  it("keeps the orange selection outline when nothing is in hand", () => {
    const overlay = new PlannerOverlay();
    const fill = vi.spyOn(overlay.root, "fill");
    overlay.draw(visuals({ selected: new Set([1]) }), (id) => square(id * 20));
    expect(fill.mock.calls.map(([style]) => (style as unknown as { color: number }).color)).toEqual([0xf0a12e]);
    overlay.destroy();
  });

  it("draws the blueprint's boxes as squares", () => {
    const overlay = new PlannerOverlay();
    const rect = vi.spyOn(overlay.root, "rect");
    const poly = vi.spyOn(overlay.root, "poly");
    overlay.draw(visuals({ selected: new Set([1]), inHand: true, flat: true }), (id) => square(id * 20));
    expect(rect).toHaveBeenCalled();
    expect(poly).not.toHaveBeenCalled();
    overlay.destroy();
  });
});
