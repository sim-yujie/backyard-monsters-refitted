import { describe, expect, test } from "bun:test";
import type { Context } from "koa";
import type { Save } from "../../../../database/models/save.model.js";
import { isValidPurchase, purchaseHandler } from "./purchaseHandler.js";
import { updateCredits } from "../../../../services/base/updateCredits.js";

/** A purchase count must be a whole, positive number (security audit 2026-10-29, I1). */
const setup = () => {
  const save = { storedata: {}, protected: 0, credits: 1000 } as unknown as Save;
  const ctx = { authUser: { userid: 1, shiny_locked: false, save } } as unknown as Context;
  return { save, ctx };
};

describe("purchase quantity", () => {
  test("a whole, positive count is bought and paid for", () => {
    const { save, ctx } = setup();
    purchaseHandler(ctx, ["PRO1", 2], save);

    expect(save.storedata?.PRO1.q).toBe(2);
    expect(save.protected).toBeGreaterThan(0);
    expect(save.credits).toBeLessThan(1000);
  });

  test.each([
    ["negative", -5],
    ["zero", 0],
    ["fraction", 0.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a string", "3"],
    ["missing", undefined],
  ])("a %s count changes nothing", (_, quantity) => {
    const { save, ctx } = setup();
    save.protected = 5000;
    purchaseHandler(ctx, ["PRO1", quantity] as unknown as [string, number], save);

    expect(save.storedata).toEqual({});
    expect(save.protected).toBe(5000);
    expect(save.credits).toBe(1000);
  });

  test("a purchase that is not an [item, count] pair changes nothing", () => {
    for (const bad of [{ PRO1: 1 }, [1, 1], "PRO1", []]) {
      const { save, ctx } = setup();
      purchaseHandler(ctx, bad as unknown as [string, number], save);
      expect(save.storedata).toEqual({});
      expect(save.credits).toBe(1000);
    }
  });

  test("updateCredits itself refuses NaN and fractions", () => {
    for (const quantity of [Number.NaN, 0.5, -1, 0]) {
      const { save, ctx } = setup();
      updateCredits(ctx, save, "PRO1", quantity);
      expect(save.credits).toBe(1000);
    }
  });

  test("isValidPurchase", () => {
    expect(isValidPurchase(["PRO1", 1])).toBe(true);
    expect(isValidPurchase(["PRO1", 1.5])).toBe(false);
    expect(isValidPurchase(["PRO1", 2 ** 60])).toBe(false);
    expect(isValidPurchase(null)).toBe(false);
  });
});
