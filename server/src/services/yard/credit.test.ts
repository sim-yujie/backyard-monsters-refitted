import { describe, expect, test } from "bun:test";
import { BASE_STORAGE } from "../base/economy/resourceBudget.js";
import { creditResources, fitCredit, type CreditSave } from "./credit.js";

/** No silos: every cap is 10,000. */
const yardOf = (resources: Record<string, unknown>): CreditSave => ({
  buildingdata: {},
  storedata: {},
  outposts: [],
  resources,
});

describe("fitCredit", () => {
  test("lets through what fits and names the rest", () => {
    const save = yardOf({ r1: BASE_STORAGE - 300, r2: 0, r3: BASE_STORAGE, r4: 0 });
    expect(fitCredit(save, { r1: 1000, r2: 500, r3: 20 })).toEqual({
      credited: { r1: 300, r2: 500, r3: 0, r4: 0 },
      overflow: { r1: 700, r2: 0, r3: 20, r4: 0 },
    });
  });

  test("never reduces a pool already over the cap", () => {
    const save = yardOf({ r1: BASE_STORAGE + 5000 });
    expect(fitCredit(save, { r1: 100 }).credited.r1).toBe(0);
    expect(fitCredit(save, { r1: 100 }).overflow.r1).toBe(100);
  });

  test("reads missing, negative and fractional amounts as whole non-negative ones", () => {
    const save = yardOf({});
    expect(fitCredit(save, { r1: -5, r2: 2.9 }).credited).toEqual({ r1: 0, r2: 2, r3: 0, r4: 0 });
  });

  test("the cap follows the yard's silos", () => {
    const save: CreditSave = {
      ...yardOf({ r4: BASE_STORAGE }),
      buildingdata: { "1": { id: 1, t: 6, x: 0, y: 0, l: 1 } },
    };
    expect(fitCredit(save, { r4: 100 }).credited.r4).toBe(100);
  });

  test("a cap handed in replaces the yard's own (Krallen's raise on attack loot)", () => {
    const save = yardOf({ r1: BASE_STORAGE });
    expect(fitCredit(save, { r1: 5000 }, 12_000).credited.r1).toBe(2000);
    expect(creditResources(save, { r1: 5000 }, 12_000).overflow.r1).toBe(3000);
    expect(save.resources).toEqual({ r1: 12_000 });
  });
});

describe("creditResources", () => {
  test("credits what fits into the save and returns the overflow", () => {
    const save = yardOf({ r1: BASE_STORAGE - 10, r2: 7, r3: 0, r4: 0, r1max: 99 });
    const result = creditResources(save, { r1: 50, r2: 3 });
    expect(result.overflow).toEqual({ r1: 40, r2: 0, r3: 0, r4: 0 });
    expect(save.resources).toEqual({ r1: BASE_STORAGE, r2: 10, r3: 0, r4: 0, r1max: 99 });
  });

  test("leaves the save's resources object alone when nothing lands", () => {
    const resources = { r1: BASE_STORAGE };
    const save = yardOf(resources);
    creditResources(save, { r1: 10 });
    expect(save.resources).toBe(resources);
  });
});
