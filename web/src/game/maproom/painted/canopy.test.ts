import { describe, expect, it } from "vitest";
import {
  BOULDER_FRAME,
  CLEARING_INNER,
  FEATURE_DENSITY,
  GOO_FRAME,
  LOG_FRAME,
  PINE_FRAME,
  REED_FRAME,
  SPRITE_ROWS,
  TREE_FRAME,
  canopyAt,
  canopyEdge,
  featureShares,
  type FeatureCell,
} from "./canopy";
import { GROUND_FRAGMENT } from "./groundShader";

const SQRT3 = Math.sqrt(3);
/** Pointy-top axial centre (corner radius 1), as the shader's `centreOf`. */
const centre = (q: number, r: number) => ({ x: SQRT3 * (q + r / 2), y: 1.5 * r });
const NEIGHBOURS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const;

type Kind = Omit<FeatureCell, "x" | "y">;
const FOREST: Kind = { feature: 1 };
const ROCKS: Kind = { feature: 2 };
const MARSH: Kind = { feature: 3 };
const MEADOW: Kind = { feature: 0 };
const SEA: Kind = { feature: 0, water: true };
const FOG: Kind = { feature: 0, hidden: true };

/** The seven cells the shader reads round the hex holding point (x, y), kinds from `kindOf`. */
const around = (x: number, y: number, kindOf: (q: number, r: number) => Kind): FeatureCell[] => {
  // Round to the nearest pointy-top axial cell (as the shader's roundAxial(axialOf(h))).
  const fq = (SQRT3 / 3) * x - y / 3;
  const fr = (2 / 3) * y;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(-fq - fr);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - (-fq - fr));
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [[0, 0], ...NEIGHBOURS].map(([a, b]) => ({ ...centre(q + a, r + b), ...kindOf(q + a, r + b) }));
};

const at = (x: number, y: number, kindOf: (q: number, r: number) => Kind) => featureShares(around(x, y, kindOf), x, y);

describe("the canopy forest", () => {
  it("covers the middle of a forest as one mass, across the hex sides between forest cells", () => {
    const all = () => FOREST;
    expect(canopyAt(at(0, 0, all))).toBe("canopy");
    // The side between cells (0,0) and (1,0), and a corner where three forest cells meet.
    expect(canopyAt(at(SQRT3 / 2, 0, all))).toBe("canopy");
    expect(canopyAt(at(SQRT3 / 2, 0.5, all))).toBe("canopy");
  });

  it("covers a lone forest cell's middle, leaves the meadow a cell away open, and has its edge near the hex side", () => {
    const lone = (q: number, r: number) => (q === 0 && r === 0 ? FOREST : MEADOW);
    expect(canopyAt(at(0, 0, lone))).toBe("canopy");
    expect(canopyAt(at(SQRT3 * 1.6, 0, lone))).toBe("open");
    // On the hex side the forest's share is about a half: the noise decides, so the edge wanders.
    const side = at(SQRT3 / 2, 0, lone);
    expect(side.forest).toBeGreaterThan(0.4);
    expect(side.forest).toBeLessThan(0.6);
    expect(canopyAt(side)).toBe("edge");
  });

  it("opens a clearing round a camp on a forest cell, and only there", () => {
    const camp = (q: number, r: number): Kind => (q === 0 && r === 0 ? { feature: 1, occupied: true } : FOREST);
    expect(canopyAt(at(0, 0, camp))).toBe("open");
    expect(canopyAt(at(CLEARING_INNER * 0.9, 0, camp))).toBe("open");
    // The next forest cell's middle stays canopy, and so does the far half of the camp's own cell.
    const next = centre(1, 0);
    expect(canopyAt(at(next.x, next.y, camp))).toBe("canopy");
    // A camp on open ground makes no clearing in a forest beside it.
    const meadowCamp = (q: number, r: number): Kind => (q === 0 && r === 0 ? { feature: 0, occupied: true } : FOREST);
    expect(at(next.x * 0.6, 0, meadowCamp).clearing).toBe(0);
  });

  it("keeps off the beach: a forest by the sea stops before the water's side", () => {
    const coast = (q: number) => (q >= 1 ? SEA : FOREST);
    const inland = centre(-1, 0);
    expect(canopyAt(at(inland.x, inland.y, coast))).toBe("canopy");
    // Between the forest cell's middle and the sea, where the beach is painted.
    expect(canopyEdge(at(SQRT3 * 0.45, 0, coast))).toBeLessThan(canopyEdge(at(SQRT3 * 0.45, 0, () => FOREST)) - 0.5);
    expect(canopyAt(at(SQRT3 * 0.5, 0, coast))).toBe("open");
  });

  it("does not run into the fog or count it: shares come from the cells in sight only", () => {
    const foggy = (q: number) => (q >= 1 ? FOG : FOREST);
    const shares = at(SQRT3 / 2, 0, foggy);
    expect(shares.forest).toBeCloseTo(1);
    const allFog = at(0, 0, () => FOG);
    expect(allFog.forest).toBe(0);
    expect(canopyAt(allFog)).toBe("open");
  });

  it("joins with no step where one hex's seven cells hand over to the next", () => {
    const mixed = (q: number, r: number): Kind => [FOREST, MEADOW, FOREST, ROCKS, MARSH, FOREST][((q * 7 + r * 3) % 6 + 6) % 6]!;
    // Just either side of the side between cells (0,0) and (1,0): the two hexes' seven-cell sets.
    const a = at(SQRT3 / 2 - 1e-6, 0.2, mixed);
    const b = at(SQRT3 / 2 + 1e-6, 0.2, mixed);
    expect(a.forest).toBeCloseTo(b.forest, 4);
    expect(a.rocks).toBeCloseTo(b.rocks, 4);
    expect(a.marsh).toBeCloseTo(b.marsh, 4);
  });
});

describe("rock fields and marsh", () => {
  it("have a share of 1 in their middle that fades to 0 a cell into the meadow", () => {
    const rocks = (q: number, r: number) => (q === 0 && r === 0 ? ROCKS : MEADOW);
    const marsh = (q: number) => (q <= 0 ? MARSH : MEADOW);
    expect(at(0, 0, rocks).rocks).toBeGreaterThan(0.85);
    expect(at(SQRT3 * 0.5, 0, rocks).rocks).toBeLessThan(0.6);
    expect(at(SQRT3 * 1.5, 0, rocks).rocks).toBe(0);
    expect(at(-SQRT3, 0, marsh).marsh).toBeGreaterThan(0.9);
    // A soft fade, not a cut: part-way shares across the side.
    const edge = at(SQRT3 * 0.5, 0, marsh).marsh;
    expect(edge).toBeGreaterThan(0.3);
    expect(edge).toBeLessThan(0.7);
  });
});

describe("the shader's sheet and budget", () => {
  it("joins ten sprite rows and numbers this step's pieces after the details and sea rocks", () => {
    expect(SPRITE_ROWS).toBe(10);
    expect(TREE_FRAME).toBe(20);
    expect(PINE_FRAME).toBe(24);
    expect(BOULDER_FRAME).toBe(28);
    expect(GOO_FRAME).toBe(32);
    expect(REED_FRAME).toBe(36);
    expect(LOG_FRAME).toBe(39);
    expect(LOG_FRAME).toBeLessThan(SPRITE_ROWS * 4);
  });

  it("keeps fewer pieces on Medium and Low (plan budget 600 / 300 / 120)", () => {
    expect(FEATURE_DENSITY.medium / FEATURE_DENSITY.high).toBeCloseTo(0.5);
    expect(FEATURE_DENSITY.low / FEATURE_DENSITY.high).toBeCloseTo(0.2);
  });

  it("draws the canopy, the overlays and the pieces in the ground shader", () => {
    expect(GROUND_FRAGMENT).toContain("featuresNear(");
    expect(GROUND_FRAGMENT).toContain("canopyColour(");
    expect(GROUND_FRAGMENT).toContain("marshColour(");
    expect(GROUND_FRAGMENT).toContain("drawFeatures(");
    expect(GROUND_FRAGMENT).toContain("const float SPRITE_ROWS = 10.0;");
    expect(GROUND_FRAGMENT).not.toContain("${");
  });
});
