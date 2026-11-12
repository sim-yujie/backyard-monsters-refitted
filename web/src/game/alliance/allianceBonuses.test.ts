import { describe, expect, it } from "vitest";
import {
  allianceBonusesOf,
  byPercent,
  currentAllianceBonuses,
  NO_BONUSES,
  productionFactorOf,
  setCurrentAllianceBonuses,
} from "./allianceBonuses";
import { kitsAtPrice, STARTER_KIT_SUMMARIES } from "@/game/yard/starterKits";

describe("alliance bonuses on the web", () => {
  it("reads alliancedata.bonuses, zeros when absent or malformed", () => {
    expect(allianceBonusesOf(undefined)).toEqual(NO_BONUSES);
    expect(allianceBonusesOf({ bonuses: "x" })).toEqual(NO_BONUSES);
    expect(allianceBonusesOf({ bonuses: { production: 15, kitCost: "bad" } })).toMatchObject({
      production: 15,
      kitCost: 0,
    });
  });

  it("production factor and percent rounding match the server", () => {
    expect(productionFactorOf({ bonuses: { production: 15 } })).toBeCloseTo(1.15);
    expect(productionFactorOf(null)).toBe(1);
    expect(byPercent(1000, -20)).toBe(800);
    expect(byPercent(0, 50)).toBe(0);
  });

  it("Starter Kits: the resource price follows kitCost, the Shiny price never", () => {
    setCurrentAllianceBonuses({ bonuses: { kitCost: -10 } });
    expect(currentAllianceBonuses().kitCost).toBe(-10);
    const [first] = kitsAtPrice();
    const [listed] = STARTER_KIT_SUMMARIES;
    expect(first!.resources.r1).toBe(Math.round(listed!.resources.r1 * 0.9));
    expect(first!.shiny).toBe(listed!.shiny);
    setCurrentAllianceBonuses(undefined);
    expect(kitsAtPrice()).toBe(STARTER_KIT_SUMMARIES);
  });
});
