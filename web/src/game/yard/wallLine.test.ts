import { describe, expect, it } from "vitest";
import type { SpotCheck } from "./BuildPlacement";
import {
  affordableCount,
  lineBudgetOf,
  linePath,
  planLine,
  polylinePath,
  readLineModePreference,
  snapAnchor,
  writeLineModePreference,
} from "./wallLine";

/** The tile maths of a drawn wall line (walls Option B, owner 8 Nov 2026). */

const BLOCK = 20;
const TWIGS = { r1: 1000, r2: 0, r3: 0, r4: 0 };

const free = (x: number, y: number): SpotCheck => ({ x, y, problem: null, blockedBy: null });

describe("linePath", () => {
  it("equal ends are the one Block", () => {
    expect(linePath({ x: 40, y: 60 }, { x: 40, y: 60 }, BLOCK)).toEqual([{ x: 40, y: 60 }]);
  });

  it("a straight line along x, edge to edge, either way", () => {
    expect(linePath({ x: 0, y: 0 }, { x: 60, y: 0 }, BLOCK)).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 40, y: 0 },
      { x: 60, y: 0 },
    ]);
    expect(linePath({ x: 0, y: 0 }, { x: -40, y: 0 }, BLOCK)).toEqual([
      { x: 0, y: 0 },
      { x: -20, y: 0 },
      { x: -40, y: 0 },
    ]);
  });

  it("a straight line along y", () => {
    expect(linePath({ x: 5, y: 10 }, { x: 5, y: 70 }, BLOCK).map((p) => p.y)).toEqual([10, 30, 50, 70]);
  });

  it("rounds the end to the nearest Block from the start, so the start never moves", () => {
    // 35 units is under two Blocks: rounds to 2; 8 units across rounds to 0, a straight line.
    expect(linePath({ x: 0, y: 0 }, { x: 35, y: 8 }, BLOCK)).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 40, y: 0 },
    ]);
  });

  it("an L: the longer leg first, one corner Block, no Block twice", () => {
    const path = linePath({ x: 0, y: 0 }, { x: 60, y: 40 }, BLOCK);
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 40, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 20 },
      { x: 60, y: 40 },
    ]);
    const tall = linePath({ x: 0, y: 0 }, { x: -20, y: -60 }, BLOCK);
    expect(tall).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: -20 },
      { x: 0, y: -40 },
      { x: 0, y: -60 },
      { x: -20, y: -60 },
    ]);
    expect(new Set(path.map((p) => `${p.x},${p.y}`)).size).toBe(path.length);
  });

  it("the bend can be asked for", () => {
    expect(linePath({ x: 0, y: 0 }, { x: 60, y: 20 }, BLOCK, "yFirst")).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 20 },
      { x: 20, y: 20 },
      { x: 40, y: 20 },
      { x: 60, y: 20 },
    ]);
    expect(linePath({ x: 0, y: 0 }, { x: 20, y: 60 }, BLOCK, "xFirst")[1]).toEqual({ x: 20, y: 0 });
  });

  it("a square L has as many Blocks as both legs and the corner", () => {
    expect(linePath({ x: 0, y: 0 }, { x: 40, y: 40 }, BLOCK)).toHaveLength(5);
  });
});

describe("polylinePath (corners, owner 8 Nov 2026)", () => {
  const xy = (cells: { x: number; y: number }[]) => cells.map(({ x, y }) => `${x},${y}`);

  it("no corners, no Blocks; one corner, its one Block", () => {
    expect(polylinePath([], BLOCK)).toEqual([]);
    expect(polylinePath([{ x: 0, y: 0 }], BLOCK)).toEqual([{ x: 0, y: 0 }]);
  });

  it("three corners make two straight stretches that share the corner Block once", () => {
    const path = polylinePath(
      [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 60, y: 40 },
      ],
      BLOCK,
    );
    expect(xy(path)).toEqual(["0,0", "20,0", "40,0", "60,0", "60,20", "60,40"]);
  });

  it("a stretch between corners that do not line up is an L, longer leg first, each stretch on its own", () => {
    const path = polylinePath(
      [
        { x: 0, y: 0 },
        { x: 60, y: 20 }, // x leg longer: along x, then y
        { x: 80, y: 100 }, // y leg longer: along y, then x
      ],
      BLOCK,
    );
    expect(xy(path)).toEqual([
      "0,0", "20,0", "40,0", "60,0", "60,20",
      "60,40", "60,60", "60,80", "60,100", "80,100",
    ]);
  });

  it("a path that crosses or doubles back lays each Block once, at its first visit", () => {
    const path = polylinePath(
      [
        { x: 0, y: 0 },
        { x: 80, y: 0 },
        { x: 80, y: 40 },
        { x: 40, y: 40 },
        { x: 40, y: -40 }, // crosses the first stretch at 40,0
      ],
      BLOCK,
    );
    const keys = xy(path);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((key) => key === "40,0")).toHaveLength(1);
    expect(keys.indexOf("40,0")).toBe(2);
    expect(keys[keys.length - 1]).toBe("40,-40");
    // Back over the same stretch adds nothing new.
    expect(xy(polylinePath([{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 0, y: 0 }], BLOCK))).toEqual([
      "0,0", "20,0", "40,0", "60,0",
    ]);
  });

  it("the tail is one more stretch from the last corner (the mouse's live preview)", () => {
    const path = polylinePath([{ x: 0, y: 0 }, { x: 40, y: 0 }], BLOCK, { x: 40, y: 40 });
    expect(xy(path)).toEqual(["0,0", "20,0", "40,0", "40,20", "40,40"]);
  });

  it("a corner off the Block grid of the start is rounded, and the next stretch starts where the last ended", () => {
    expect(snapAnchor({ x: 0, y: 0 }, { x: 47, y: -8 }, BLOCK)).toEqual({ x: 40, y: 0 });
    const path = polylinePath([{ x: 0, y: 0 }, { x: 47, y: 5 }, { x: 47, y: 45 }], BLOCK);
    expect(xy(path)).toEqual(["0,0", "20,0", "40,0", "40,20", "40,40"]);
  });
});

describe("affordableCount", () => {
  it("the fewest any one resource pays for", () => {
    expect(affordableCount(TWIGS, { r1: 8500 })).toBe(8);
    expect(affordableCount({ r1: 100, r2: 100, r3: 0, r4: 0 }, { r1: 1000, r2: 250 })).toBe(2);
    expect(affordableCount(TWIGS, {})).toBe(0);
    expect(affordableCount(TWIGS, { r1: -50 })).toBe(0);
  });

  it("a free Block is not limited by resources", () => {
    expect(affordableCount({ r1: 0, r2: 0, r3: 0, r4: 0 }, {})).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("planLine", () => {
  const path = linePath({ x: 0, y: 0 }, { x: 180, y: 0 }, BLOCK); // 10 Blocks

  it("all green when free, affordable and inside the limit; the cost is the greens'", () => {
    const plan = planLine(path, free, { afford: 50, room: 50 }, TWIGS);
    expect(plan.cells.every((cell) => cell.state === "build")).toBe(true);
    expect(plan.build).toHaveLength(10);
    expect(plan.cost).toEqual({ r1: 10000, r2: 0, r3: 0, r4: 0 });
    expect(plan.shortReason).toBeNull();
  });

  it("a blocked Block is red and skipped: it spends nothing, the rest still build", () => {
    const check = (x: number, y: number): SpotCheck =>
      x === 60 ? { x, y, problem: "overlap", blockedBy: 9 } : x === 180 ? { x, y, problem: "outOfBounds", blockedBy: null } : free(x, y);
    const plan = planLine(path, check, { afford: 50, room: 50 }, TWIGS);
    expect(plan.cells.map((cell) => cell.state)).toEqual([
      "build", "build", "build", "blocked", "build", "build", "build", "build", "build", "blocked",
    ]);
    expect(plan.cells[3]).toMatchObject({ problem: "overlap", blockedBy: 9 });
    expect(plan.blocked).toBe(2);
    expect(plan.build).toHaveLength(8);
    expect(plan.build.some((cell) => cell.x === 60)).toBe(false);
  });

  it("past what the resources pay for: grey from there on, the reason resources", () => {
    const plan = planLine(path, free, { afford: 4, room: 50 }, TWIGS);
    expect(plan.cells.map((cell) => cell.state)).toEqual([
      "build", "build", "build", "build", "short", "short", "short", "short", "short", "short",
    ]);
    expect(plan.short).toBe(6);
    expect(plan.shortReason).toBe("resources");
    expect(plan.cost.r1).toBe(4000);
  });

  it("past the hall's limit: grey, the reason limit (first when both run out together)", () => {
    expect(planLine(path, free, { afford: 50, room: 3 }, TWIGS).shortReason).toBe("limit");
    expect(planLine(path, free, { afford: 3, room: 3 }, TWIGS).shortReason).toBe("limit");
    expect(planLine(path, free, { afford: 50, room: 3 }, TWIGS).build).toHaveLength(3);
  });

  it("a red Block after the budget ran out stays red; a grey one never turns green later", () => {
    const check = (x: number, y: number): SpotCheck => (x === 100 ? { x, y, problem: "overlap", blockedBy: null } : free(x, y));
    const plan = planLine(path, check, { afford: 2, room: 50 }, TWIGS);
    expect(plan.cells[5]?.state).toBe("blocked");
    expect(plan.cells.slice(2).filter((cell) => cell.state === "build")).toEqual([]);
  });

  it("no room at all: nothing green", () => {
    const plan = planLine(path, free, { afford: 0, room: 10 }, TWIGS);
    expect(plan.build).toEqual([]);
    expect(plan.cost).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });
});

describe("lineBudgetOf", () => {
  const offer = { cost: TWIGS, owned: 50, allowed: 60, gate: null };

  it("Blocks the resources pay for, and the hall's room", () => {
    expect(lineBudgetOf(offer, { r1: 25000 })).toEqual({ afford: 25, room: 10 });
  });

  it("a resources gate still leaves the room; any other gate leaves none", () => {
    expect(lineBudgetOf({ ...offer, gate: { reason: "shortfall" } }, { r1: 0 })).toEqual({ afford: 0, room: 10 });
    expect(lineBudgetOf({ ...offer, owned: 60, gate: { reason: "limit" } }, { r1: 9000 }).room).toBe(0);
    expect(lineBudgetOf({ ...offer, gate: { reason: "townHall" } }, { r1: 9000 }).room).toBe(0);
    expect(lineBudgetOf(null, { r1: 9000 })).toEqual({ afford: 0, room: 0 });
  });
});

describe("the Line toggle is remembered", () => {
  it("on unless turned off; storage that throws reads as on and writes nothing", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    expect(readLineModePreference(storage)).toBe(true);
    writeLineModePreference(false, storage);
    expect(readLineModePreference(storage)).toBe(false);
    writeLineModePreference(true, storage);
    expect(readLineModePreference(storage)).toBe(true);

    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLineModePreference(broken)).toBe(true);
    expect(() => writeLineModePreference(false, broken)).not.toThrow();
  });
});
