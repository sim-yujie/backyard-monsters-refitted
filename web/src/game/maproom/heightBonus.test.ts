import { describe, expect, it } from "vitest";
import { heightBonus } from "./heightBonus";

describe("heightBonus", () => {
  it("makes a hill reach farther and pay less, as the tower and income rules do", () => {
    expect(heightBonus(150)).toEqual({ metres: 50, towerPct: 20, incomePct: -17 });
    expect(heightBonus(250)).toMatchObject({ towerPct: 100, incomePct: -50 });
  });

  it("makes low ground pay more, and leaves a tower below 100 as it is", () => {
    expect(heightBonus(100)).toEqual({ metres: 0, towerPct: -20, incomePct: 25 });
    expect(heightBonus(80)).toMatchObject({ towerPct: 0, incomePct: 56 });
  });

  it("reads a cell with no height as 100 for income", () => {
    expect(heightBonus(0).incomePct).toBe(25);
  });
});
