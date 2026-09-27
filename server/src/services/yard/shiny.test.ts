import { describe, expect, test } from "bun:test";
import {
  championHealPrice,
  finishNowPrice,
  hatcheryFinishPrice,
  instantBuildPrice,
  instantResearchPrice,
  instantTrainPrice,
  instantUnlockPrice,
  instantUpgradePrice,
  repairAllPrice,
  speedupAllowed,
  speedupPrice,
  storeItemPrice,
  timeCost,
  topupPrice,
} from "./shiny.js";

/**
 * Every figure below is worked by hand from the original formulas, not read
 * back from the code: `min(ceil(t × 20 / 3600), int(sqrt(t × 0.8)))` for time
 * (`client/scripts/STORE.as:162-171`) and `ceil(sqrt(r / 2)^0.75)` for
 * resources (`:183-185`).
 */

describe("timeCost", () => {
  test.each([
    // [seconds, price, why]
    [0, 0, "nothing to skip"],
    [300, 0, "five minutes or less is free"],
    [301, 2, "ceil(1.67) = 2 against int(sqrt(240.8)) = 15"],
    [1800, 10, "ceil(10) against int(37.9)"],
    [3600, 20, "20 an hour"],
    [7200, 40, "ceil(40) against int(75.9)"],
    [25920, 144, "the crossing: 144 both ways (7.2 h)"],
    [43200, 185, "int(sqrt(34560)) = 185 against 240"],
    [86400, 262, "24 h: int(sqrt(69120)) = 262 against 480"],
    [172800, 371, "48 h: int(sqrt(138240)) = 371 against 960"],
  ])("%p s costs %p (%s)", (seconds, price) => {
    expect(timeCost(seconds)).toBe(price);
    expect(finishNowPrice(seconds)).toBe(price);
  });

  test("without the free five minutes, 300 s costs 2 and 0 s costs 0", () => {
    expect(timeCost(300, false)).toBe(2);
    expect(timeCost(10, false)).toBe(1); // min(ceil(0.06), int(sqrt(8)))
    expect(timeCost(1, false)).toBe(0); // int(sqrt(0.8)) = 0
    expect(timeCost(0, false)).toBe(0);
    expect(timeCost(86400, false)).toBe(262);
  });

  test("fractions truncate like the original int parameter; nonsense costs nothing", () => {
    expect(timeCost(301.9)).toBe(2);
    expect(timeCost(-50, false)).toBe(0);
    expect(timeCost(Number.NaN, false)).toBe(0);
  });
});

describe("instant upgrade and build", () => {
  test("Town Hall 1 to 2: (ceil(sqrt(7000)^0.75) = 28 + timeCost(600) = 4) × 0.95 = 30", () => {
    expect(instantUpgradePrice(14, 1)).toBe(30);
  });

  test("Cannon Tower 1 to 2: (ceil(100^0.75) = 32 + timeCost(900) = 5) × 0.95 = 35", () => {
    expect(instantUpgradePrice(20, 1)).toBe(35);
  });

  test("Twig Snapper 1 to 2: the 300 s step's time is free, 13 × 0.95 = 12", () => {
    expect(instantUpgradePrice(1, 1)).toBe(12);
  });

  test("Twig Snapper build: ceil(sqrt(375)^0.75) = 10, × 0.95 = 9", () => {
    expect(instantBuildPrice(1)).toBe(9);
  });

  test("past the top of the ladder, or an unknown type, prices 0", () => {
    expect(instantUpgradePrice(14, 99)).toBe(0);
    expect(instantUpgradePrice(99999, 1)).toBe(0);
  });
});

describe("monster and repair prices", () => {
  test("unlock and train: timeCost(t) + ceil(sqrt(putty / 2)^0.75)", () => {
    expect(instantUnlockPrice(3600, 20000)).toBe(20 + 32);
    expect(instantTrainPrice(300, 20000)).toBe(0 + 32);
  });

  test("research: the time term has no free five minutes", () => {
    expect(instantResearchPrice(200, 0)).toBe(2);
    expect(instantResearchPrice(3600, 20000)).toBe(52);
  });

  test("hatchery finish: timeCost(total, false) × 4", () => {
    expect(hatcheryFinishPrice(300)).toBe(8);
    expect(hatcheryFinishPrice(3600)).toBe(80);
  });

  test("repair all: repairs over 300 s summed and counted, 10 each", () => {
    // 400 + 3600 = 4000 s → min(23, 56) = 23; two of them → +20.
    expect(repairAllPrice([100, 400, 3600])).toBe(43);
    expect(repairAllPrice([100, 300])).toBe(0);
    expect(repairAllPrice([])).toBe(0);
  });

  test("champion heal: timeCost(missing / max × healtime, false)", () => {
    expect(championHealPrice(50, 100, 7200)).toBe(20);
    expect(championHealPrice(0, 100, 7200)).toBe(0);
    expect(championHealPrice(10, 0, 7200)).toBe(0);
  });

  test("topup: the four shortfalls summed, then the resource curve", () => {
    expect(topupPrice({ r1: 5000, r2: 5000, r3: 0, r4: 10000 })).toBe(32);
  });
});

describe("speed-ups", () => {
  test.each([
    // [item, remaining, allowed]
    ["SP1", 300, true],
    ["SP1", 301, false],
    ["SP1", 1, true],
    ["SP2", 3599, false],
    ["SP2", 3600, true],
    ["SP3", 7199, false],
    ["SP3", 7200, true],
    ["SP4", 300, false],
    ["SP4", 301, true],
    ["SP4", 0, false],
    ["SP1", 0, false],
  ] as const)("%s at %p s left: %p", (item, remaining, allowed) => {
    expect(speedupAllowed(item, remaining)).toBe(allowed);
  });

  test("prices: SP1 free, SP2 20, SP3 40, SP4 timeCost(remaining)", () => {
    expect(speedupPrice("SP1", 200)).toBe(0);
    expect(speedupPrice("SP2", 90000)).toBe(20);
    expect(speedupPrice("SP3", 90000)).toBe(40);
    expect(speedupPrice("SP4", 86400)).toBe(262);
    expect(speedupPrice("SP4", 3600)).toBe(20);
  });
});

describe("storeItemPrice", () => {
  test("BEW climbs 250 / 500 / 1,000 / 2,000, then is sold out", () => {
    expect([0, 1, 2, 3, 4].map((owned) => storeItemPrice("BEW", owned))).toEqual([
      250,
      500,
      1000,
      2000,
      undefined,
    ]);
  });

  test("BST is 225; unknown codes and prototype keys have no price", () => {
    expect(storeItemPrice("BST", 0)).toBe(225);
    expect(storeItemPrice("NOPE", 0)).toBeUndefined();
    expect(storeItemPrice("toString", 0)).toBeUndefined();
  });
});
