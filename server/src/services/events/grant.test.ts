import { describe, expect, test } from "bun:test";

import { planGrant, rewardProblem } from "./grant.js";

const NOW = 1_800_000_000;
const DAY = 86_400;
/** No silos: the base cap of 10,000. */
const save = (extra: Record<string, unknown> = {}) => ({
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
  buildingdata: {},
  storedata: {},
  researchdata: {},
  ...extra,
});

describe("planGrant", () => {
  test("resources become the outcome's credit; the report shows what fits", () => {
    const plan = planGrant(save({ resources: { r1: 9_000 } }), [{ kind: "resources", amounts: { r1: 2_000, r3: 300 } }], NOW);
    expect(plan.credit).toEqual({ r1: 2_000, r2: 0, r3: 300, r4: 0 });
    expect(plan.granted).toEqual([
      {
        kind: "resources",
        amounts: { r1: 2_000, r2: 0, r3: 300, r4: 0 },
        credited: { r1: 1_000, r2: 0, r3: 300, r4: 0 },
        overflow: { r1: 1_000, r2: 0, r3: 0, r4: 0 },
      },
    ]);
    expect(plan.slices).toEqual({});
  });

  test("Shiny is grantShiny, summed", () => {
    const plan = planGrant(save(), [{ kind: "shiny", amount: 10 }, { kind: "shiny", amount: 5 }], NOW);
    expect(plan.grantShiny).toBe(15);
  });

  test("a timed buff starts now, or runs its full length longer when already on", () => {
    expect(planGrant(save(), [{ kind: "shopItem", item: "BST" }], NOW).slices.storedata).toEqual({
      BST: { q: 1, s: NOW, e: NOW + 7 * DAY },
    });
    const running = save({ storedata: { BST: { q: 1, s: NOW - DAY, e: NOW + DAY }, BEW: { q: 2 } } });
    expect(planGrant(running, [{ kind: "shopItem", item: "BST" }], NOW).slices.storedata).toEqual({
      BST: { q: 2, s: NOW - DAY, e: NOW + 8 * DAY },
      BEW: { q: 2 },
    });
  });

  test("free speed-ups and decorations add to what is kept", () => {
    const plan = planGrant(
      save({ storedata: { FREESP3: { q: 1 } }, researchdata: { b111: 2, b5: 1 } }),
      [
        { kind: "speedup", item: "SP3", count: 2 },
        { kind: "decoration", type: 111, count: 1 },
      ],
      NOW
    );
    expect(plan.slices).toEqual({ storedata: { FREESP3: { q: 3 } }, researchdata: { b111: 3, b5: 1 } });
    expect(plan.granted).toEqual([
      { kind: "speedup", item: "SP3", count: 2, held: 3 },
      { kind: "decoration", type: 111, count: 1, stored: 3 },
    ]);
  });

  test("the input save is never changed", () => {
    const before = save({ storedata: { FREESP2: { q: 1 } } });
    const copy = structuredClone(before);
    planGrant(before, [{ kind: "speedup", item: "SP2", count: 1 }, { kind: "decoration", type: 110, count: 1 }], NOW);
    expect(before).toEqual(copy);
  });
});

describe("rewardProblem", () => {
  test("refuses what cannot be paid", () => {
    expect(rewardProblem({ kind: "decoration", type: 53, count: 1 })).toBe("not a placeable decoration");
    expect(rewardProblem({ kind: "speedup", item: "SP4" as never, count: 1 })).toBe("not a keepable speed-up");
    expect(rewardProblem({ kind: "shopItem", item: "BEW" as never })).toBe("not a timed store item");
    expect(rewardProblem({ kind: "shiny", amount: 0 })).toBe("no amount");
    expect(rewardProblem({ kind: "resources", amounts: { r5: 1 } as never })).toBe("unknown resource");
    expect(() => planGrant(save(), [{ kind: "shiny", amount: -1 }], NOW)).toThrow();
  });
});
