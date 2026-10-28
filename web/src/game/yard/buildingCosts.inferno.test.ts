import { describe, expect, it } from "vitest";
import { INFERNO_BUILDABLE_TYPES } from "./buildingCostData";
import {
  costOf,
  fortifyStepsOf,
  hallTypeOf,
  infernoTraitsOf,
  maxLevel,
  nameOf,
  quantityOf,
  UNDER_HALL_TYPE,
} from "./buildingCosts";

/**
 * The Inferno props table as the client reads it. Mirrors
 * `server/src/game-data/buildingCosts.inferno.test.ts`: the two copies hold the
 * same rows, so the price shown is the price charged.
 */
describe("the Inferno cost table", () => {
  it("offers design §2.5's sixteen buildings", () => {
    expect([...INFERNO_BUILDABLE_TYPES]).toEqual([
      1, 2, 3, 4, 6, 8, 9, 13, 17, 21, 24, 26, 128, 129, 130, 132,
    ]);
  });

  it("reads caps at the Under Hall's level", () => {
    expect(hallTypeOf("inferno")).toBe(UNDER_HALL_TYPE);
    expect(nameOf(14, "inferno")).toBe("Under Hall");
    expect(quantityOf(129, 2, "inferno")).toBe(0);
    expect(quantityOf(129, 3, "inferno")).toBe(2);
    expect(quantityOf(17, 6, "inferno")).toBe(220);
    expect(maxLevel(14, "inferno")).toBe(6);
  });

  it("charges Flash's prices", () => {
    expect(costOf(14, 1, "inferno")?.slice(0, 5)).toEqual([7000, 7000, 0, 0, 600]);
    expect(costOf(9, 0, "inferno")?.slice(0, 5)).toEqual([1000000, 1000000, 1000000, 0, 43200]);
  });

  it("carries the Housing Bunker's room and no fortify ladders", () => {
    expect(infernoTraitsOf(128)?.[4]).toEqual([200, 300, 520, 780, 1140, 1820]);
    expect(fortifyStepsOf(21, "inferno")).toEqual([]);
    expect(fortifyStepsOf(21, "main").length).toBeGreaterThan(0);
  });
});
