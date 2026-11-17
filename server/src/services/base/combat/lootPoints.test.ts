import { describe, expect, test } from "bun:test";
import { awardLootPoints, lootPoints } from "./lootPoints.js";

describe("points for attack loot (patch 7.7.2, `BASE.as:1785-1801`)", () => {
  test("one point per resource taken, all four counted", () => {
    expect(lootPoints({ r1: 1_000, r2: 250, r3: 40, r4: 7 })).toBe(1_297);
  });

  test("nothing, a missing resource, 0 or less, or junk counts nothing", () => {
    expect(lootPoints(null)).toBe(0);
    expect(lootPoints(undefined)).toBe(0);
    expect(lootPoints({})).toBe(0);
    expect(lootPoints({ r1: 0, r2: -500, r3: Number.NaN, r4: Number.POSITIVE_INFINITY })).toBe(0);
    expect(lootPoints({ r1: 300, r2: -500 })).toBe(300);
  });

  test("a part resource counts whole, as `PointsAdd(uint)` took it", () => {
    expect(lootPoints({ r1: 10.9, r2: 0.5 })).toBe(10);
  });

  test("adds to the row's points, kept as the string column holds them", () => {
    const save = { points: "12345" };
    expect(awardLootPoints(save, { r1: 600, r4: 55 })).toBe(655);
    expect(save.points).toBe("13000");
  });

  test("a row with no points yet starts from 0", () => {
    const save: { points?: string | null } = { points: null };
    awardLootPoints(save, { r2: 90 });
    expect(save.points).toBe("90");
  });

  test("nothing looted leaves the row alone", () => {
    const save = { points: "500" };
    expect(awardLootPoints(save, { r1: 0, r2: 0, r3: 0, r4: 0 })).toBe(0);
    expect(save.points).toBe("500");
  });
});
