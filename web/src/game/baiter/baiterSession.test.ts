import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import {
  BAITER_DIRECTIONS,
  BAITER_ROSTER,
  attackSize,
  baiterTarget,
  budgetOf,
  clampPicks,
  consumeBaiterRun,
  costOf,
  directionsOf,
  levelsFor,
  maxOf,
  setBaiterRun,
  spawnPointOf,
} from "./baiterSession";

/**
 * The Baiter's levels, directions, budget and roster as Flash had them
 * (`docs/design/yard-buildings.md` §8.1, issue #126), and the target the
 * practice attack hands the attack scene.
 */

const save = {
  error: 0,
  baseid: "3510",
  buildingdata: {},
  academy: { C1: { level: 6 }, C4: { level: 3 } },
  resources: { r1: 10, r2: 0, r3: 0, r4: 0 },
} as unknown as BaseLoadResponse;

describe("the Baiter's levels", () => {
  it("sizes the attack by level, 600 to 4,800 housing space (YARD_PROPS.as:1962)", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(budgetOf)).toEqual([600, 900, 1_200, 1_500, 2_100, 3_200, 4_800]);
    expect(budgetOf(0)).toBe(600);
    expect(budgetOf(9)).toBe(4_800);
  });

  it("offers the four corners below level 3 and all eight directions from it", () => {
    expect(directionsOf(2).map((one) => one.id)).toEqual(["tl", "tr", "br", "bl"]);
    expect(directionsOf(3).map((one) => one.id)).toEqual(["tl", "tr", "br", "bl", "t", "r", "b", "l"]);
  });

  it("brings the attack in 1,000 yard units out at Flash's angles", () => {
    const at = (id: string) => spawnPointOf(BAITER_DIRECTIONS.find((one) => one.id === id)!);
    expect(at("br")).toEqual({ x: 1000, y: 0 });
    expect(at("bl")).toEqual({ x: 0, y: 1000 });
    expect(at("tl")).toEqual({ x: -1000, y: 0 });
    expect(at("tr")).toEqual({ x: 0, y: -1000 });
    expect(at("b")).toEqual({ x: 707, y: 707 });
  });

  it("is always C1 to C14", () => {
    expect(BAITER_ROSTER).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13", "C14"]);
  });
});

describe("the attack size", () => {
  it("costs each monster its housing space at the chosen levels (Q5)", () => {
    // Pokeys take 10 at level 1 and 7 at level 6.
    expect(costOf("C1", levelsFor("wild", save))).toBe(10);
    expect(costOf("C1", levelsFor("academy", save))).toBe(7);
    expect(attackSize({ C1: 30 }, {})).toBe(300);
  });

  it("fits what is picked into the budget", () => {
    expect(maxOf("C1", {}, 600, {})).toBe(60);
    expect(maxOf("C1", { C1: 50 }, 600, {})).toBe(60);
    expect(maxOf("C1", { C2: 55 }, 600, {})).toBeLessThan(60);
    // A switch that makes monsters bigger cuts the army back, roster order kept.
    expect(clampPicks({ C1: 80, C2: 5 }, 600, { C1: 1 })).toEqual({ C1: 60 });
  });
});

describe("the practice attack's target", () => {
  it("is the own yard already loaded, the picked army, and nothing else", () => {
    const run = {
      save,
      picks: { C1: 20, C4: 3 },
      direction: BAITER_DIRECTIONS[0]!,
      levels: "academy" as const,
      baiterLevel: 4,
    };
    const target = baiterTarget(run);
    // The scene fights on this load and asks the server for none.
    expect(target.load).toBe(save);
    expect(target.roster).toEqual({
      monsters: { C1: 20, C4: 3 },
      levels: { C1: 6, C4: 3 },
      champions: [],
      flingerLevel: 0,
      catapultLevel: 0,
      sources: [],
      siege: null,
      resources: null,
    });
    expect(baiterTarget({ ...run, levels: "wild" }).roster.levels).toEqual({});
  });

  it("is handed over once", () => {
    const run = { save, picks: { C1: 1 }, direction: BAITER_DIRECTIONS[0]!, levels: "wild" as const, baiterLevel: 1 };
    setBaiterRun(run);
    expect(consumeBaiterRun()).toBe(run);
    expect(consumeBaiterRun()).toBeNull();
  });
});
