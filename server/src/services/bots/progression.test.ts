import { describe, expect, test } from "bun:test";
import { costOf } from "../../game-data/buildingCosts.js";
import { experiencePoints } from "../../game-data/stats/experiencePoints.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { baseValueOf } from "../base/economy/resourceBudget.js";
import { calculateBaseLevel } from "../base/calculateBaseLevel.js";
import { STARTER_BUILDINGS } from "../yard/starterBase.js";
import { pointsForBuild, pointsForUpgrade, requirementsMet, TOWN_HALL_TYPE } from "../yardplanner/costs.js";
import {
  levelBand,
  levelOfTotal,
  MAP_ROOM_TYPE,
  PERSONAS,
  Progression,
  targetInBand,
  yardAtPoints,
  type ProgressionBuilding,
  type ProgressionYard,
} from "./progression.js";

/** The bot progression (issue #237, `docs/design/bot-neighbours.md` §4.2). */

const SEEDS = 20;
const LEVELS = 40;

const buildingDataOf = (buildings: readonly ProgressionBuilding[]): BuildingDataMap =>
  Object.fromEntries(
    buildings.map((building) => [String(building.id), { id: building.id, t: building.t, l: building.l }])
  ) as unknown as BuildingDataMap;

/** `quantity[hall]`, the last entry for any hall past the end. */
const allowed = (type: number, hall: number): number => {
  const quantity = costOf(type)!.quantity;
  return quantity[Math.min(hall, quantity.length - 1)] ?? 0;
};

/** Points a yard earned from the starter base, worked out from its buildings alone. */
const pointsOf = (buildings: readonly ProgressionBuilding[]): number => {
  const starters = new Set(STARTER_BUILDINGS.map((_, index) => index + 1));
  let points = 0;
  for (const building of buildings) {
    const costs = costOf(building.t)!.costs;
    if (!starters.has(building.id)) points += pointsForBuild(costs[0]!);
    for (let level = 1; level < building.l; level++) points += pointsForUpgrade(costs[level]!);
  }
  return points;
};

/** Every rule a finished yard must keep. */
const expectWithinLimits = (yard: ProgressionYard) => {
  const buildingdata = buildingDataOf(yard.buildings);
  const hall = yard.buildings.find((building) => building.t === TOWN_HALL_TYPE)!.l;
  expect(hall).toBe(yard.townHall);

  const counts = new Map<number, number>();
  for (const building of yard.buildings) counts.set(building.t, (counts.get(building.t) ?? 0) + 1);
  for (const [type, count] of counts) expect(count).toBeLessThanOrEqual(allowed(type, hall));

  for (const building of yard.buildings) {
    const costs = costOf(building.t)!.costs;
    expect(building.l).toBeGreaterThanOrEqual(1);
    expect(building.l).toBeLessThanOrEqual(costs.length);
    // Every step it took still has its prerequisites (buildings only ever go up).
    for (let level = 0; level < building.l; level++) {
      expect(requirementsMet(costs[level]![5], buildingdata)).toBe(true);
    }
    if (building.t === MAP_ROOM_TYPE) expect(building.l).toBe(1);
  }

  expect(yard.basevalue).toBe(baseValueOf(buildingdata));
  expect(yard.points).toBe(pointsOf(yard.buildings));
  expect(calculateBaseLevel(String(yard.points), String(yard.basevalue))).toBe(yard.level);
};

describe("yardAtPoints", () => {
  test(
    "every level 1-40 x 20 seeds hits its level and keeps every limit",
    () => {
      for (let level = 1; level <= LEVELS; level++) {
        for (let index = 0; index < SEEDS; index++) {
          const seed = level * 7919 + index * 104729;
          const persona = PERSONAS[index % PERSONAS.length]!;
          const target = targetInBand(level, (index + 0.5) / SEEDS);
          const yard = yardAtPoints(seed, persona, target);
          expect({ level, index, got: yard.level }).toEqual({ level, index, got: level });
          expectWithinLimits(yard);
        }
      }
    },
    { timeout: 60_000 }
  );

  test("the same seed, persona and points give the same yard", () => {
    for (const persona of PERSONAS) {
      const target = targetInBand(27, 0.4);
      expect(yardAtPoints(31337, persona, target)).toEqual(yardAtPoints(31337, persona, target));
    }
  });

  test("different seeds give different yards at one level", () => {
    const target = targetInBand(20, 0.5);
    const a = yardAtPoints(1, "economy", target);
    const b = yardAtPoints(2, "economy", target);
    expect(a.buildings).not.toEqual(b.buildings);
  });

  test("a yard at P is a prefix of the yard at P' > P", () => {
    for (let index = 0; index < 12; index++) {
      const seed = 5000 + index;
      const persona = PERSONAS[index % PERSONAS.length]!;
      const low = targetInBand(5 + index * 2, 0.3);
      const high = targetInBand(8 + index * 2 + (index % 4), 0.7);
      const small = yardAtPoints(seed, persona, low);
      const large = yardAtPoints(seed, persona, high);
      expect(large.steps).toBeGreaterThanOrEqual(small.steps);
      expect(large.points).toBeGreaterThanOrEqual(small.points);

      const later = new Map(large.buildings.map((building) => [building.id, building]));
      for (const building of small.buildings) {
        const same = later.get(building.id);
        expect(same?.t).toBe(building.t);
        expect(same!.l).toBeGreaterThanOrEqual(building.l);
      }
    }
  });

  test("a target inside one band never leaves it, from its bottom to its top", () => {
    for (const level of [1, 2, 3, 4, 9, 18, 33, 40]) {
      const { min, max } = levelBand(level);
      for (const target of [min, max - 1]) {
        expect(yardAtPoints(77, "army", target).level).toBe(level);
      }
    }
  });

  test("level 1 is the starter base itself", () => {
    const yard = yardAtPoints(1, "towers", 0);
    expect(yard.steps).toBe(0);
    expect(yard.points).toBe(0);
    expect(yard.buildings.map((building) => building.t)).toEqual(STARTER_BUILDINGS.map((one) => one.t));
  });
});

describe("Progression", () => {
  test("never jumps a whole level band, and never upgrades the Map Room, to the very end", () => {
    for (const persona of PERSONAS) {
      const run = new Progression(2026, persona);
      let level = run.level;
      while (run.next()) {
        run.apply();
        expect(run.level - level).toBeLessThanOrEqual(1);
        level = run.level;
      }
      // A finished yard passes level 40, as the design says a full yard does (§3.4).
      expect(run.level).toBeGreaterThan(40);
      for (const building of run.buildings()) {
        if (building.t === MAP_ROOM_TYPE) expect(building.l).toBe(1);
      }
    }
  });

  test("next() is stable until apply() takes it", () => {
    const run = new Progression(9, "economy");
    for (let step = 0; step < 50; step++) {
      const first = run.next();
      expect(run.next()).toEqual(first);
      run.apply();
    }
  });

  test("an action's total is what the yard reaches once it is applied", () => {
    const run = new Progression(10, "army");
    for (let step = 0; step < 200; step++) {
      const action = run.next()!;
      run.apply();
      expect(run.total).toBe(action.total);
    }
  });

  test("personas lean their own way", () => {
    const target = targetInBand(30, 0.5);
    const share = (persona: (typeof PERSONAS)[number], types: readonly number[]) => {
      let mine = 0;
      let all = 0;
      for (let seed = 0; seed < 10; seed++) {
        for (const building of yardAtPoints(seed, persona, target).buildings) {
          if (building.t === 17 || building.t === 24 || building.t === 117) continue;
          all += building.l;
          if (types.includes(building.t)) mine += building.l;
        }
      }
      return mine / all;
    };
    const towers = [20, 21, 23, 25, 115, 118];
    expect(share("towers", towers)).toBeGreaterThan(share("economy", towers));
    const economy = [1, 2, 3, 4, 6];
    expect(share("economy", economy)).toBeGreaterThan(share("army", economy));
  });
});

describe("levelOfTotal", () => {
  test("agrees with calculateBaseLevel at every threshold", () => {
    for (const threshold of experiencePoints.slice(0, 42)) {
      for (const total of [threshold - 1, threshold]) {
        if (total < 0) continue;
        expect(levelOfTotal(total)).toBe(calculateBaseLevel(String(total), "0"));
      }
    }
  });
});
