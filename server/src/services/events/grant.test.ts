import { describe, expect, test } from "bun:test";

import {
  EVENT_COINS_LADDER_TOTAL,
  EVENT_COINS_PER_CALENDAR_DAY,
  withDailyCoins,
} from "../../game-data/events/eventRewards.js";
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

describe("event coins as a reward (beta 7 grill item 29)", () => {
  test("coins add up into grantCoins and are reported; the yard is not touched", () => {
    const plan = planGrant(
      save(),
      [
        { kind: "eventCoins", amount: 15 },
        { kind: "shiny", amount: 10 },
        { kind: "eventCoins", amount: 40 },
      ],
      NOW
    );
    expect(plan.grantCoins).toBe(55);
    expect(plan.grantShiny).toBe(10);
    expect(plan.slices).toEqual({});
    expect(plan.granted).toEqual([
      { kind: "eventCoins", amount: 15 },
      { kind: "shiny", amount: 10 },
      { kind: "eventCoins", amount: 40 },
    ]);
    expect(planGrant(save(), [{ kind: "shiny", amount: 1 }], NOW).grantCoins).toBe(0);
  });

  test("a coin reward needs an amount", () => {
    expect(rewardProblem({ kind: "eventCoins", amount: 0 })).toBe("no amount");
    expect(rewardProblem({ kind: "eventCoins", amount: 15 })).toBeNull();
  });

  test("withDailyCoins adds 15 to every day of a 14-day calendar: 210 in all", () => {
    const days = Array.from({ length: 14 }, () => ({ rewards: [{ kind: "shiny", amount: 5 } as const] }));
    const calendar = withDailyCoins(days);
    expect(EVENT_COINS_PER_CALENDAR_DAY).toBe(15);
    expect(calendar.every((day) => day.rewards.length === 2)).toBe(true);
    const total = calendar.reduce((sum, day) => sum + planGrant(save(), day.rewards, NOW).grantCoins, 0);
    expect(total).toBe(210);
    // About 400 with the ladder's ~190 (owner's figure).
    expect(total + EVENT_COINS_LADDER_TOTAL).toBe(400);
    expect(days[0]!.rewards).toHaveLength(1);
  });
});
