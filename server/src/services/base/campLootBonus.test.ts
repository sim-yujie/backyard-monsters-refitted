import { describe, expect, test } from "bun:test";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { CAMP_LOOT_BONUS_PERCENT, isMR2Camp, withCampLootBonus } from "./campLootBonus.js";
import { withTribeGooBonus } from "./tribeGooBonus.js";

describe("withCampLootBonus", () => {
  test("is 15%", () => {
    expect(CAMP_LOOT_BONUS_PERCENT).toBe(15);
  });

  test("adds 15% to all four resources from a Map Room 2 camp", () => {
    expect(withCampLootBonus({ r1: 1000, r2: 2000, r3: 400, r4: 100 }, true)).toEqual({
      r1: 1150,
      r2: 2300,
      r3: 460,
      r4: 115,
    });
  });

  test("rounds down", () => {
    expect(withCampLootBonus({ r1: 7, r2: 3, r3: 1, r4: 13 }, true)).toEqual({ r1: 8, r2: 3, r3: 1, r4: 14 });
  });

  test("leaves zero and missing amounts alone", () => {
    expect(withCampLootBonus({ r1: 0, r2: 100 }, true)).toEqual({ r1: 0, r2: 115 });
    const nothing = { r1: 0, r2: 0, r3: 0, r4: 0 };
    expect(withCampLootBonus(nothing, true)).toBe(nothing);
  });

  test("changes nothing when the attack is not on a Map Room 2 camp", () => {
    const credit = { r1: 1000, r2: 1000, r3: 1000, r4: 1000 };
    expect(withCampLootBonus(credit, false)).toBe(credit);
  });

  test("Goo gets both bonuses: x1.25 then x1.15", () => {
    const credit = { r1: 1_000_000, r2: 1_000_000, r3: 1_000_000, r4: 1_000_000 };
    expect(withCampLootBonus(withTribeGooBonus(credit, true), true)).toEqual({
      r1: 1_150_000,
      r2: 1_150_000,
      r3: 1_150_000,
      r4: 1_437_500,
    });
  });
});

describe("isMR2Camp", () => {
  test("a wild monster camp attacked from Map Room 2", () => {
    expect(isMR2Camp(BaseType.TRIBE, MapRoomVersion.V2)).toBe(true);
  });

  test("not Map Room 1 or Map Room 3 tribes", () => {
    expect(isMR2Camp(BaseType.TRIBE, MapRoomVersion.V1)).toBe(false);
    expect(isMR2Camp(BaseType.TRIBE, MapRoomVersion.V3)).toBe(false);
  });

  test("not players' yards, outposts or the Inferno", () => {
    for (const type of [BaseType.MAIN, BaseType.OUTPOST, BaseType.INFERNO, BaseType.INFERNO_TRIBE]) {
      expect(isMR2Camp(type, MapRoomVersion.V2)).toBe(false);
    }
    expect(isMR2Camp(undefined, MapRoomVersion.V2)).toBe(false);
  });
});
