import { describe, expect, test } from "bun:test";

import { collectsLeftOf, giftAmountOf, giftExpiresAt } from "./giftRules.js";

describe("the gift rules (issue #375)", () => {
  test("a gift is 3% of the lower cap, rounded down", () => {
    expect(giftAmountOf(10_000, 2_010_000)).toBe(300);
    expect(giftAmountOf(2_010_000, 10_000)).toBe(300);
    expect(giftAmountOf(2_010_000, 2_010_000)).toBe(60_300);
    expect(giftAmountOf(10_033, 99_999)).toBe(300);
    expect(giftAmountOf(0, 10_000)).toBe(0);
  });

  test("a gift waits 7 days", () => {
    expect(giftExpiresAt(1_000)).toBe(1_000 + 7 * 24 * 60 * 60);
  });

  test("5 collects a day", () => {
    expect(collectsLeftOf(0)).toBe(5);
    expect(collectsLeftOf(4)).toBe(1);
    expect(collectsLeftOf(5)).toBe(0);
    expect(collectsLeftOf(9)).toBe(0);
  });
});
