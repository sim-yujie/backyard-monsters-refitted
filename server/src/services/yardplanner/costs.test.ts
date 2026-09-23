import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { costOf } from "../../game-data/buildingCosts.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import {
  countOfType,
  FREE_FINISH_SECONDS,
  isShort,
  levelOf,
  pointsForBuild,
  pointsForUpgrade,
  requirementsMet,
  shortfall,
  sumCosts,
  townHallLevel,
  upgradeSteps,
} from "./costs.js";

/**
 * The pure cost helpers the batch routes are built on.
 *
 * Everything here runs over a `buildingdata` map handed in by the caller, so
 * the tests build one by hand where a rule needs an exact shape and use the
 * sandbox fixture where they want a real yard.
 */

const FIXTURE = "../../../../web/test/fixtures/baseload-sandbox-yard.json";

const sandbox = (): BuildingDataMap =>
  JSON.parse(readFileSync(new URL(FIXTURE, import.meta.url), "utf8")).buildingdata;

/** A `buildingdata` map from a list of partial rows, keyed by id like a save. */
const yardOf = (
  rows: { id: number; t: number; l?: number; cB?: number }[]
): BuildingDataMap =>
  Object.fromEntries(rows.map((row) => [String(row.id), { x: 0, y: 0, ...row }]));

describe("levelOf", () => {
  test("an absent level means 1", () => {
    expect(levelOf({ x: 0, y: 0, id: 1, t: 17 })).toBe(1);
  });

  test("a stored level is taken as written", () => {
    expect(levelOf({ x: 0, y: 0, id: 1, t: 17, l: 4 })).toBe(4);
  });

  test("a running build countdown means level 0", () => {
    // `_lvl` is 0 until `Constructed()` sets it (`BFOUNDATION.as:2892-2901`),
    // so a half-built Town Hall unlocks nothing.
    expect(levelOf({ x: 0, y: 0, id: 1, t: 14, l: 10, cB: 120 })).toBe(0);
  });

  test("a finished countdown left on the row does not hide the level", () => {
    expect(levelOf({ x: 0, y: 0, id: 1, t: 14, l: 10, cB: 0 })).toBe(10);
  });

  test("a missing building is level 0", () => {
    expect(levelOf(undefined)).toBe(0);
  });
});

describe("townHallLevel", () => {
  test("reads the hall out of a real save", () => {
    expect(townHallLevel(sandbox())).toBe(10);
  });

  test("a yard with no hall is level 0", () => {
    // `BASE.CanUpgrade` refuses outright without one (`:3863-3866`).
    expect(townHallLevel(yardOf([{ id: 1, t: 17 }]))).toBe(0);
    expect(townHallLevel(null)).toBe(0);
    expect(townHallLevel(undefined)).toBe(0);
  });

  test("a hall still under construction does not count", () => {
    expect(townHallLevel(yardOf([{ id: 0, t: 14, l: 6, cB: 30 }]))).toBe(0);
  });
});

describe("countOfType", () => {
  test("counts every building of a type whatever its level", () => {
    const yard = sandbox();
    expect(countOfType(yard, 17)).toBe(400);
    expect(countOfType(yard, 24)).toBe(75);
    expect(countOfType(yard, 117)).toBe(18);
    expect(countOfType(yard, 14)).toBe(1);
  });

  test("a type the yard does not have is 0", () => {
    expect(countOfType(sandbox(), 99999)).toBe(0);
    expect(countOfType(null, 17)).toBe(0);
  });
});

describe("requirementsMet", () => {
  const hall = (level: number) => ({ id: 0, t: 14, l: level });

  test("an empty list is always met", () => {
    expect(requirementsMet([], null)).toBe(true);
  });

  test("a met gate passes", () => {
    // Level 5 walls need Town Hall 6 (`YARD_PROPS.as:1752-1757`).
    expect(requirementsMet([[14, 1, 6]], yardOf([hall(10)]))).toBe(true);
  });

  test("a hall below the required level fails", () => {
    expect(requirementsMet([[14, 1, 6]], yardOf([hall(5)]))).toBe(false);
  });

  test("too few buildings of the type fails", () => {
    expect(requirementsMet([[15, 2, 1]], yardOf([hall(10), { id: 1, t: 15 }]))).toBe(false);
    expect(
      requirementsMet([[15, 2, 1]], yardOf([hall(10), { id: 1, t: 15 }, { id: 2, t: 15 }]))
    ).toBe(true);
  });

  test("a building still counting its build down does not satisfy a gate", () => {
    expect(requirementsMet([[14, 1, 6]], yardOf([{ id: 0, t: 14, l: 10, cB: 90 }]))).toBe(false);
  });

  test("every entry has to hold, not just one", () => {
    // The Monster Juicer's Map Room 2 gate: Town Hall 3 *and* one Housing.
    const gate = costOf(9)?.costs[0]?.[5] ?? [];
    expect(gate).toEqual([[14, 1, 3], [15, 1, 1]]);
    expect(requirementsMet(gate, yardOf([hall(10)]))).toBe(false);
    expect(requirementsMet(gate, yardOf([hall(10), { id: 1, t: 15 }]))).toBe(true);
  });

  test("the sandbox yard clears every wall gate", () => {
    const yard = sandbox();
    for (const step of costOf(17)?.costs ?? []) {
      expect(requirementsMet(step[5], yard)).toBe(true);
    }
  });
});

describe("upgradeSteps", () => {
  test("picks the steps that leave each level in turn", () => {
    // `costs[k]` leaves level `k`, so 1 to 5 is steps 1, 2, 3 and 4.
    const steps = upgradeSteps(17, 1, 5);
    expect(steps.length).toBe(4);
    expect(steps[0]).toEqual([0, 10000, 0, 0, 5, [[14, 1, 3]]]);
    expect(steps[3]).toEqual([400000, 400000, 0, 0, 5, [[14, 1, 6]]]);
  });

  test("building from nothing includes the initial step", () => {
    expect(upgradeSteps(17, 0, 1)).toEqual([[1000, 0, 0, 0, 5, [[14, 1, 2]]]]);
  });

  test("a target at or below the current level is no steps at all", () => {
    expect(upgradeSteps(17, 5, 5)).toEqual([]);
    expect(upgradeSteps(17, 5, 2)).toEqual([]);
  });

  test("a target past the top of the ladder is truncated, not an error", () => {
    expect(upgradeSteps(17, 1, 99).length).toBe(4);
  });

  test("an unknown type has no steps", () => {
    expect(upgradeSteps(99999, 0, 5)).toEqual([]);
  });
});

describe("sumCosts", () => {
  test("adds the four resources and the time", () => {
    expect(sumCosts(upgradeSteps(17, 1, 5))).toEqual({
      r1: 700_000,
      r2: 710_000,
      r3: 0,
      r4: 0,
      time: 20,
    });
  });

  test("nothing costs nothing", () => {
    expect(sumCosts([])).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0, time: 0 });
  });

  test("400 walls from level 1 to 5 is the figure the plan quotes", () => {
    const one = sumCosts(upgradeSteps(17, 1, 5));
    expect(one.r1 * 400).toBe(280_000_000);
    expect(one.r2 * 400).toBe(284_000_000);
    // 400 walls x 4 steps x 5 seconds, every one of them free to finish.
    expect(one.time * 400).toBe(8_000);
    for (const step of upgradeSteps(17, 1, 5)) {
      expect(step[4]).toBeLessThanOrEqual(FREE_FINISH_SECONDS);
    }
  });
});

describe("shortfall", () => {
  const cost = { r1: 100, r2: 200, r3: 0, r4: 0 };

  test("a pool that covers the cost is short of nothing", () => {
    const missing = shortfall({ r1: 100, r2: 500, r3: 5, r4: 5 }, cost);
    expect(missing).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(isShort(missing)).toBe(false);
  });

  test("names only the resources that are actually short", () => {
    const missing = shortfall({ r1: 40, r2: 500, r3: 0, r4: 0 }, cost);
    expect(missing).toEqual({ r1: 60, r2: 0, r3: 0, r4: 0 });
    expect(isShort(missing)).toBe(true);
  });

  test("a missing or non-numeric key reads as zero held, not as infinite", () => {
    expect(shortfall({}, cost)).toEqual({ r1: 100, r2: 200, r3: 0, r4: 0 });
    expect(shortfall(null, cost)).toEqual({ r1: 100, r2: 200, r3: 0, r4: 0 });
    expect(shortfall({ r1: "lots" }, cost).r1).toBe(100);
  });

  test("the sandbox yard can pay for all 400 wall upgrades", () => {
    const one = sumCosts(upgradeSteps(17, 1, 5));
    const raw = JSON.parse(readFileSync(new URL(FIXTURE, import.meta.url), "utf8"));
    const missing = shortfall(raw.resources, {
      r1: one.r1 * 400,
      r2: one.r2 * 400,
      r3: 0,
      r4: 0,
    });
    expect(isShort(missing)).toBe(false);
  });
});

describe("points", () => {
  test("an upgrade awards a third of time plus every resource", () => {
    // `floor((time + r1 + r2 + r3 + r4) / 3)`, spec `docs/specs/base-building.md:965-969`.
    expect(pointsForUpgrade([100000, 100000, 0, 0, 5, []])).toBe(Math.floor(200005 / 3));
    expect(pointsForUpgrade([100000, 100000, 0, 0, 5, []])).toBe(66668);
    expect(pointsForUpgrade([0, 0, 0, 0, 0, []])).toBe(0);
  });

  test("taking one wall from level 1 to 5 awards the sum of its four steps", () => {
    const steps = upgradeSteps(17, 1, 5);
    const points = steps.reduce((total, step) => total + pointsForUpgrade(step), 0);
    // 3335 + 66668 + 133335 + 266668.
    expect(points).toBe(470_006);
  });

  test("a build awards half the time plus a tenth of the resources", () => {
    // `floor(time / 2 + (r1 + r2 + r3 + r4) / 10)`, spec `:971-973`.
    const booby = costOf(24)?.costs[0];
    expect(booby).toBeDefined();
    expect(pointsForBuild(booby!)).toBe(Math.floor(5 / 2 + 3000 / 10));
    expect(pointsForBuild(booby!)).toBe(302);

    const heavy = costOf(117)?.costs[0];
    expect(pointsForBuild(heavy!)).toBe(Math.floor(5 / 2 + 150000 / 10));
    expect(pointsForBuild(heavy!)).toBe(15002);
  });

  test("the free-finish threshold is the one the client uses", () => {
    expect(FREE_FINISH_SECONDS).toBe(300);
  });
});
