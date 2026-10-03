import { describe, expect, it, vi } from "vitest";
import { NEARBY_STROKE } from "../nearbyFootprints";
import type { Corners } from "./marquee";
import { PlannerOverlay, type PlannerVisuals } from "./PlannerOverlay";

/** The nearby outlines' part of the planner's chrome (#231). */

const NONE: ReadonlySet<number> = new Set();
const visuals = (over: Partial<PlannerVisuals>): PlannerVisuals => ({
  selected: NONE,
  moved: NONE,
  invalid: NONE,
  planned: null,
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
