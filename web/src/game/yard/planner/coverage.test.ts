import { describe, expect, it } from "vitest";
import { COVERAGE_STEP, computeCoverage, coverageTowers, percentText, type CoverageTower } from "./coverage";
import { plotBounds, type PlanNode } from "./placement";
import { towerRange } from "./RangeLayer";

/**
 * Defence coverage (#55): which towers count, the sampled share of the plot
 * each layer reaches, and the dead zones left over. Expansion 0 is a 1000 x
 * 800 plot, 100 x 80 cells of 10 units.
 */

const CANNON = 20;
const AERIAL = 115;
const SNIPER = 21;
const BUNKER = 22;
const BLOCK = 17;

const plot = plotBounds(0);

const node = (over: Partial<PlanNode> & { id: number }): PlanNode => ({
  type: CANNON,
  x: 0,
  y: 0,
  width: 40,
  height: 40,
  level: 1,
  fort: 0,
  decoration: false,
  fixed: false,
  stored: false,
  plan: null,
  busy: false,
  damaged: false,
  ...over,
});

const tower = (x: number, y: number, range: number, land = true, air = false): CoverageTower => ({
  x,
  y,
  range,
  land,
  air,
});

describe("coverageTowers", () => {
  it("counts the placed defence towers, from the middle of the footprint", () => {
    const towers = coverageTowers([node({ id: 1, x: 100, y: -60 }), node({ id: 2, type: BLOCK })]);
    expect(towers).toEqual([
      { x: 120, y: -40, range: towerRange(CANNON, 1)!.range, land: true, air: false },
    ]);
  });

  it("reads the planned level where there is one", () => {
    const [planned] = coverageTowers([node({ id: 1, plan: { level: 10, order: 0 } })]);
    expect(planned?.range).toBe(towerRange(CANNON, 10)!.range);
    expect(planned!.range).toBeGreaterThan(towerRange(CANNON, 1)!.range);
  });

  it("leaves out the Monster Bunker, a foundation, a stored tower and a mushroom", () => {
    expect(
      coverageTowers([
        node({ id: 1, type: BUNKER, level: 3 }),
        node({ id: 2, level: 0 }),
        node({ id: 3, stored: true }),
        node({ id: 4, type: 7, fixed: true }),
      ]),
    ).toEqual([]);
  });

  it("takes land and air from the tower's targeting", () => {
    const [aerial, sniper] = coverageTowers([node({ id: 1, type: AERIAL }), node({ id: 2, type: SNIPER })]);
    expect(aerial).toMatchObject({ land: false, air: true });
    expect(sniper).toMatchObject({ land: true, air: true });
  });
});

describe("computeCoverage", () => {
  it("samples every plot cell", () => {
    const coverage = computeCoverage([], plot);
    expect(coverage).toMatchObject({ columns: 100, rows: 80, x: -500, y: -400, towers: 0 });
    expect(coverage.land.mask).toHaveLength(8_000);
  });

  it("with no towers the whole plot is one dead zone", () => {
    const { land } = computeCoverage([], plot);
    expect(land.share).toBe(0);
    expect(land.deadZones).toHaveLength(1);
    expect(land.deadZones[0]).toMatchObject({ cells: 8_000, share: 1 });
  });

  it("a cell is covered when its centre is within range of the tower", () => {
    // Cell centres sit at ±5, ±15, …: a range of 10 around (0, 0) reaches the
    // four cells round the origin (7.07 away); 15.9 also reaches the eight at
    // (±15, ±5) and (±5, ±15), 15.81 away, but not (±15, ±15).
    const { land } = computeCoverage([tower(0, 0, 10)], plot);
    expect(land.covered).toBe(4);
    const { land: wider } = computeCoverage([tower(0, 0, 15.9)], plot);
    expect(wider.covered).toBe(12);
  });

  it("the share is the covered cells over every plot cell", () => {
    const { land } = computeCoverage([tower(0, 0, 200)], plot);
    // A circle of radius 200 is about 125,664 square units: 1,257 cells.
    expect(land.covered).toBeGreaterThan(1_230);
    expect(land.covered).toBeLessThan(1_290);
    expect(land.share).toBeCloseTo(land.covered / 8_000, 10);
  });

  it("clips a tower's reach at the plot's edge", () => {
    const { land } = computeCoverage([tower(-500, -400, 100)], plot);
    // A quarter circle of radius 100 in the corner: about 785 units², 78 cells.
    expect(land.covered).toBeGreaterThan(70);
    expect(land.covered).toBeLessThan(86);
  });

  it("keeps land and air apart", () => {
    const coverage = computeCoverage([tower(0, 0, 200, true, false), tower(300, 0, 100, false, true)], plot);
    expect(coverage.towers).toBe(2);
    expect(coverage.land.covered).toBeGreaterThan(coverage.air.covered);
    expect(coverage.air.covered).toBeGreaterThan(0);
  });

  it("finds each dead zone, largest first, with a spot inside it to show", () => {
    // A wall of land cover down the middle, a little left of centre, splits
    // the plot into a smaller left zone and a larger right one.
    const towers = [-300, -150, 0, 150, 300].map((y) => tower(-100, y, 120));
    const { land } = computeCoverage(towers, plot);

    expect(land.deadZones).toHaveLength(2);
    const [right, left] = land.deadZones;
    expect(right!.cells).toBeGreaterThan(left!.cells);
    expect(right!.at.x).toBeGreaterThan(0);
    expect(left!.at.x).toBeLessThan(-200);
    const total = land.covered + right!.cells + left!.cells;
    expect(total).toBe(8_000);
    // The spot is an uncovered cell's centre.
    const column = (right!.at.x - -500 - COVERAGE_STEP / 2) / COVERAGE_STEP;
    const row = (right!.at.y - -400 - COVERAGE_STEP / 2) / COVERAGE_STEP;
    expect(land.mask[row * 100 + column]).toBe(0);
  });

  it("a fully covered plot has no dead zone", () => {
    const { land } = computeCoverage([tower(0, 0, 700)], plot);
    expect(land.share).toBe(1);
    expect(land.deadZones).toEqual([]);
  });
});

describe("percentText", () => {
  it("rounds down, so one open cell never reads 100%", () => {
    expect(percentText(0.874)).toBe("87%");
    expect(percentText(0.9999)).toBe("99%");
    expect(percentText(1)).toBe("100%");
    expect(percentText(0)).toBe("0%");
  });
});
