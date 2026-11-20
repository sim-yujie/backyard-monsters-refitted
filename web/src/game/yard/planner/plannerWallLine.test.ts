import { describe, expect, it } from "vitest";
import type { SpotCheck } from "../BuildPlacement";
import { DOUBLE_TAP_MS, drawerBudget, PlannerWallLine } from "./plannerWallLine";

/** A Block is 20 yard units across, as a main-yard wall is. */
const STEP = 20;

const line = (): PlannerWallLine => new PlannerWallLine({ type: 17, level: 5 }, STEP);

/** Everything free, except the cells listed as "x,y". */
const freeExcept =
  (...taken: string[]) =>
  (x: number, y: number): SpotCheck =>
    taken.includes(`${x},${y}`)
      ? { x, y, problem: "overlap", blockedBy: 99 }
      : { x, y, problem: null, blockedBy: null };

describe("the Planner's wall line (owner, 16 Nov 2026)", () => {
  it("puts a corner down per tap, each on the Block its stretch ends on", () => {
    const wall = line();
    expect(wall.tap({ x: 0, y: 0 }, 0)).toBe("corner");
    // 47 units along is two Blocks and a bit: the corner lands on the second.
    expect(wall.tap({ x: 47, y: 5 }, 1000)).toBe("corner");
    expect(wall.anchors).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ]);
  });

  it("ends the line on a quick second tap on the last corner, and ignores a slow one", () => {
    const wall = line();
    wall.tap({ x: 0, y: 0 }, 0);
    wall.tap({ x: 60, y: 0 }, 1000);
    expect(wall.tap({ x: 60, y: 0 }, 1000 + DOUBLE_TAP_MS + 1)).toBe("none");
    expect(wall.finished).toBe(false);
    expect(wall.tap({ x: 60, y: 0 }, 1000 + DOUBLE_TAP_MS + 50)).toBe("finish");
    expect(wall.finished).toBe(true);
    expect(wall.anchors).toHaveLength(2);
    // A new corner starts the line again.
    expect(wall.tap({ x: 60, y: 40 }, 3000)).toBe("corner");
    expect(wall.finished).toBe(false);
  });

  it("takes the last corner away, and says when there was none", () => {
    const wall = line();
    expect(wall.undo()).toBe(false);
    wall.tap({ x: 0, y: 0 }, 0);
    wall.tap({ x: 0, y: 60 }, 1000);
    expect(wall.undo()).toBe(true);
    expect(wall.anchors).toEqual([{ x: 0, y: 0 }]);
    wall.clear();
    expect(wall.anchors).toEqual([]);
  });

  it("draws an L with the longer leg first, through the live stretch only when asked", () => {
    const wall = line();
    wall.tap({ x: 0, y: 0 }, 0);
    expect(wall.hoverAt({ x: 60, y: 20 })).toBe(true);
    // Three Blocks along x, then one down y: five Blocks with the start.
    const live = wall.plan(freeExcept(), 10, true);
    expect(live?.cells.map((cell) => `${cell.x},${cell.y}`)).toEqual(["0,0", "20,0", "40,0", "60,0", "60,20"]);
    // Without the live stretch, only the corner put down.
    expect(wall.plan(freeExcept(), 10, false)?.build).toEqual([{ x: 0, y: 0 }]);
    // The same spot again changes nothing.
    expect(wall.hoverAt({ x: 60, y: 20 })).toBe(false);
  });

  it("stops following the pointer once the line is ended", () => {
    const wall = line();
    wall.tap({ x: 0, y: 0 }, 0);
    wall.tap({ x: 40, y: 0 }, 1000);
    wall.finish();
    expect(wall.hoverAt({ x: 40, y: 200 })).toBe(false);
    expect(wall.plan(freeExcept(), 10, true)?.cells).toHaveLength(3);
  });

  it("colours each Block: green while walls are left, red where blocked, grey past the drawer's stock", () => {
    const wall = line();
    wall.tap({ x: 0, y: 0 }, 0);
    wall.tap({ x: 120, y: 0 }, 1000);
    // Seven Blocks, the third on a building; three walls in the drawer.
    const plan = wall.plan(freeExcept("40,0"), 3, false);
    expect(plan?.cells.map((cell) => cell.state)).toEqual([
      "build",
      "build",
      "blocked",
      "build",
      "short",
      "short",
      "short",
    ]);
    expect(plan?.build).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 60, y: 0 },
    ]);
    expect(plan?.blocked).toBe(1);
    expect(plan?.short).toBe(3);
    // Nothing costs anything: the walls are already the player's.
    expect(plan?.cost).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });

  it("has no plan before the first corner", () => {
    expect(line().plan(freeExcept(), 3, true)).toBeNull();
  });

  it("budgets the drawer's stock and nothing else", () => {
    expect(drawerBudget(4)).toEqual({ afford: Number.POSITIVE_INFINITY, room: 4 });
    expect(drawerBudget(-1).room).toBe(0);
  });
});

/** The Block in hand before the first corner (owner, 19 Nov 2026: "the box"). */
describe("the Planner's wall line: the box before the first corner", () => {
  it("shows no box until there is a spot, then the start spot (a touch screen's middle)", () => {
    expect(line().box(freeExcept())).toBeNull();
    const started = new PlannerWallLine({ type: 17, level: 5 }, STEP, { x: 40, y: 20 });
    expect(started.box(freeExcept())).toEqual({ x: 40, y: 20, problem: null, blockedBy: null });
  });

  it("follows the mouse, red where a Block cannot stand, and stays when the mouse leaves", () => {
    const wall = new PlannerWallLine({ type: 17, level: 5 }, STEP, { x: 0, y: 0 });
    const check = freeExcept("60,0");
    // Each move to a new spot redraws, before any corner is down.
    expect(wall.hoverAt({ x: 20, y: 0 })).toBe(true);
    expect(wall.box(check)).toMatchObject({ x: 20, y: 0, problem: null });
    expect(wall.hoverAt({ x: 20, y: 0 })).toBe(false);
    expect(wall.hoverAt({ x: 60, y: 0 })).toBe(true);
    expect(wall.box(check)).toMatchObject({ x: 60, y: 0, problem: "overlap", blockedBy: 99 });
    // Off the canvas: nothing to redraw, the box stays put.
    expect(wall.hoverAt(null)).toBe(false);
    expect(wall.box(check)).toMatchObject({ x: 60, y: 0 });
  });

  it("gives way to the line's own Blocks once a corner is down, and comes back with none", () => {
    const wall = line();
    wall.hoverAt({ x: 20, y: 20 });
    wall.tap({ x: 20, y: 20 }, 0);
    expect(wall.box(freeExcept())).toBeNull();
    // Still nothing placeable from the box alone: ✓ only places between corners.
    wall.undo();
    expect(wall.plan(freeExcept(), 10, true)).toBeNull();
    expect(wall.box(freeExcept())).toMatchObject({ x: 20, y: 20 });
  });

  it("keeps the box at the tapped corner for a finger, which never hovers", () => {
    const wall = new PlannerWallLine({ type: 17, level: 5 }, STEP, { x: 0, y: 0 });
    wall.tap({ x: 100, y: 40 }, 0);
    wall.clear();
    expect(wall.box(freeExcept())).toMatchObject({ x: 100, y: 40 });
  });
});
