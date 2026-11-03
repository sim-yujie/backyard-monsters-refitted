import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { readYard, type Yard } from "../yardModel";
import { Plan } from "./plan";
import type { PlanNode } from "./placement";
import { ladderFor } from "./upgrades";

/**
 * One building's upgrade ladder: what each level above it costs and what
 * stops it.
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
