import { describe, expect, it } from "vitest";
import { infernoKeylineStroke, nearbyEdges } from "./nearbyFootprints";

describe("nearbyEdges", () => {
  const diamond = (x: number, y: number) => [
    { x, y },
    { x: x + 10, y: y + 5 },
    { x, y: y + 10 },
    { x: x - 10, y: y + 5 },
  ];

  it("gives the four edges of one outline", () => {
    expect(nearbyEdges([diamond(0, 0)])).toHaveLength(4);
  });

  it("draws an edge two outlines share once, whichever way round it runs", () => {
    // The second diamond's left edge is the first one's right edge, reversed.
    const right = [
      { x: 10, y: 5 },
      { x: 20, y: 10 },
      { x: 10, y: 15 },
      { x: 0, y: 10 },
    ];
    const edges = nearbyEdges([diamond(0, 0), right]);
    expect(edges).toHaveLength(7);
  });

  it("gives nothing for nothing", () => {
    expect(nearbyEdges([])).toEqual([]);
  });
});

describe("infernoKeylineStroke", () => {
  it("holds 3 screen pixels at any zoom", () => {
    expect(infernoKeylineStroke(1).width).toBe(3);
    expect(infernoKeylineStroke(0.5).width).toBe(6);
    expect(infernoKeylineStroke(2).width).toBe(1.5);
  });

  it("falls back to zoom 1 for a zoom it cannot use", () => {
    expect(infernoKeylineStroke(0).width).toBe(3);
    expect(infernoKeylineStroke(Number.NaN).width).toBe(3);
  });
});
