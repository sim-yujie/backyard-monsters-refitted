import { describe, expect, test } from "bun:test";
import { costLessBy, lessByPercent, moreByPercent, shorterBy, withPlunderBonus } from "./weekendBoosts.js";

/** The weekend boosts' arithmetic: what the web copies to show the same numbers. */
describe("weekendBoosts", () => {
  test("a price 30% less rounds up; 0% or a zero price is unchanged", () => {
    expect(lessByPercent(50_000, 30)).toBe(35_000);
    expect(lessByPercent(34_560, 30)).toBe(24_192);
    expect(lessByPercent(1, 30)).toBe(1);
    expect(lessByPercent(1_000, 0)).toBe(1_000);
    expect(lessByPercent(0, 30)).toBe(0);
  });

  test("loot 30% more rounds down", () => {
    expect(moreByPercent(1_000, 30)).toBe(1_300);
    expect(moreByPercent(7, 30)).toBe(9);
    expect(moreByPercent(0, 30)).toBe(0);
  });

  test("a timer 30% shorter rounds up and never drops below 1 s", () => {
    expect(shorterBy(15, 30)).toBe(11);
    expect(shorterBy(36_000, 30)).toBe(25_200);
    expect(shorterBy(1, 99)).toBe(1);
    expect(shorterBy(600, 0)).toBe(600);
  });

  test("every resource of a cost and of a tribe's loot", () => {
    expect(costLessBy({ r1: 50_000, r2: 37_500, r3: 12_500, r4: 0 }, 30)).toEqual({
      r1: 35_000,
      r2: 26_250,
      r3: 8_750,
      r4: 0,
    });
    expect(withPlunderBonus({ r1: 10_000, r2: 333, r3: 0, r4: 1 }, 30)).toEqual({ r1: 13_000, r2: 432, r3: 0, r4: 1 });
  });
});
