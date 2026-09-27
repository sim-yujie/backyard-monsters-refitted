import { describe, expect, test } from "bun:test";
import { maxHp } from "../../game-rules/combat/stats.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import { catchUpYard, type CatchUpSave } from "./catchUp.js";
import { catchUpRepairs } from "./catchUpRepairs.js";

const T0 = 1_800_000_000;

/** A level 1 Twig Snapper: 500 health, repairTime 30 s, so 17 health a second. */
const snapper = (overrides: Partial<BuildingData> = {}): BuildingData => ({
  id: 1,
  t: 1,
  x: 0,
  y: 0,
  st: 0,
  pr: 1,
  cP: 10,
  ...overrides,
});

const yardOf = (
  building: BuildingData,
  health: BuildingHealthData = {}
): CatchUpSave & { buildingdata: BuildingDataMap; buildinghealthdata: BuildingHealthData } => ({
  savetime: T0,
  buildingdata: { [String(building.id)]: building },
  buildinghealthdata: health,
  storedata: {},
});

describe("catchUpRepairs", () => {
  test("the snapper's numbers are the ones the tests assume", () => {
    expect(maxHp(1, 1)).toBe(500);
  });

  test("heals a repairing building part of the way, in both places", () => {
    const save = yardOf(snapper({ hp: 100, rE: 1 }), { "1": 100 });
    const jobs = catchUpRepairs(save, T0, T0 + 10);
    expect(jobs).toEqual([]);
    expect(save.buildingdata["1"]).toMatchObject({ hp: 270, rE: 1 });
    expect(save.buildinghealthdata["1"]).toBe(270);
  });

  test("a repair that reaches full health ends at that second and is reported", () => {
    const save = yardOf(snapper({ hp: 100, rE: 1 }), { "1": 100 });
    const jobs = catchUpRepairs(save, T0, T0 + 30);
    // ceil(400 / 17) = 24 s.
    expect(jobs).toEqual([
      { kind: "repair", id: 1, t: 1, at: T0 + 24, detail: { from: 100, max: 500 } },
    ]);
    expect(save.buildingdata["1"]?.hp).toBeUndefined();
    expect(save.buildingdata["1"]?.rE).toBeUndefined();
    expect("1" in save.buildinghealthdata).toBe(false);
  });

  test("reads health from buildinghealthdata when the building has no hp", () => {
    const save = yardOf(snapper({ rE: 1 }), { "1": 483 });
    expect(catchUpRepairs(save, T0, T0 + 1)).toHaveLength(1);
  });

  test("a damaged building that is not repairing is left alone", () => {
    const save = yardOf(snapper({ hp: 100 }), { "1": 100 });
    const before = structuredClone(save);
    expect(catchUpRepairs(save, T0, T0 + 3600)).toEqual([]);
    expect(save).toEqual(before);
  });

  test("a repair flag on a building at full health is cleared without a job", () => {
    const save = yardOf(snapper({ rE: 1 }));
    expect(catchUpRepairs(save, T0, T0 + 5)).toEqual([]);
    expect(save.buildingdata["1"]?.rE).toBeUndefined();
  });

  test("adds the paused part of the window to the countdown step 1 advances", () => {
    const save = yardOf(snapper({ hp: 100, rE: 1, cU: 50 }), { "1": 100 });
    catchUpRepairs(save, T0, T0 + 30);
    expect(save.buildingdata["1"]?.cU).toBe(50 + 24);
  });
});

describe("catchUpYard with repairs", () => {
  test("an upgrade paused by damage resumes when the repair ends", () => {
    const save = yardOf(snapper({ hp: 100, rE: 1, cU: 100, cL: 100 }), { "1": 100 });
    const completed = catchUpYard(save, T0 + 200);
    expect(completed.map((job) => [job.kind, job.at])).toEqual([
      ["repair", T0 + 24],
      ["upgrade", T0 + 124],
    ]);
    expect(save.buildingdata["1"]).toMatchObject({ l: 2 });
  });

  test("an upgrade paused by damage has the repair's time still to run", () => {
    const save = yardOf(snapper({ hp: 100, rE: 1, cU: 100 }), { "1": 100 });
    catchUpYard(save, T0 + 100);
    expect(save.buildingdata["1"]?.cU).toBe(24);
  });

  test("a harvester repaired in the window produces at its old health until then", () => {
    // 200 of 500 is below half: nothing until the repair ends at 18 s, then
    // full-health 10 s cycles on the countdown it had kept.
    const save = yardOf(snapper({ hp: 200, rE: 1 }), { "1": 200 });
    catchUpYard(save, T0 + 64);
    expect(save.buildingdata["1"]).toMatchObject({ st: 8, pr: 1, cP: 4 });
  });

  test("is idempotent at the same moment", () => {
    const save = yardOf(snapper({ hp: 100, rE: 1, cU: 500 }), { "1": 100 });
    catchUpYard(save, T0 + 10);
    const once = structuredClone(save);
    expect(catchUpYard(save, T0 + 10)).toEqual([]);
    expect(save).toEqual(once);
  });
});
