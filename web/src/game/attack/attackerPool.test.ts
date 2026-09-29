import { describe, expect, it } from "vitest";
import { BOMBS } from "@/game/combat/rules";
import { hudResources, poolOf, spendBomb, withLoot } from "./attackerPool";

/** The attacker's pool: what a bomb costs, and what the HUD shows meanwhile (#92). */

const bomb = (id: string) => BOMBS.find((one) => one.id === id)!;

describe("the pool after the save lands (#168)", () => {
  it("adds the banked loot to what the HUD showed, caps and missing figures untouched", () => {
    const shown = { r1: 1_600, r2: 0, r3: 250, r1max: 9_000 };
    expect(withLoot(shown, { r1: 400, r2: 50, r3: 0, r4: 70 })).toEqual({
      r1: 2_000,
      r2: 50,
      r3: 250,
      r1max: 9_000,
    });
    expect(shown.r1).toBe(1_600);
  });
});

describe("the attacker's pool", () => {
  it("reads the three bomb resources, treating junk as 0 and no block as unknown", () => {
    expect(poolOf({ r1: 11_163_050_000, r2: 5, r3: -3, r4: 9 })).toEqual({ r1: 11_163_050_000, r2: 5, r3: 0 });
    expect(poolOf({ r1: Number.NaN })).toEqual({ r1: 0, r2: 0, r3: 0 });
    expect(poolOf(null)).toBeNull();
    expect(poolOf(undefined)).toBeNull();
  });

  it("takes a bomb's cost out of its own resource only, never below zero", () => {
    const pool = { r1: 11_163_050_000, r2: 200_000, r3: 50 };
    const huge = bomb("tw2");
    expect(huge.cost).toBe(5_000_000);
    expect(spendBomb(pool, huge)).toEqual({ r1: 11_158_050_000, r2: 200_000, r3: 50 });
    expect(spendBomb(pool, bomb("pb1"))).toEqual({ r1: 11_163_050_000, r2: 100_000, r3: 50 });
    expect(spendBomb(pool, bomb("pu0"))).toEqual({ ...pool, r3: 0 });
  });

  it("shows the HUD the pool's numbers with goo and the caps as they were read", () => {
    const held = { r1: 1_000, r2: 2_000, r3: 3_000, r4: 4_000, r1max: 9_000 };
    const after = spendBomb(poolOf(held)!, bomb("tw0"));
    expect(hudResources(held, after)).toEqual({ r1: 0, r2: 2_000, r3: 3_000, r4: 4_000, r1max: 9_000 });
    // The block it was read from is left alone.
    expect(held.r1).toBe(1_000);
  });
});
