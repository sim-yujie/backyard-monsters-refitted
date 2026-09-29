import { describe, expect, it } from "vitest";
import { CENTRE_HIT_PX, onYardCentre } from "./centreHover";

/** The planner's centre readout: the middle cell, or a fixed screen radius (#56). */

describe("onYardCentre", () => {
  const centre = { x: 400, y: 300 };

  it("answers for the 10-unit middle cell however far that is on screen", () => {
    expect(onYardCentre({ x: 4, y: -5 }, { x: 900, y: 900 }, centre)).toBe(true);
    expect(onYardCentre({ x: 6, y: 0 }, { x: 900, y: 900 }, centre)).toBe(false);
  });

  it("answers within 12 screen pixels of the mark at fit zoom, where the cell is ~4 px (#56)", () => {
    // Yard units far outside the cell, as they are at a low zoom.
    expect(onYardCentre({ x: 14, y: 0 }, { x: 400 + CENTRE_HIT_PX, y: 300 }, centre)).toBe(true);
    expect(onYardCentre({ x: 14, y: 0 }, { x: 409, y: 309 }, centre)).toBe(false);
  });
});
