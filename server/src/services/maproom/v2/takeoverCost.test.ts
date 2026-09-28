import { describe, expect, test } from "bun:test";
import { isAdjacentToMainYard, takeoverResourceCost, takeoverShinyCost } from "./takeoverCost.js";

/** PopupTakeover.as:50-80, worked by hand for the figures below. */

const base = { isWildMonster: false, level: 0, empireValue: 0, adjacentToMainYard: false, conquestActive: false };
const camp = (level: number, over = {}) => takeoverResourceCost({ ...base, isWildMonster: true, level, ...over });
const outpost = (empireValue: number) => takeoverResourceCost({ ...base, empireValue });

describe("takeoverResourceCost", () => {
  test("a wild camp: (level x 562,500 - 14,750,000) to the nearest 250,000, at least 1,000,000", () => {
    expect(camp(10)).toBe(1_000_000);
    // 2,125,000 is 8.5 steps, which rounds up.
    expect(camp(30)).toBe(2_250_000);
    expect(camp(50)).toBe(13_500_000);
  });

  test("a player outpost: from ln(empire value), floored at 1,000,000 and capped at 65,000,000", () => {
    expect(outpost(0)).toBe(1_000_000);
    expect(outpost(1_000_000)).toBe(1_000_000);
    expect(outpost(10_000_000)).toBe(28_000_000);
    expect(outpost(30_000_000)).toBe(45_250_000);
    expect(outpost(100_000_000)).toBe(64_250_000);
    expect(outpost(1e12)).toBe(65_000_000);
  });

  test("half next to the main yard, a quarter off with Conquest, both together", () => {
    expect(camp(50, { adjacentToMainYard: true })).toBe(6_750_000);
    expect(camp(50, { conquestActive: true })).toBe(10_125_000);
    expect(camp(50, { adjacentToMainYard: true, conquestActive: true })).toBe(5_062_500);
  });
});

describe("takeoverShinyCost", () => {
  test("ceil(sqrt(cost / 2) ^ 0.75 x 4)", () => {
    expect(takeoverShinyCost(1_000_000)).toBe(549);
    expect(takeoverShinyCost(13_500_000)).toBe(1456);
    expect(takeoverShinyCost(65_000_000)).toBe(2625);
  });
});

describe("isAdjacentToMainYard", () => {
  test("the six neighbours of an odd column", () => {
    for (const [x, y] of [[241, 206], [241, 208], [240, 207], [240, 208], [242, 207], [242, 208]])
      expect(isAdjacentToMainYard(241, 207, x!, y!)).toBe(true);
    for (const [x, y] of [[241, 207], [240, 206], [242, 206], [241, 209], [243, 207]])
      expect(isAdjacentToMainYard(241, 207, x!, y!)).toBe(false);
  });

  test("the six neighbours of an even column", () => {
    for (const [x, y] of [[240, 206], [240, 208], [239, 206], [239, 207], [241, 206], [241, 207]])
      expect(isAdjacentToMainYard(240, 207, x!, y!)).toBe(true);
    for (const [x, y] of [[239, 208], [241, 208]]) expect(isAdjacentToMainYard(240, 207, x!, y!)).toBe(false);
  });
});
