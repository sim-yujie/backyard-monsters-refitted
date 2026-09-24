import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { readYard, type Yard } from "../yardModel";
import { Plan } from "./plan";
import type { PlanNode } from "./placement";
import { ladderFor, planTotals, previewApply, wallClockSeconds } from "./upgrades";

/**
 * The plan-side arithmetic: what one building's ladder offers, what the whole
 * plan costs, and what Apply would do with it.
 *
 * Every expected number is read by hand out of `buildingCostData.ts` rather
 * than computed from it, because a test that derives its expectation from the
 * table under test would pass a regenerated table that had gone wrong. The
 * rows used throughout:
 *
 * | Type | Step | Cost | Time |
 * |---|---|---|---|
 * | 20 Cannon Tower | 1 → 2 | 10,000 / 7,500 / 2,500 | 900 s |
 * | 20 Cannon Tower | 2 → 3 | 50,000 / 37,500 / 12,500 | 2,700 s |
 * | 17 Block | 1 → 2 | 0 / 10,000 / 0 | 5 s |
 * | 1 Twig Snapper | 1 → 2 | 0 / 1,575 / 0 | 300 s |
 * | 15 Housing | 1 → 2 | 8,640 / 8,640 / 0, needs a type 8 | 4,500 s |
 *
 * `previewApply` is checked against the same cases the server's own walk is
 * (`server/src/services/yardplanner/startUpgrades.test.ts`), because the two
 * agreeing is the whole reason the client has a copy of the walk at all.
 */

const NOW = 1_700_000_000;

const PLENTY = { r1: 1_000_000_000, r2: 1_000_000_000, r3: 1_000_000_000, r4: 1_000_000_000 };

/** A yard of exactly the buildings a case needs, at expansion 6. */
const yardOf = (
  buildings: readonly BuildingData[],
  over: {
    resources?: Record<string, number>;
    storedata?: Record<string, { q?: number; e?: number }>;
    health?: Record<string, number>;
  } = {},
): Yard =>
  readYard({
    error: 0,
    id: 1,
    baseid: "1",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: NOW,
    savetime: NOW,
    // Five workers, the sandbox account's purchase, and the full plot.
    storedata: over.storedata ?? { ENL: { q: 6 }, BEW: { q: 4 } },
    resources: over.resources ?? PLENTY,
    buildingdata: Object.fromEntries(buildings.map((one) => [String(one.id), one])),
    buildinghealthdata: over.health ?? {},
    mushrooms: { l: [] },
  } as unknown as BaseLoadResponse);

/** A level 10 Town Hall, which clears every gate in the Map Room 2 table. */
const HALL: BuildingData = { id: 0, t: 14, X: 0, Y: 0, l: 10 };

/** `count` cannon towers in a row, ids 1 upwards. */
const cannons = (count: number, level?: number): BuildingData[] =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    t: 20,
    X: 200 + index * 80,
    Y: 0,
    ...(level === undefined ? {} : { l: level }),
  }));

const planOf = (yard: Yard): Plan => Plan.fromYard(yard);

/** The node for an id, which every case knows exists. */
const nodeOf = (plan: Plan, id: number): PlanNode => {
  const node = plan.get(id);
  if (!node) throw new Error(`no node ${id}`);
  return node;
};

/* ── ladderFor ────────────────────────────────────────────────────────────── */

describe("ladderFor", () => {
  it("offers every level above the building's own, priced from where it is", () => {
    const yard = yardOf([HALL, ...cannons(1)]);
    const ladder = ladderFor(nodeOf(planOf(yard), 1), yard);

    expect(ladder.current).toBe(1);
    expect(ladder.max).toBe(10);
    expect(ladder.steps.map((step) => step.level)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(ladder.steps[0]!.cost).toEqual({ r1: 10_000, r2: 7_500, r3: 2_500, r4: 0, time: 900 });
    // Cumulative, not the last step alone.
    expect(ladder.steps[1]!.cost).toEqual({
      r1: 60_000,
      r2: 45_000,
      r3: 15_000,
      r4: 0,
      time: 3_600,
    });
    expect(ladder.blocked).toBeNull();
  });

  it("reports health at the current level and the next", () => {
    const yard = yardOf([HALL, ...cannons(1)]);
    const ladder = ladderFor(nodeOf(planOf(yard), 1), yard);

    expect(ladder.healthNow).toBe(6_000);
    expect(ladder.healthNext).toBe(9_000);
  });

  it("names the Town Hall level a gated step wants, and says the first one is gated", () => {
    const yard = yardOf([{ id: 0, t: 14, X: 0, Y: 0, l: 1 }, ...cannons(1)]);
    const ladder = ladderFor(nodeOf(planOf(yard), 1), yard);

    expect(ladder.steps[0]!.gate).toEqual({ townHall: { have: 1, need: 2 } });
    expect(ladder.steps[0]!.firstStepGated).toBe(true);
    // A later target carries the highest hall its run of steps needs.
    expect(ladder.steps[1]!.gate).toEqual({ townHall: { have: 1, need: 3 } });
  });

  it("names a prerequisite that is not the Town Hall", () => {
    // Housing's level 1 to 2 step wants a type 8 building this yard has none of.
    const yard = yardOf([HALL, { id: 1, t: 15, X: 200, Y: 0 }]);
    const ladder = ladderFor(nodeOf(planOf(yard), 1), yard);

    expect(ladder.steps[0]!.gate).toEqual({ requirements: [[8, 1, 1]] });
  });

  it("leaves the ladder clear when nothing gates it", () => {
    const yard = yardOf([HALL, ...cannons(1)]);
    const ladder = ladderFor(nodeOf(planOf(yard), 1), yard);

    expect(ladder.steps.every((step) => step.gate === null)).toBe(true);
    expect(ladder.steps[0]!.firstStepGated).toBe(false);
  });

  it("blocks a busy building, a damaged one, and one at the top of its ladder", () => {
    const yard = yardOf([HALL, ...cannons(2)], { health: { "2": 10 } });
    const plan = planOf(yard);
    const busy = nodeOf(plan, 1);
    busy.busy = true;

    expect(ladderFor(busy, yard).blocked).toBe("busy");
    expect(ladderFor(nodeOf(plan, 2), yard).blocked).toBe("damaged");

    const maxed = yardOf([HALL, { id: 1, t: 17, X: 200, Y: 0, l: 5 }]);
    expect(ladderFor(nodeOf(planOf(maxed), 1), maxed).blocked).toBe("maxed");
    expect(ladderFor(nodeOf(planOf(maxed), 1), maxed).steps).toEqual([]);
  });

  it("gives a decoration no ladder at all", () => {
    const yard = yardOf([HALL, { id: 1, t: 30, X: 200, Y: 0 }]);
    const ladder = ladderFor(nodeOf(planOf(yard), 1), yard);

    expect(ladder.max).toBe(0);
    expect(ladder.blocked).toBe("maxed");
  });
});

/* ── planTotals ───────────────────────────────────────────────────────────── */

describe("planTotals", () => {
  it("adds up every step of every planned building", () => {
    const yard = yardOf([HALL, ...cannons(2)]);
    const plan = planOf(yard);
    plan.setPlan(1, 3);
    plan.setPlan(2, 2);

    const totals = planTotals(plan.plannedNodes(), yard);

    // 60,000 + 10,000 twigs, 45,000 + 7,500 pebbles, 15,000 + 2,500 putty.
    expect(totals.needed).toEqual({ r1: 70_000, r2: 52_500, r3: 17_500, r4: 0 });
    expect(totals.seconds).toBe(3_600 + 900);
    expect(totals.longest).toBe(3_600);
    expect(totals.steps).toBe(3);
    expect(totals.planned).toBe(2);
    expect(totals.byType).toEqual([
      { type: 20, name: "Cannon Tower", count: 2, needed: { r1: 70_000, r2: 52_500, r3: 17_500, r4: 0 } },
    ]);
  });

  it("ignores buildings with no plan", () => {
    const yard = yardOf([HALL, ...cannons(3)]);
    const plan = planOf(yard);
    plan.setPlan(2, 2);

    const totals = planTotals(plan.buildings(), yard);
    expect(totals.planned).toBe(1);
    expect(totals.needed).toEqual({ r1: 10_000, r2: 7_500, r3: 2_500, r4: 0 });
  });

  it("reports what the yard is short of, and nothing when it is not", () => {
    const poor = yardOf([HALL, ...cannons(1)], { resources: { r1: 1_000, r2: 0, r3: 0, r4: 0 } });
    const plan = planOf(poor);
    plan.setPlan(1, 2);

    const totals = planTotals(plan.plannedNodes(), poor);
    expect(totals.held).toEqual({ r1: 1_000, r2: 0, r3: 0, r4: 0 });
    expect(totals.shortfall).toEqual({ r1: 9_000, r2: 7_500, r3: 2_500, r4: 0 });

    const rich = yardOf([HALL, ...cannons(1)]);
    const richPlan = planOf(rich);
    richPlan.setPlan(1, 2);
    expect(planTotals(richPlan.plannedNodes(), rich).shortfall).toEqual({
      r1: 0,
      r2: 0,
      r3: 0,
      r4: 0,
    });
  });

  it("counts nothing for an empty plan", () => {
    const yard = yardOf([HALL, ...cannons(1)]);
    const totals = planTotals(planOf(yard).buildings(), yard);

    expect(totals.planned).toBe(0);
    expect(totals.steps).toBe(0);
    expect(totals.seconds).toBe(0);
    expect(totals.shiny).toBe(0);
  });
});

describe("wallClockSeconds", () => {
  it("is the longer of one building's own chain and the work split between workers", () => {
    const yard = yardOf([HALL, ...cannons(4)]);
    const plan = planOf(yard);
    for (let id = 1; id <= 4; id++) plan.setPlan(id, 2);
    const totals = planTotals(plan.plannedNodes(), yard);

    expect(totals.seconds).toBe(3_600);
    expect(totals.longest).toBe(900);
    // Four 900-second jobs: two workers take 1,800 seconds, five take 900.
    expect(wallClockSeconds(totals, 2)).toBe(1_800);
    expect(wallClockSeconds(totals, 5)).toBe(900);
    // No free worker is not a division by zero: it reads as one.
    expect(wallClockSeconds(totals, 0)).toBe(3_600);
  });
});

/* ── previewApply ─────────────────────────────────────────────────────────── */

describe("previewApply", () => {
  it("starts one job per free worker and holds the rest back", () => {
    const yard = yardOf([HALL, ...cannons(6)]);
    const plan = planOf(yard);
    for (let id = 1; id <= 6; id++) plan.setPlan(id, 2);

    const preview = previewApply(plan.plannedNodes(), yard);

    expect(preview.started.map((row) => row.id)).toEqual([1, 2, 3, 4, 5]);
    expect(preview.started[0]).toEqual({
      id: 1,
      t: 20,
      from: 1,
      to: 2,
      seconds: 900,
      cost: { r1: 10_000, r2: 7_500, r3: 2_500, r4: 0 },
    });
    expect(preview.waiting).toEqual([{ id: 6, t: 20, from: 1, to: 2, reason: "workers" }]);
    expect(preview.cost).toEqual({ r1: 50_000, r2: 37_500, r3: 12_500, r4: 0 });
    expect(preview.workers).toEqual({ total: 5, busyBefore: 0, busyAfter: 5 });
    expect(preview.points).toBe(0);
    expect(preview.remaining.r1).toBe(PLENTY.r1 - 50_000);
  });

  it("walks in the player's order, so reversing it reverses who waits", () => {
    const yard = yardOf([HALL, ...cannons(6)]);
    const plan = planOf(yard);
    for (let id = 6; id >= 1; id--) plan.setPlan(id, 2);

    const preview = previewApply(plan.plannedNodes(), yard);

    expect(preview.started.map((row) => row.id)).toEqual([6, 5, 4, 3, 2]);
    expect(preview.waiting.map((row) => row.id)).toEqual([1]);
  });

  it("counts the workers already on a job against the ones a plan can take", () => {
    const yard = yardOf([HALL, ...cannons(6)].map((one) => (one.id === 1 ? { ...one, cU: 600 } : one)));
    const plan = planOf(yard);
    // The busy tower is not planned; it still holds a worker.
    for (let id = 2; id <= 6; id++) plan.setPlan(id, 2);

    const preview = previewApply(plan.plannedNodes(), yard);

    expect(preview.workers).toEqual({ total: 5, busyBefore: 1, busyAfter: 5 });
    expect(preview.started).toHaveLength(4);
    expect(preview.waiting.map((row) => row.id)).toEqual([6]);
  });

  it("finishes a whole run of free steps on one building and uses no worker", () => {
    const yard = yardOf([HALL, { id: 1, t: 17, X: 200, Y: 0 }]);
    const plan = planOf(yard);
    plan.setPlan(1, 5);

    const preview = previewApply(plan.plannedNodes(), yard);

    expect(preview.started).toEqual([]);
    expect(preview.finished.map((row) => [row.from, row.to])).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ]);
    expect(preview.cost).toEqual({ r1: 700_000, r2: 710_000, r3: 0, r4: 0 });
    expect(preview.workers.busyAfter).toBe(0);
    // floor((5 + cost) / 3) per step, as `BFOUNDATION.Upgraded()` awards it.
    expect(preview.points).toBe(3_335 + 66_668 + 133_335 + 266_668);
  });

  it("starts one long step and leaves the rest of the ladder planned", () => {
    const yard = yardOf([HALL, ...cannons(1)]);
    const plan = planOf(yard);
    plan.setPlan(1, 3);

    const preview = previewApply(plan.plannedNodes(), yard);

    expect(preview.started).toEqual([
      {
        id: 1,
        t: 20,
        from: 1,
        to: 2,
        seconds: 900,
        cost: { r1: 10_000, r2: 7_500, r3: 2_500, r4: 0 },
      },
    ]);
    expect(preview.finished).toEqual([]);
    expect(preview.waiting).toEqual([]);
    expect(preview.skipped).toEqual([]);
    // The second step is charged for by nothing yet: only the first was paid.
    expect(preview.cost).toEqual({ r1: 10_000, r2: 7_500, r3: 2_500, r4: 0 });
  });

  it("shortens a countdown while Sharper Tools is running", () => {
    const yard = yardOf([HALL, ...cannons(1)], {
      storedata: { ENL: { q: 6 }, BEW: { q: 4 }, BST: { e: NOW + 3_600 } },
    });
    const plan = planOf(yard);
    plan.setPlan(1, 2);

    expect(previewApply(plan.plannedNodes(), yard).started[0]!.seconds).toBe(720);
  });

  it("skips a busy building and a damaged one", () => {
    const yard = yardOf([HALL, ...cannons(2)], { health: { "2": 10 } });
    const plan = planOf(yard);
    // Both are refused by `setPlan`; a plan made before the yard changed under
    // it is what reaches the walk, so the field is set directly.
    nodeOf(plan, 1).busy = true;
    nodeOf(plan, 1).plan = { level: 2, order: 0 };
    nodeOf(plan, 2).plan = { level: 2, order: 1 };

    const preview = previewApply(plan.plannedNodes(), yard);

    expect(preview.skipped).toEqual([
      { id: 1, t: 20, reason: "busy", from: 1, to: 2 },
      { id: 2, t: 20, reason: "damaged", from: 1, to: 2 },
    ]);
    expect(preview.started).toEqual([]);
  });

  it("skips a building the yard has already caught up with", () => {
    const yard = yardOf([HALL, ...cannons(1, 4)]);
    const plan = planOf(yard);
    nodeOf(plan, 1).plan = { level: 3, order: 0 };

    expect(previewApply(plan.plannedNodes(), yard).skipped).toEqual([
      { id: 1, t: 20, reason: "caughtUp", from: 4, to: 3 },
    ]);
  });

  it("skips a type with no ladder", () => {
    const yard = yardOf([HALL, { id: 1, t: 30, X: 200, Y: 0 }]);
    const plan = planOf(yard);
    nodeOf(plan, 1).plan = { level: 2, order: 0 };

    expect(previewApply(plan.plannedNodes(), yard).skipped).toEqual([
      { id: 1, t: 30, reason: "noLadder" },
    ]);
  });

  it("skips everything when the yard has no Town Hall", () => {
    const yard = yardOf(cannons(1));
    const plan = planOf(yard);
    plan.setPlan(1, 2);

    expect(previewApply(plan.plannedNodes(), yard).skipped).toEqual([
      { id: 1, t: 20, reason: "townHall", from: 1, to: 2, townHall: { have: 0, need: 1 } },
    ]);
  });

  it("names the Town Hall a gated step wants", () => {
    const yard = yardOf([{ id: 0, t: 14, X: 0, Y: 0, l: 1 }, ...cannons(1)]);
    const plan = planOf(yard);
    plan.setPlan(1, 2);

    expect(previewApply(plan.plannedNodes(), yard).skipped).toEqual([
      { id: 1, t: 20, reason: "townHall", from: 1, to: 2, townHall: { have: 1, need: 2 } },
    ]);
  });

  it("names a prerequisite that is not the Town Hall", () => {
    const yard = yardOf([HALL, { id: 1, t: 15, X: 200, Y: 0 }]);
    const plan = planOf(yard);
    plan.setPlan(1, 2);

    expect(previewApply(plan.plannedNodes(), yard).skipped).toEqual([
      { id: 1, t: 15, reason: "requirements", from: 1, to: 2, requirements: [[8, 1, 1]] },
    ]);
  });

  it("carries on past a job it cannot pay for", () => {
    // Putty is short for the tower, which costs 2,500 of it; the block behind
    // it needs none and still finishes (§8, Q3).
    const yard = yardOf([HALL, ...cannons(1), { id: 2, t: 17, X: -200, Y: 0 }], {
      resources: { r1: 1_000_000, r2: 1_000_000, r3: 1_000, r4: 0 },
    });
    const plan = planOf(yard);
    plan.setPlan(1, 2);
    plan.setPlan(2, 2);

    const preview = previewApply(plan.plannedNodes(), yard);

    expect(preview.skipped).toEqual([
      {
        id: 1,
        t: 20,
        reason: "shortfall",
        from: 1,
        to: 2,
        shortfall: { r1: 0, r2: 0, r3: 1_500, r4: 0 },
      },
    ]);
    expect(preview.finished.map((row) => row.id)).toEqual([2]);
    expect(preview.cost).toEqual({ r1: 0, r2: 10_000, r3: 0, r4: 0 });
    expect(preview.remaining).toEqual({ r1: 1_000_000, r2: 990_000, r3: 1_000, r4: 0 });
  });

  it("spends the pool as it goes, so a later job sees what an earlier one took", () => {
    const yard = yardOf([HALL, ...cannons(2)], {
      resources: { r1: 15_000, r2: 15_000, r3: 15_000, r4: 0 },
    });
    const plan = planOf(yard);
    plan.setPlan(1, 2);
    plan.setPlan(2, 2);

    const preview = previewApply(plan.plannedNodes(), yard);

    expect(preview.started.map((row) => row.id)).toEqual([1]);
    expect(preview.skipped).toEqual([
      {
        id: 2,
        t: 20,
        reason: "shortfall",
        from: 1,
        to: 2,
        shortfall: { r1: 5_000, r2: 0, r3: 0, r4: 0 },
      },
    ]);
  });

  it("finishes free steps before a long one on the same building", () => {
    // A Twig Snapper's 1 to 2 step is exactly 300 seconds, so it is free; its
    // 2 to 3 step is 1,200 and takes the worker.
    const yard = yardOf([HALL, { id: 1, t: 1, X: 200, Y: 0 }]);
    const plan = planOf(yard);
    plan.setPlan(1, 3);

    const preview = previewApply(plan.plannedNodes(), yard);

    expect(preview.finished).toEqual([
      { id: 1, t: 1, from: 1, to: 2, cost: { r1: 0, r2: 1_575, r3: 0, r4: 0 } },
    ]);
    expect(preview.started).toEqual([
      {
        id: 1,
        t: 1,
        from: 2,
        to: 3,
        seconds: 1_200,
        cost: { r1: 0, r2: 3_300, r3: 0, r4: 0 },
      },
    ]);
    expect(preview.workers.busyAfter).toBe(1);
  });

  it("reports nothing at all for a plan with no upgrades in it", () => {
    const yard = yardOf([HALL, ...cannons(1)]);
    const preview = previewApply(planOf(yard).plannedNodes(), yard);

    expect(preview.started).toEqual([]);
    expect(preview.finished).toEqual([]);
    expect(preview.waiting).toEqual([]);
    expect(preview.skipped).toEqual([]);
    expect(preview.cost).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });
});
