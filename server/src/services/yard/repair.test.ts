import { describe, expect, test } from "bun:test";
import { maxHp } from "../../game-rules/combat/stats.js";
import type { BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import {
  damagedBuildings,
  planRepair,
  planRepairInstant,
  repairRate,
  repairSecondsLeft,
} from "./repair.js";
import { repairAllPrice } from "./shiny.js";

const NOW = 1_800_000_000;

const yard = (
  buildingdata: BuildingDataMap,
  buildinghealthdata: BuildingHealthData = {}
): { buildingdata: BuildingDataMap; buildinghealthdata: BuildingHealthData } => ({
  buildingdata,
  buildinghealthdata,
});

/** The refusal's `reason`, or null when nothing was thrown. */
const reasonOf = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (err) {
    return (err as { data?: { reason?: string } }).data?.reason;
  }
  return null;
};

describe("repairRate", () => {
  test("ceil(max / min(3600, repairTime)), so no repair takes more than an hour", () => {
    // Twig Snapper level 1: 500 health, repairTime 30.
    expect(repairRate(1, 1, 500)).toBe(17);
    // Town Hall level 10: repairTime 345,600, clamped to an hour.
    const hall = maxHp(14, 10);
    expect(repairRate(14, 10, hall)).toBe(Math.ceil(hall / 3600));
  });

  test("a building still under construction reads repairTime[0]", () => {
    expect(repairRate(1, 0, 500)).toBe(17);
  });
});

describe("planRepair", () => {
  // A Town Hall, a damaged snapper, a snapper already repairing, a whole one.
  const save = yard(
    {
      "0": { id: 0, t: 14, x: 0, y: 0, l: 10 },
      "1": { id: 1, t: 1, x: 0, y: 0, hp: 100 },
      "2": { id: 2, t: 1, x: 0, y: 0, hp: 400, rE: 1 },
      "3": { id: 3, t: 1, x: 0, y: 0 },
    },
    { "1": 100, "2": 400 }
  );

  test("all starts every damaged building not already repairing", () => {
    const plan = planRepair(save, { all: true }, NOW);
    expect(plan.report.started).toEqual([1]);
    expect(plan.slices.buildingdata["1"]).toMatchObject({ rE: 1, hp: 100 });
    expect(plan.slices.buildingdata["2"]).toMatchObject({ rE: 1 });
    expect(plan.slices.buildingdata["3"]?.rE).toBeUndefined();
    // The slowest running repair: 400 health at 17 a second.
    expect(plan.report.doneBy).toBe(NOW + 24);
  });

  test("ids starts the named ones and says why the rest were not", () => {
    const plan = planRepair(save, { ids: [3, 2, 1] }, NOW);
    expect(plan.report.started).toEqual([1]);
    expect(plan.report.skipped).toEqual([
      { id: 3, reason: "notDamaged" },
      { id: 2, reason: "repairing" },
    ]);
  });

  test("refuses when nothing was started, and 400s an unknown id", () => {
    expect(reasonOf(() => planRepair(save, { ids: [2] }, NOW))).toBe("notDamaged");
    const whole = yard({ "3": { id: 3, t: 1, x: 0, y: 0 } });
    expect(reasonOf(() => planRepair(whole, { all: true }, NOW))).toBe("notDamaged");
    expect(reasonOf(() => planRepair(save, { ids: [42] }, NOW))).toBe("badRequest");
  });

  test("health at or above the level's maximum is not damage", () => {
    const whole = yard({ "1": { id: 1, t: 1, x: 0, y: 0, hp: 500 } }, { "1": 500 });
    expect(damagedBuildings(whole)).toEqual([]);
  });
});

describe("planRepairInstant", () => {
  test("heals everything damaged for FIX's price over every damaged building", () => {
    const hall = maxHp(14, 10);
    const save = yard(
      {
        "0": { id: 0, t: 14, x: 0, y: 0, l: 10, hp: 0 },
        "1": { id: 1, t: 1, x: 0, y: 0, hp: 100, rE: 1 },
        "3": { id: 3, t: 1, x: 0, y: 0 },
      },
      { "0": 0, "1": 100 }
    );
    const plan = planRepairInstant(save);

    const hallSeconds = repairSecondsLeft({ health: 0, max: hall, rate: Math.ceil(hall / 3600) });
    expect(hallSeconds).toBeGreaterThan(300);
    // The snapper's 23 s is under five minutes: neither charged nor counted.
    expect(plan.shiny).toBe(repairAllPrice([hallSeconds, 23]));
    expect(plan.shiny).toBe(repairAllPrice([hallSeconds]));
    expect(plan.shiny).toBeGreaterThan(10);
    expect(plan.report).toEqual({ repaired: [0, 1], credits: plan.shiny });
    expect(plan.slices.buildinghealthdata).toEqual({});
    for (const id of ["0", "1"]) {
      expect(plan.slices.buildingdata[id]?.hp).toBeUndefined();
      expect(plan.slices.buildingdata[id]?.rE).toBeUndefined();
    }
  });

  test("refuses when nothing is damaged", () => {
    const whole = yard({ "3": { id: 3, t: 1, x: 0, y: 0 } });
    expect(reasonOf(() => planRepairInstant(whole))).toBe("notDamaged");
  });
});
