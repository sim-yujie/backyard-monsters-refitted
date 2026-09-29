import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, Layout, LayoutNode } from "@/api/types";
import { readYard } from "../yardModel";
import { diffLayouts, sideStats, slotSave, slotUnplaced, slotView, statRows, type SideStats } from "./compare";
import { Plan } from "./plan";

/**
 * Comparing the plan with a saved slot (#9): the slot as a yard of its own,
 * the differences by id, each side's figures and which side a row favours.
 *
 * Expansion 0: a 1000 x 800 plot. Type 14 is the Town Hall, 20 a Cannon
 * Tower (ten levels), 17 a Block, 28 an American Flag.
 */

const save = (): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: 1,
    savetime: 1,
    storedata: {},
    resources: { r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 },
    buildinghealthdata: {},
    buildingdata: {
      "1": { id: 1, t: 14, X: -400, Y: -300, l: 5 },
      "2": { id: 2, t: 20, X: 0, Y: 0, l: 3 },
      "3": { id: 3, t: 17, X: 300, Y: 300, l: 2 },
      "4": { id: 4, t: 28, X: 200, Y: -200 },
    },
  }) as unknown as BaseLoadResponse;

const layoutOf = (nodes: LayoutNode[]): Layout => ({
  slot: 0,
  name: "Old",
  version: 2,
  expansion: 0,
  updatedAt: 0,
  nodes,
});

// The slot: the hall where it is, the cannon moved and planned to 5, no
// block, the flag, and a tower the yard no longer has.
const layout = layoutOf([
  { id: 1, t: 14, x: -400, y: -300 },
  { id: 2, t: 20, x: -200, y: 100, l: 1, plan: { level: 5, order: 0 } },
  { id: 4, t: 28, x: 200, y: -200 },
  { id: 9, t: 20, x: 300, y: -100, l: 2 },
]);

describe("slotSave and slotView", () => {
  it("puts every named building at the slot's spot, at the yard's level", () => {
    const data = slotSave(save(), layout).buildingdata!;
    expect(Object.keys(data).sort()).toEqual(["1", "2", "4", "9"]);
    expect(data["2"]).toMatchObject({ t: 20, X: -200, Y: 100, l: 3 });
    // Gone from the yard: drawn from the slot's own record.
    expect(data["9"]).toMatchObject({ id: 9, t: 20, X: 300, Y: -100, l: 2 });
  });

  it("carries the slot's plans where the yard can still do them", () => {
    const view = slotView(save(), layout);
    expect(view.plan.get(2)?.plan).toMatchObject({ level: 5 });
    expect(view.yard.buildings.map((one) => one.id).sort()).toEqual([1, 2, 4, 9]);
  });

  it("counts the yard's buildings the slot gives no spot, decorations aside", () => {
    const yard = readYard(save());
    expect(slotUnplaced(yard, layout)).toBe(1);
    expect(slotUnplaced(yard, layoutOf([{ id: 1, t: 14, x: 0, y: 0 }]))).toBe(2);
  });
});

describe("diffLayouts", () => {
  it("names what moved and what is on one side only", () => {
    const plan = Plan.fromYard(readYard(save()));
    const diff = diffLayouts(plan.buildings(), layout);
    expect([...diff.moved]).toEqual([2]);
    expect([...diff.onlyPlan]).toEqual([3]);
    expect([...diff.onlySlot]).toEqual([9]);
  });

  it("a building in the plan's drawer is on the slot's side only", () => {
    const plan = Plan.fromYard(readYard(save()));
    plan.store([2]);
    expect([...diffLayouts(plan.buildings(), layout).onlySlot].sort()).toEqual([2, 9]);
  });
});

describe("sideStats", () => {
  it("adds the levels, a planned one as reached, and prices the plans", () => {
    const yard = readYard(save());
    const plan = Plan.fromYard(yard);
    const now = sideStats(plan.buildings(), yard, plan.plot, 0);
    expect(now.levels).toBe(5 + 3 + 2 + 1);
    expect(now).toMatchObject({ cost: 0, seconds: 0, unplaced: 0 });
    expect(now.land).toBeGreaterThan(0);

    const view = slotView(save(), layout);
    const then = sideStats(view.plan.buildings(), view.yard, view.plan.plot, 1);
    expect(then.levels).toBe(5 + 5 + 1 + 2);
    expect(then.cost).toBeGreaterThan(0);
    expect(then.seconds).toBeGreaterThan(0);
    expect(then.unplaced).toBe(1);
  });
});

describe("statRows", () => {
  const base: SideStats = {
    land: 0.5,
    air: 0.2,
    landDeadZones: 2,
    airDeadZones: 1,
    levels: 100,
    cost: 1_000,
    seconds: 600,
    unplaced: 0,
  };

  it("favours more coverage and levels, and fewer dead zones, cost, time and unplaced", () => {
    const rows = statRows(base, {
      ...base,
      land: 0.6,
      air: 0.1,
      landDeadZones: 1,
      airDeadZones: 3,
      levels: 90,
      cost: 500,
      seconds: 900,
      unplaced: 2,
    });
    expect(Object.fromEntries(rows.map((row) => [row.key, row.better]))).toEqual({
      land: "slot",
      air: "plan",
      landDeadZones: "slot",
      airDeadZones: "plan",
      levels: "plan",
      cost: "slot",
      seconds: "plan",
      unplaced: "plan",
    });
  });

  it("a tie, or coverage equal once rounded, favours neither", () => {
    const rows = statRows(base, { ...base, land: 0.504 });
    expect(rows.every((row) => row.better === null)).toBe(true);
  });
});
