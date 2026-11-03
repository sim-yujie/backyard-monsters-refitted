import { describe, expect, it } from "vitest";
import { CLIFF_DROP, CLIFF_STRIPS, HILL_RADIUS, heightField, isCliff, type HillCell } from "./hills";

const SQRT3 = Math.sqrt(3);
/** Pointy-top axial centre (corner radius 1), as the shader's `centreOf`. */
const centre = (q: number, r: number) => ({ x: SQRT3 * (q + r / 2), y: 1.5 * r });
const NEIGHBOURS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const;

/** The seven cells the shader reads round axial cell (q, r), heights from `heightOf`. */
const around = (q: number, r: number, heightOf: (q: number, r: number) => number): HillCell[] =>
  [[0, 0], ...NEIGHBOURS].map(([dq, dr]) => ({ ...centre(q + dq, r + dr), height: heightOf(q + dq, r + dr) }));

describe("the smooth height field", () => {
  it("is flat with no slope on level ground", () => {
    const field = heightField(around(0, 0, () => 130), 0.3, -0.2);
    expect(field.height).toBeCloseTo(130);
    expect(field.dx).toBeCloseTo(0);
    expect(field.dy).toBeCloseTo(0);
  });

  it("rises towards a higher neighbour, with the slope pointing at it", () => {
    const heightOf = (q: number, r: number) => 120 + 10 * (q + r / 2);
    const field = heightField(around(0, 0, heightOf), 0, 0);
    expect(field.height).toBeCloseTo(120, 0);
    expect(field.dx).toBeGreaterThan(0);
    expect(Math.abs(field.dy)).toBeLessThan(1e-6);
  });

  it("joins with no step where one hex's seven cells hand over to the next", () => {
    // A rough height map; on the side between cells (0,0) and (1,0) both hexes' sets agree.
    const heightOf = (q: number, r: number) => 100 + ((q * 37 + r * 91 + 1000) % 60);
    const a = centre(0, 0);
    const b = centre(1, 0);
    for (const t of [0.2, 0.5, 0.8]) {
      // Points on the shared side: the midpoint moved along the side.
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + (t - 0.5) };
      const fromA = heightField(around(0, 0, heightOf), mid.x, mid.y);
      const fromB = heightField(around(1, 0, heightOf), mid.x, mid.y);
      expect(fromA.height).toBeCloseTo(fromB.height, 6);
      expect(fromA.dx).toBeCloseTo(fromB.dx, 6);
      expect(fromA.dy).toBeCloseTo(fromB.dy, 6);
    }
  });

  it("reaches no cell beyond the seven the shader reads", () => {
    // The nearest centre outside the seven is 2 hex units from a corner: the bump's radius.
    expect(HILL_RADIUS).toBeLessThanOrEqual(2);
  });
});

describe("cliffs", () => {
  it("stand between land neighbours a big drop apart, never on water", () => {
    expect(isCliff(150, 150 - CLIFF_DROP)).toBe(true);
    expect(isCliff(150, 150 - CLIFF_DROP + 1)).toBe(false);
    expect(isCliff(130, 95)).toBe(false);
  });

  it("read the cliff sheet's strips inside its top half, tallest first", () => {
    expect(CLIFF_STRIPS[0]!.depth).toBe(1);
    for (const strip of CLIFF_STRIPS) {
      expect(strip.top).toBeGreaterThan(0);
      expect(strip.top + strip.height).toBeLessThan(0.5);
      expect(strip.depth).toBeLessThanOrEqual(1);
    }
  });
});
