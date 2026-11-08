import { describe, expect, test } from "bun:test";
import { TRIBE_GOO_BONUS_PERCENT, withTribeGooBonus } from "./tribeGooBonus.js";

describe("withTribeGooBonus", () => {
  test("is 25%", () => {
    expect(TRIBE_GOO_BONUS_PERCENT).toBe(25);
  });

  test("adds 25% Goo from a tribe and leaves the other resources alone", () => {
    expect(withTribeGooBonus({ r1: 1000, r2: 500, r3: 200, r4: 1000 }, true)).toEqual({ r1: 1000, r2: 500, r3: 200, r4: 1250 });
  });

  test("rounds down", () => {
    expect(withTribeGooBonus({ r1: 0, r2: 0, r3: 0, r4: 3 }, true).r4).toBe(3);
    expect(withTribeGooBonus({ r1: 0, r2: 0, r3: 0, r4: 7 }, true).r4).toBe(8);
  });

  test("changes nothing for a player's yard", () => {
    const credit = { r1: 10, r2: 10, r3: 10, r4: 1000 };
    expect(withTribeGooBonus(credit, false)).toBe(credit);
  });

  test("changes nothing when there is no Goo", () => {
    const credit = { r1: 10, r2: 10, r3: 10, r4: 0 };
    expect(withTribeGooBonus(credit, true)).toBe(credit);
  });
});
