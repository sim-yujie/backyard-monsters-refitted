import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData, Resources } from "@/api/types";
import { costOf, instantCost } from "../buildingCosts";
import { readYard, type Yard } from "../yardModel";
import type { PlanNode } from "./placement";
import { Plan } from "./plan";
import { summariseSelection, wallBatchPreview, wallTargets } from "./summary";

/**
 * The bottom bar's numbers and the wall panel's preview.
 *
 * Every expected figure below is the cost table read by hand
 * (`buildingCostData.ts`): a Block's four upgrade steps are 0/10,000,
 * 100,000/100,000, 200,000/200,000 and 400,000/400,000 twigs and pebbles, five
 * seconds each, and its level 5 step wants Town Hall 6. Writing them out rather
 * than recomputing them with the same helpers is the point — a regenerated
 * table that moves a price should fail here and be looked at.
 */

/* ── A yard to add up ─────────────────────────────────────────────────────── */

const BUILDINGS: readonly BuildingData[] = [
  // Four blocks at level 1, one already at the top of its ladder.
  { id: 1, t: 17, X: 0, Y: 0 },
  { id: 2, t: 17, X: 20, Y: 0 },
  { id: 3, t: 17, X: 40, Y: 0 },
  { id: 4, t: 17, X: 60, Y: 0 },
  { id: 5, t: 17, X: 100, Y: 0, l: 5 },
  // A legacy stone block: a type 17 at level 2 or better, whatever it says.
  { id: 6, t: 18, X: -100, Y: 0 },
  { id: 7, t: 20, X: 200, Y: 0 },
  { id: 8, t: 14, X: -300, Y: 0, l: 5 },
];

const yardOf = (resources: Resources): Yard =>
  readYard({
    error: 0,
    id: 1,
    baseid: "1",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    savetime: 1_700_000_000,
    storedata: { ENL: { q: 0 } },
    resources,
    buildingdata: Object.fromEntries(BUILDINGS.map((entry) => [String(entry.id), entry])),
    mushrooms: { l: [{ id: 1, X: 300, Y: 200 }] },
  } as unknown as BaseLoadResponse);

const RICH = yardOf({ r1: 10_000_000, r2: 10_000_000, r3: 10_000_000, r4: 10_000_000 });

const nodesOf = (yard: Yard, ids: readonly number[]): PlanNode[] => {
  const plan = Plan.fromYard(yard);
  return ids.map((id) => {
    const node = plan.get(id);
    if (!node) throw new Error(`no node ${id}`);
    return node;
  });
};

/* ── The selection summary ────────────────────────────────────────────────── */

describe("summariseSelection", () => {
  it("adds up the next level of everything selected", () => {
    const summary = summariseSelection(nodesOf(RICH, [1, 2, 3]), RICH);

    // Three blocks leaving level 1: 10,000 pebbles and five seconds each.
    expect(summary.needed).toEqual({ r1: 0, r2: 30_000, r3: 0, r4: 0 });
    expect(summary.seconds).toBe(15);
    expect(summary.maxed).toBe(0);
  });

  it("reads the yard's holdings and names what is short", () => {
    const poor = yardOf({ r1: 1_000, r2: 12_000 });
    const summary = summariseSelection(nodesOf(poor, [1, 2, 3]), poor);

    expect(summary.held).toEqual({ r1: 1_000, r2: 12_000, r3: 0, r4: 0 });
    expect(summary.shortfall).toEqual({ r1: 0, r2: 18_000, r3: 0, r4: 0 });
  });

  it("counts a building with no next level rather than charging for one", () => {
    const summary = summariseSelection(nodesOf(RICH, [1, 5]), RICH);

    expect(summary.maxed).toBe(1);
    expect(summary.needed).toEqual({ r1: 0, r2: 10_000, r3: 0, r4: 0 });
    expect(summary.byType.map((row) => row.type)).toEqual([17]);
  });

  it("splits the cost by type, named and counted", () => {
    const summary = summariseSelection(nodesOf(RICH, [1, 2, 7]), RICH);

    expect(summary.byType).toEqual([
      { type: 17, name: "Block", count: 2, needed: { r1: 0, r2: 20_000, r3: 0, r4: 0 } },
      {
        type: 20,
        name: "Cannon Tower",
        count: 1,
        // Leaving level 1: the Cannon Tower's second step.
        needed: { r1: 10_000, r2: 7_500, r3: 2_500, r4: 0 },
      },
    ]);
  });

  it("prices a legacy stone block as a block at level 2", () => {
    const summary = summariseSelection(nodesOf(RICH, [6]), RICH);

    // costs[2] of type 17, not type 18's own single build step.
    expect(summary.needed).toEqual({ r1: 100_000, r2: 100_000, r3: 0, r4: 0 });
    expect(summary.byType[0]).toMatchObject({ type: 18, name: "Stone Block", count: 1 });
  });

  it("shows the shiny every step would cost outright", () => {
    const step = costOf(17, 1);
    if (!step) throw new Error("no such step");
    const summary = summariseSelection(nodesOf(RICH, [1, 2, 3]), RICH);
    expect(summary.shiny).toBe(3 * instantCost(step));
    expect(summary.shiny).toBeGreaterThan(0);
  });

  it("is all zeroes and no rows for an empty selection", () => {
    const summary = summariseSelection([], RICH);
    expect(summary.needed).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(summary.byType).toEqual([]);
    expect(summary.seconds).toBe(0);
    expect(summary.maxed).toBe(0);
  });

  it("ignores a mushroom, which has no ladder to climb", () => {
    const plan = Plan.fromYard(RICH);
    const summary = summariseSelection(plan.all(), RICH);
    expect(summary.byType.some((row) => row.type === 7)).toBe(false);
  });
});

/* ── The wall batch preview ───────────────────────────────────────────────── */

describe("wallBatchPreview", () => {
  it("splits the walls into those it would raise and those already there", () => {
    const preview = wallBatchPreview(nodesOf(RICH, [1, 2, 3, 4, 5, 7]), 5, RICH);

    expect(preview.eligible).toEqual([1, 2, 3, 4]);
    expect(preview.skipped).toEqual([5]);
    // Four walls, four steps each.
    expect(preview.steps).toBe(16);
  });

  it("charges every step of every wall", () => {
    const preview = wallBatchPreview(nodesOf(RICH, [1, 2, 3, 4]), 5, RICH);

    // 700,000 twigs and 710,000 pebbles to take one block from 1 to 5.
    expect(preview.cost).toEqual({
      r1: 2_800_000,
      r2: 2_840_000,
      r3: 0,
      r4: 0,
      time: 80,
    });
    expect(preview.shortfall).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });

  it("starts a legacy stone block at level 2", () => {
    const preview = wallBatchPreview(nodesOf(RICH, [6]), 5, RICH);

    expect(preview.eligible).toEqual([6]);
    expect(preview.steps).toBe(3);
    expect(preview.cost.r1).toBe(700_000);
    expect(preview.cost.r2).toBe(700_000);
  });

  it("names the Town Hall level the target needs when the yard is short of it", () => {
    // The fixture's hall is level 5; the level 5 wall step wants 6.
    expect(wallBatchPreview(nodesOf(RICH, [1]), 5, RICH).gate).toEqual({ level: 5, need: 6 });
    expect(wallBatchPreview(nodesOf(RICH, [1]), 4, RICH).gate).toBeNull();
  });

  it("clears the gate once the hall is high enough", () => {
    const tall = readYard({
      error: 0,
      id: 1,
      baseid: "1",
      basesaveid: 1,
      worldsize: [800, 800],
      currenttime: 1_700_000_000,
      savetime: 1_700_000_000,
      storedata: { ENL: { q: 0 } },
      resources: { r1: 10_000_000, r2: 10_000_000 },
      buildingdata: {
        "1": { id: 1, t: 17, X: 0, Y: 0 },
        "8": { id: 8, t: 14, X: -300, Y: 0, l: 10 },
      },
      mushrooms: { l: [] },
    } as unknown as BaseLoadResponse);

    expect(wallBatchPreview(nodesOf(tall, [1]), 5, tall).gate).toBeNull();
  });

  it("reports the shortfall against what the yard holds", () => {
    const poor = yardOf({ r1: 2_800_000, r2: 40_000 });
    const preview = wallBatchPreview(nodesOf(poor, [1, 2, 3, 4]), 5, poor);

    expect(preview.shortfall).toEqual({ r1: 0, r2: 2_800_000, r3: 0, r4: 0 });
  });

  it("leaves anything that is not a wall out of both lists", () => {
    const preview = wallBatchPreview(nodesOf(RICH, [7, 8]), 5, RICH);

    expect(preview.eligible).toEqual([]);
    expect(preview.skipped).toEqual([]);
    expect(preview.steps).toBe(0);
    expect(preview.cost).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0, time: 0 });
  });
});

describe("wallTargets", () => {
  it("offers level 2 up to the top of the ladder with the hall each one needs", () => {
    expect(wallTargets()).toEqual([
      { level: 2, need: 3 },
      { level: 3, need: 4 },
      { level: 4, need: 5 },
      { level: 5, need: 6 },
    ]);
  });
});
