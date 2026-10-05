import { describe, expect, test } from "bun:test";
import { Tribe } from "../../enums/Tribes.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { buildEngineYard, type EngineBuilding } from "../../game-rules/combat/yard.js";
import type { CombatBuildingDataMap } from "../../game-rules/combat/types.js";
import {
  RAID_ENTRY_POINTS,
  chooseRaidDirection,
  pickRaidSolution,
  raidEntryPoint,
  raidSolutions,
  type RaidSolution,
} from "./raidDirection.js";

/**
 * A Town Hall in the middle, a harvester 400 east and one 400 west, and three
 * cannons guarding the east one. Loot tribes come in on the west, where no
 * tower reaches; on Flash's broken check (only towers mid-fortify counted)
 * east and west would have tied at no fire.
 */
const GUARDED_EAST: CombatBuildingDataMap = {
  "1": { id: 1, t: 14, X: 0, Y: 0, l: 1 },
  "2": { id: 2, t: 1, X: 400, Y: 0, l: 1, st: 500 },
  "3": { id: 3, t: 1, X: -400, Y: 0, l: 1, st: 500 },
  "4": { id: 4, t: 20, X: 500, Y: 100, l: 1 },
  "5": { id: 5, t: 20, X: 500, Y: -100, l: 1 },
  "6": { id: 6, t: 20, X: 600, Y: 0, l: 1 },
};

const yardOf = (buildingdata: CombatBuildingDataMap, r1 = 0) =>
  buildEngineYard({ buildingdata, resources: { r1 }, kind: "main" });

const solution = (overrides: Partial<RaidSolution> & { bearing: number }): RaidSolution => ({
  entry: raidEntryPoint(overrides.bearing),
  target: { id: 1 } as EngineBuilding,
  distanceToTarget: 10,
  damageTaken: 0,
  resourcesGained: 0,
  ...overrides,
});

describe("raidEntryPoint", () => {
  test("16 ways in, 22.5 degrees apart, 800 out", () => {
    expect(RAID_ENTRY_POINTS).toBe(16);
    expect(raidEntryPoint(0).x).toBeCloseTo(800, 6);
    expect(raidEntryPoint(0).y).toBeCloseTo(0, 6);
    expect(raidEntryPoint(90).x).toBeCloseTo(0, 4);
    expect(raidEntryPoint(90).y).toBeCloseTo(800, 4);
  });
});

describe("raidSolutions", () => {
  test("scores every way in, with every tower counted", () => {
    const solutions = raidSolutions(Tribe.KOZU, yardOf(GUARDED_EAST), mulberry32(1));
    expect(solutions.map((one) => one.bearing)).toEqual(Array.from({ length: 16 }, (_, index) => index * 22.5));
    const east = solutions.find((one) => one.bearing === 0);
    const west = solutions.find((one) => one.bearing === 180);
    expect(east?.target.id).toBe(2);
    expect(west?.target.id).toBe(3);
    expect(east?.damageTaken).toBeGreaterThan(0);
    expect(west?.damageTaken).toBe(0);
    expect(west?.distanceToTarget).toBeGreaterThan(0);
  });

  test("Legionnaire heads for the tower nearest the way in", () => {
    const solutions = raidSolutions(Tribe.LEGIONNAIRE, yardOf(GUARDED_EAST), mulberry32(1));
    expect(solutions.find((one) => one.bearing === 0)?.target.id).toBe(6);
    // From the west, cannons 4 and 5 are equally near; the lower id wins.
    expect(solutions.find((one) => one.bearing === 180)?.target.id).toBe(4);
    // Every route ends in range of the tower it heads for.
    for (const one of solutions) expect(one.damageTaken).toBeGreaterThan(0);
  });

  test("Legionnaire with no tower standing goes for loot instead", () => {
    const unguarded = { "1": GUARDED_EAST["1"], "2": GUARDED_EAST["2"], "3": GUARDED_EAST["3"] } as CombatBuildingDataMap;
    const solutions = raidSolutions(Tribe.LEGIONNAIRE, yardOf(unguarded), mulberry32(1));
    expect(solutions.find((one) => one.bearing === 0)?.target.id).toBe(2);
  });

  test("a silo or Town Hall is worth 4% of the twigs bank, a harvester 10% of its buffer, at most 10,000", () => {
    const north = (solutions: RaidSolution[]) => solutions.find((one) => one.bearing === 90);
    expect(north(raidSolutions(Tribe.ABUNAKKI, yardOf(GUARDED_EAST, 50000), mulberry32(1)))?.target.id).toBe(1);
    expect(north(raidSolutions(Tribe.ABUNAKKI, yardOf(GUARDED_EAST, 50000), mulberry32(1)))?.resourcesGained).toBe(2000);
    expect(north(raidSolutions(Tribe.ABUNAKKI, yardOf(GUARDED_EAST, 900000), mulberry32(1)))?.resourcesGained).toBe(10000);
    const east = raidSolutions(Tribe.ABUNAKKI, yardOf(GUARDED_EAST), mulberry32(1)).find((one) => one.bearing === 0);
    expect(east?.resourcesGained).toBe(50);
  });

  test("an empty yard has no way in", () => {
    expect(raidSolutions(Tribe.KOZU, yardOf({}), mulberry32(1))).toEqual([]);
    expect(chooseRaidDirection(Tribe.KOZU, yardOf({}), mulberry32(1))).toBeNull();
  });
});

describe("pickRaidSolution", () => {
  test("the least fire, then the shortest route", () => {
    const picked = pickRaidSolution(Tribe.KOZU, [
      solution({ bearing: 0, damageTaken: 5, distanceToTarget: 1 }),
      solution({ bearing: 22.5, damageTaken: 0, distanceToTarget: 30 }),
      solution({ bearing: 45, damageTaken: 0, distanceToTarget: 20 }),
      solution({ bearing: 67.5, damageTaken: 0, distanceToTarget: 25 }),
    ]);
    expect(picked?.bearing).toBe(45);
  });

  test("a full tie goes to the later bearing", () => {
    const picked = pickRaidSolution(Tribe.KOZU, [solution({ bearing: 0 }), solution({ bearing: 22.5 })]);
    expect(picked?.bearing).toBe(22.5);
  });

  test("Abunakki breaks a tie on the richest target; the others ignore what it is worth", () => {
    const tied = [solution({ bearing: 0, resourcesGained: 900 }), solution({ bearing: 22.5, resourcesGained: 100 })];
    expect(pickRaidSolution(Tribe.ABUNAKKI, tied)?.bearing).toBe(0);
    expect(pickRaidSolution(Tribe.DREADNAUT, tied)?.bearing).toBe(22.5);
  });

  test("nothing to pick from", () => {
    expect(pickRaidSolution(Tribe.KOZU, [])).toBeNull();
  });
});

describe("chooseRaidDirection", () => {
  test("loot tribes come in where no tower reaches, the shortest such way", () => {
    for (const tribe of [Tribe.KOZU, Tribe.ABUNAKKI, Tribe.DREADNAUT]) {
      const solutions = raidSolutions(tribe, yardOf(GUARDED_EAST), mulberry32(3));
      const chosen = chooseRaidDirection(tribe, yardOf(GUARDED_EAST), mulberry32(3));
      const quiet = solutions.filter((one) => one.damageTaken === 0);
      expect(chosen?.damageTaken).toBe(0);
      expect(chosen?.distanceToTarget).toBe(Math.min(...quiet.map((one) => one.distanceToTarget)));
      expect(chosen?.target.id).toBe(3);
    }
  });

  test("Legionnaire takes the way in with the least fire", () => {
    const solutions = raidSolutions(Tribe.LEGIONNAIRE, yardOf(GUARDED_EAST), mulberry32(3));
    const chosen = chooseRaidDirection(Tribe.LEGIONNAIRE, yardOf(GUARDED_EAST), mulberry32(3));
    expect(chosen?.damageTaken).toBe(Math.min(...solutions.map((one) => one.damageTaken)));
  });

  test("the same seed gives the same choice", () => {
    const one = chooseRaidDirection(Tribe.KOZU, yardOf(GUARDED_EAST), mulberry32(9));
    const two = chooseRaidDirection(Tribe.KOZU, yardOf(GUARDED_EAST), mulberry32(9));
    expect(two).toEqual(one);
  });
});
