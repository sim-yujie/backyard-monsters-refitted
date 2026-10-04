import { describe, expect, it } from "vitest";
import {
  GRID_STEP,
  InvalidReason,
  Occupancy,
  dragToYard,
  inBounds,
  isDecoration,
  plotBounds,
  snap,
  validateOffset,
  validatePlan,
  type PlanNode,
} from "./placement";

/** A movable building. Defaults to a 70 x 70 cannon tower. */
const node = (over: Partial<PlanNode> & { id: number }): PlanNode => ({
  type: 20,
  x: 0,
  y: 0,
  width: 70,
  height: 70,
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

/** A 20 x 20 wall. */
const wall = (id: number, x: number, y: number): PlanNode =>
  node({ id, type: 17, x, y, width: 20, height: 20 });

describe("snap", () => {
  it("rounds onto the 5-unit grid", () => {
    expect(snap(0)).toBe(0);
    expect(snap(2)).toBe(0);
    expect(snap(3)).toBe(5);
    expect(snap(-3)).toBe(-5);
    expect(snap(102)).toBe(100);
  });

  it("leaves a coordinate already on the grid alone", () => {
    for (const value of [-1620, -100, 0, 35, 1300]) expect(snap(value)).toBe(value);
  });
});

describe("plotBounds", () => {
  it("is the 1000 x 800 base plot at expansion 0", () => {
    expect(plotBounds(0)).toEqual({ halfWidth: 500, halfHeight: 400 });
  });

  it("grows with each More Yardage purchase and clamps at six", () => {
    expect(plotBounds(6)).toEqual({ halfWidth: 890, halfHeight: 710 });
    expect(plotBounds(99)).toEqual(plotBounds(6));
  });
});

describe("isDecoration", () => {
  it("covers the four id ranges with group 4", () => {
    for (const type of [28, 50, 55, 111, 120, 121, 131, 135]) {
      expect(isDecoration(type)).toBe(true);
    }
  });

  it("rejects buildings, walls and mushrooms", () => {
    for (const type of [1, 7, 14, 17, 20, 51, 52, 112, 127]) {
      expect(isDecoration(type)).toBe(false);
    }
  });
});

describe("inBounds", () => {
  const plot = plotBounds(0);

  it("accepts a footprint wholly inside the plot", () => {
    expect(inBounds(node({ id: 1, x: 0, y: 0 }), 0, 0, plot)).toBe(true);
  });

  it("accepts a footprint ending exactly on the far edge", () => {
    expect(inBounds(node({ id: 1 }), 430, 330, plot)).toBe(true);
  });

  it("rejects a footprint whose far edge crosses the plot", () => {
    expect(inBounds(node({ id: 1 }), 435, 0, plot)).toBe(false);
    expect(inBounds(node({ id: 1 }), 0, 335, plot)).toBe(false);
  });

  it("rejects a footprint whose origin is before the near edge", () => {
    expect(inBounds(node({ id: 1 }), -505, 0, plot)).toBe(false);
    expect(inBounds(node({ id: 1 }), -500, 0, plot)).toBe(true);
  });

  it("holds a decoration to the plot like any building (#128)", () => {
    const flag = node({ id: 2, type: 30, width: 40, height: 40, decoration: true });
    expect(inBounds(flag, 460, 0, plot)).toBe(true);
    expect(inBounds(flag, 465, 0, plot)).toBe(false);
    expect(inBounds(flag, 900, 600, plot)).toBe(false);
  });

  it("lets a decoration stay at its saved spot outside the plot, and nowhere else outside", () => {
    const flag = node({ id: 2, type: 30, width: 40, height: 40, decoration: true, home: { x: 900, y: 600 } });
    expect(inBounds(flag, 900, 600, plot)).toBe(true);
    expect(inBounds(flag, 905, 600, plot)).toBe(false);
    expect(inBounds(flag, 0, 0, plot)).toBe(true);
  });
});

describe("Occupancy", () => {
  it("reports an empty grid as free", () => {
    const grid = new Occupancy();
    expect(grid.blockedBy(node({ id: 1 }), 0, 0)).toBeNull();
  });

  it("finds the building holding the cells", () => {
    const grid = new Occupancy();
    grid.stamp(node({ id: 42, x: 0, y: 0 }));
    expect(grid.blockedBy(node({ id: 7 }), 0, 0)).toBe(42);
  });

  it("blocks on a single shared cell at the corner", () => {
    const grid = new Occupancy();
    grid.stamp(wall(1, 0, 0));
    // The walls are 20 wide, so 20 clears and 15 shares one column of cells.
    expect(grid.blockedBy(wall(2, 20, 0), 20, 0)).toBeNull();
    expect(grid.blockedBy(wall(2, 15, 0), 15, 0)).toBe(1);
  });

  it("frees the cells again on erase", () => {
    const grid = new Occupancy();
    const tower = node({ id: 5 });
    grid.stamp(tower);
    grid.erase(tower);
    expect(grid.blockedBy(node({ id: 6 }), 0, 0)).toBeNull();
  });

  it("holds a decoration sitting outside the plot", () => {
    const grid = new Occupancy();
    const flag = node({ id: 9, width: 40, height: 40, decoration: true, x: 800, y: 600 });
    grid.stamp(flag);
    expect(grid.blockedBy(node({ id: 10 }), 800, 600)).toBe(9);
  });

  it("ignores a footprint pushed off the edge of the grid", () => {
    const grid = new Occupancy();
    const far = node({ id: 3, x: 20_000, y: 20_000 });
    expect(() => grid.stamp(far)).not.toThrow();
    expect(grid.blockedBy(node({ id: 4 }), 0, 0)).toBeNull();
  });

  // #212: the owner's Town Hall is building 0, and "blocked by 0" used to
  // read the same as "free".
  it("names building 0 as the blocker, not as free ground", () => {
    const grid = new Occupancy();
    grid.stamp(node({ id: 0, type: 14, x: -65, y: -65, width: 130, height: 130 }));
    expect(grid.blockedBy(node({ id: 1, type: 115 }), -30, -30)).toBe(0);
    expect(grid.blockedBy(node({ id: 1, type: 115 }), 65, -30)).toBeNull();
  });

  it("reports building 0 as the one a stamp landed on", () => {
    const grid = new Occupancy();
    grid.stamp(node({ id: 0 }));
    expect(grid.stamp(node({ id: 1 }))).toBe(0);
    expect(grid.stamp(node({ id: 2, x: 200 }))).toBeNull();
  });

  it("covers every cell of a footprint, not just its corners", () => {
    const grid = new Occupancy();
    grid.stamp(node({ id: 1, type: 14, width: 130, height: 130 }));
    for (let offset = 0; offset < 130; offset += GRID_STEP) {
      expect(grid.blockedBy(wall(2, offset, offset), offset, offset)).toBe(1);
    }
  });
});

// #231: what the nearby outlines are looked up with. Blocks are 20 units and
// line up with multiples of 20, so areas on those lines are read exactly.
describe("Occupancy.occupantsIn", () => {
  const area = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

  it("finds what stands in an area, including building 0, and nothing outside it", () => {
    const grid = new Occupancy();
    grid.stamp(node({ id: 0, x: 0, y: 0 }));
    grid.stamp(wall(1, 100, 0));
    grid.stamp(wall(2, 200, 0));
    expect(grid.occupantsIn([area(0, 0, 200, 100)])).toEqual(new Set([0, 1]));
  });

  it("counts a footprint with any one cell inside", () => {
    const grid = new Occupancy();
    grid.stamp(node({ id: 7, x: -60, y: -60 }));
    // The tower's last cell is at (5, 5); the area starts at (0, 0).
    expect(grid.occupantsIn([area(0, 0, 40, 40)])).toEqual(new Set([7]));
    expect(grid.occupantsIn([area(20, 20, 40, 40)])).toEqual(new Set());
  });

  it("joins several areas and names each building once", () => {
    const grid = new Occupancy();
    grid.stamp(wall(1, 0, 0));
    grid.stamp(wall(2, 400, 400));
    grid.stamp(wall(3, 800, 0));
    const found = grid.occupantsIn([area(-20, -20, 60, 60), area(0, 0, 40, 40), area(380, 380, 60, 60)]);
    expect(found).toEqual(new Set([1, 2]));
  });

  it("leaves its scratch clean, so the next call is not answered from the last", () => {
    const grid = new Occupancy();
    grid.stamp(wall(1, 0, 0));
    expect(grid.occupantsIn([area(0, 0, 20, 20)])).toEqual(new Set([1]));
    grid.erase(wall(1, 0, 0));
    expect(grid.occupantsIn([area(0, 0, 20, 20)])).toEqual(new Set());
  });

  it("clips an area running off the grid, and skips an empty one", () => {
    const grid = new Occupancy();
    grid.stamp(wall(1, -1620, -1300));
    expect(grid.occupantsIn([area(-5000, -5000, 3400, 3720)])).toEqual(new Set([1]));
    expect(grid.occupantsIn([area(-1620, -1300, 0, 20)])).toEqual(new Set());
  });
});

describe("validateOffset", () => {
  const plot = plotBounds(0);

  it("accepts a move into empty ground", () => {
    const grid = new Occupancy();
    grid.stamp(node({ id: 1, x: -200, y: -200 }));
    const moving = [node({ id: 2, x: 0, y: 0 })];
    expect(validateOffset(moving, 100, 0, grid, plot).valid).toBe(true);
  });

  it("names both the mover and what it hit", () => {
    const grid = new Occupancy();
    grid.stamp(node({ id: 1, x: 100, y: 0 }));
    const result = validateOffset([node({ id: 2, x: 0, y: 0 })], 100, 0, grid, plot);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      { id: 2, reason: InvalidReason.OVERLAP, otherId: 1 },
    ]);
  });

  it("refuses a move that leaves the plot", () => {
    const grid = new Occupancy();
    const result = validateOffset([node({ id: 2, x: 400, y: 0 })], 100, 0, grid, plot);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.reason).toBe(InvalidReason.BOUNDS);
  });

  it("refuses it for a decoration too, unless it lands back on its saved spot (#128)", () => {
    const grid = new Occupancy();
    const flag = node({ id: 2, x: 400, y: 0, width: 40, height: 40, decoration: true });
    expect(validateOffset([flag], 100, 0, grid, plot).valid).toBe(false);

    const outside = node({ id: 3, x: 400, y: 0, width: 40, height: 40, decoration: true, home: { x: 500, y: 0 } });
    expect(validateOffset([outside], 100, 0, grid, plot).valid).toBe(true);
    expect(validateOffset([outside], 105, 0, grid, plot).valid).toBe(false);
  });

  it("treats a fixed node in the grid as an obstacle", () => {
    const grid = new Occupancy();
    grid.stamp(node({ id: 1_000_001, type: 7, width: 30, height: 30, x: 50, y: 0, fixed: true }));
    const result = validateOffset([node({ id: 2, x: 0, y: 0 })], 50, 0, grid, plot);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.otherId).toBe(1_000_001);
  });

  it("does not fault a group against itself", () => {
    const grid = new Occupancy();
    const run = [wall(1, 0, 0), wall(2, 20, 0), wall(3, 40, 0)];
    // None of these are in the grid, which is what beginMove arranges.
    expect(validateOffset(run, 100, 100, grid, plot).valid).toBe(true);
  });

  it("reports every offending member of a group", () => {
    const grid = new Occupancy();
    grid.stamp(wall(9, 120, 0));
    grid.stamp(wall(8, 160, 0));
    const run = [wall(1, 20, 0), wall(2, 60, 0), wall(3, 100, 0)];
    const result = validateOffset(run, 100, 0, grid, plot);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.id).sort()).toEqual([1, 2]);
  });
});

describe("validatePlan", () => {
  const plot = plotBounds(0);

  it("passes a yard with no overlaps", () => {
    const nodes = [node({ id: 1, x: 0, y: 0 }), node({ id: 2, x: 100, y: 0 })];
    expect(validatePlan(nodes, plot).valid).toBe(true);
  });

  it("finds a pair sharing cells", () => {
    const nodes = [node({ id: 1, x: 0, y: 0 }), node({ id: 2, x: 50, y: 0 })];
    const result = validatePlan(nodes, plot);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({ id: 2, reason: InvalidReason.OVERLAP, otherId: 1 });
  });

  it("finds an overlap with building 0 whichever of the pair comes first (#212)", () => {
    const hall = node({ id: 0, type: 14, x: -65, y: -65, width: 130, height: 130 });
    const tower = node({ id: 1, type: 115, x: -35, y: -35 });
    expect(validatePlan([hall, tower], plot).issues).toEqual([
      { id: 1, reason: InvalidReason.OVERLAP, otherId: 0 },
    ]);
    expect(validatePlan([tower, hall], plot).issues).toEqual([
      { id: 0, reason: InvalidReason.OVERLAP, otherId: 1 },
    ]);
  });

  it("finds a building outside the plot", () => {
    const result = validatePlan([node({ id: 1, x: 480, y: 0 })], plot);
    expect(result.issues[0]).toEqual({ id: 1, reason: InvalidReason.BOUNDS });
  });

  it("reports both faults for a building that is out of bounds and on top of another", () => {
    const nodes = [node({ id: 1, x: 460, y: 0 }), node({ id: 2, x: 480, y: 0 })];
    const result = validatePlan(nodes, plot);
    expect(result.issues.filter((issue) => issue.id === 2)).toHaveLength(2);
  });

  it("leaves the grid it was given holding the plan", () => {
    const grid = new Occupancy();
    validatePlan([node({ id: 1, x: 0, y: 0 })], plot, grid);
    expect(grid.blockedBy(node({ id: 2 }), 0, 0)).toBe(1);
  });

  it("scales to a full yard of walls", () => {
    const nodes: PlanNode[] = [];
    for (let i = 0; i < 400; i++) wallRow(nodes, i);
    expect(validatePlan(nodes, plot).valid).toBe(true);
  });
});

/** Lays wall `i` out in a 20-per-row block that fits the base plot. */
const wallRow = (into: PlanNode[], i: number): void => {
  into.push(wall(i + 1, -400 + (i % 20) * 20, -300 + Math.floor(i / 20) * 20));
};

describe("dragToYard", () => {
  it("is the inverse of the isometric projection, snapped", () => {
    // 100 units on X alone is +100 iso x and +50 iso y.
    expect(dragToYard(100, 50)).toEqual({ dx: 100, dy: 0 });
    // 100 units on Y alone is -100 iso x and +50 iso y.
    expect(dragToYard(-100, 50)).toEqual({ dx: 0, dy: 100 });
  });

  it("does not drift for a pointer that has not moved", () => {
    expect(dragToYard(0, 0)).toEqual({ dx: 0, dy: 0 });
  });

  it("rounds a fractional drag to the nearest grid step in both directions", () => {
    expect(dragToYard(1, 1)).toEqual({ dx: 0, dy: 0 });
    expect(dragToYard(-2, 4)).toEqual({ dx: 5, dy: 5 });
  });
});
