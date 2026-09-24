import { describe, expect, it } from "vitest";
import {
  amountsOf,
  COMBAT_TOLERANCES,
  listed,
  MAX_LISTED,
  noAmounts,
  numberOf,
  RESOURCE_KEYS,
  toCombatYard,
} from "./types";

/**
 * The readers the two trees build a context with.
 *
 * Small, but each one stands between a save that arrived as JSON from a client
 * this server cannot patch and arithmetic that decides whether to refuse it.
 * The case that matters is the one where the value is not a number: a `NaN` in
 * a bound compares false against every check and waves the save through, which
 * is the opposite of what an audit is for.
 */

describe("numberOf", () => {
  it("reads a number however the client spelled it", () => {
    expect(numberOf(42)).toBe(42);
    expect(numberOf("42")).toBe(42);
    expect(numberOf(-3.5)).toBe(-3.5);
  });

  it("reads anything unusable as 0 rather than NaN", () => {
    expect(numberOf(undefined)).toBe(0);
    expect(numberOf(null)).toBe(0);
    expect(numberOf("nope")).toBe(0);
    expect(numberOf({})).toBe(0);
    expect(numberOf(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("amountsOf", () => {
  it("reads r1 to r4 and nothing else", () => {
    expect(amountsOf({ r1: 5, r2: "6", r5: 7, r1max: 99 })).toEqual({
      r1: 5,
      r2: 6,
      r3: 0,
      r4: 0,
    });
  });

  it("reads an absent blob as zero of each", () => {
    expect(amountsOf(undefined)).toEqual(noAmounts());
    expect(amountsOf(null)).toEqual(noAmounts());
    expect(RESOURCE_KEYS).toEqual(["r1", "r2", "r3", "r4"]);
  });
});

describe("listed", () => {
  it("sorts, so two runs over the same save read alike", () => {
    expect(listed([30, 4, 11])).toEqual([4, 11, 30]);
  });

  it("stops at MAX_LISTED, because a forged save can name a whole yard", () => {
    const ids = Array.from({ length: 100 }, (_, index) => index);
    expect(listed(ids)).toHaveLength(MAX_LISTED);
    expect(listed(ids)[0]).toBe(0);
  });
});

describe("the tolerances", () => {
  it("carries the figures the plan fixed (§3.6)", () => {
    expect(COMBAT_TOLERANCES).toEqual({
      damageSlackMin: 1000,
      damageSlackFraction: 0.01,
      lootGainRatio: 1.6,
      lootMultMax: 5,
      vacuumLootSlack: 2,
      damageTolerance: 1,
    });
  });
});

describe("toCombatYard", () => {
  it("survives a buildingdata entry that is not an object", () => {
    const yard = toCombatYard({
      buildingdata: {
        "1": null as unknown as Record<string, unknown>,
        "2": { id: 2, t: 20 },
      },
    });
    expect(yard.buildings.map((one) => one.id)).toEqual([2]);
  });

  it("falls back to the map key when the entry carries no id", () => {
    const yard = toCombatYard({ buildingdata: { "7": { t: 20 } } });
    expect(yard.byId.get(7)?.type).toBe(20);
  });

  it("reads a level 0 building, which is still under its initial build", () => {
    // `cB` counting down means level 0 (`BFOUNDATION.as:3043-3048`).
    const yard = toCombatYard({ buildingdata: { "1": { id: 1, t: 20, l: 0, cB: 90 } } });
    expect(yard.byId.get(1)?.level).toBe(0);
  });

  it("holds nothing for an absent buildingdata", () => {
    const yard = toCombatYard({});
    expect(yard.buildings).toEqual([]);
    expect(yard.kind).toBe("main");
  });

  it("marks the ids the caller resolved as spent", () => {
    const yard = toCombatYard({
      buildingdata: { "1": { id: 1, t: 24 }, "2": { id: 2, t: 24 } },
      spent: [2],
    });
    expect(yard.byId.get(1)?.spent).toBe(false);
    expect(yard.byId.get(2)?.spent).toBe(true);
  });

  it("gives a type with no health ladder no health at all", () => {
    // Three of the 140 props entries carry no `hp`; none is targetable.
    const yard = toCombatYard({ buildingdata: { "1": { id: 1, t: 130 } } });
    expect(yard.byId.get(1)?.maxHp).toBe(0);
    expect(yard.byId.get(1)?.hp).toBe(0);
  });
});
