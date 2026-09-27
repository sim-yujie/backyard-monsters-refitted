import { describe, expect, test } from "bun:test";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import { catchUpYard, type CatchUpSave } from "./catchUp.js";
import { FLINGER_TYPE } from "./derivedLevels.js";

/**
 * Catch-up step 1 through its only entry point. Everything is a plain object:
 * the catch-up takes no database and no clock, so `now` is just a number.
 */

const SAVED = 1_800_000_000;
const DAY = 24 * 60 * 60;

const building = (id: number, t: number, extra: Partial<BuildingData> = {}): BuildingData =>
  ({ id, t, X: 0, Y: 0, ...extra }) as unknown as BuildingData;

/** Town Hall 3, a Cannon Tower 1 → 2 with 100 s left, a Flinger 1. */
const yard = (): BuildingDataMap => ({
  "0": building(0, 14, { l: 3 }),
  "1": building(1, 20, { l: 1, cU: 100 }),
  "2": building(2, FLINGER_TYPE, { l: 1 }),
});

const saveOf = (overrides: Partial<CatchUpSave> = {}): CatchUpSave => ({
  savetime: SAVED,
  buildingdata: yard(),
  buildinghealthdata: {},
  storedata: {},
  points: "1000",
  flinger: 1,
  catapult: 0,
  ...overrides,
});

// Cannon Tower costs[1] = [10000, 7500, 2500, 0, 900]: floor((900 + 20000) / 3).
const CANNON_UPGRADE_POINTS = 6966;

describe("catchUpYard — building countdowns", () => {
  test("an upgrade whose countdown has run out finishes, with its points and a record", () => {
    const save = saveOf();

    const completed = catchUpYard(save, SAVED + 250);

    expect(save.buildingdata!["1"]).toMatchObject({ l: 2 });
    expect(save.buildingdata!["1"]!.cU).toBeUndefined();
    expect(save.points).toBe(String(1000 + CANNON_UPGRADE_POINTS));
    expect(save.savetime).toBe(SAVED + 250);
    expect(completed).toEqual([
      {
        kind: "upgrade",
        id: 1,
        t: 20,
        at: SAVED + 100,
        detail: { from: 1, level: 2, points: CANNON_UPGRADE_POINTS },
      },
    ]);
  });

  test("a countdown still running is brought forward and nothing is awarded", () => {
    const save = saveOf();

    const completed = catchUpYard(save, SAVED + 40);

    expect(completed).toEqual([]);
    expect(save.buildingdata!["1"]).toMatchObject({ l: 1, cU: 60 });
    expect(save.points).toBe("1000");
    expect(save.savetime).toBe(SAVED + 40);
  });

  test("a job's length rides along while it runs and is cleared when it ends (#136)", () => {
    const save = saveOf({
      buildingdata: {
        "0": building(0, 14, { l: 3 }),
        "1": building(1, 20, { l: 1, cU: 100, cL: 720 }),
        "5": building(5, 20, { l: 0, cB: 300, cL: 300 }),
        "6": building(6, 20, { l: 0, cB: 30, cL: 30 }),
      },
    });

    catchUpYard(save, SAVED + 60);

    // Still running: the countdown moves, the length it is measured against does not.
    expect(save.buildingdata!["1"]).toMatchObject({ cU: 40, cL: 720 });
    expect(save.buildingdata!["5"]).toMatchObject({ cB: 240, cL: 300 });
    // Finished builds and upgrades leave no length behind.
    expect(save.buildingdata!["6"]!.cB).toBeUndefined();
    expect(save.buildingdata!["6"]!.cL).toBeUndefined();

    catchUpYard(save, SAVED + 200);
    expect(save.buildingdata!["1"]).toMatchObject({ l: 2 });
    expect(save.buildingdata!["1"]!.cU).toBeUndefined();
    expect(save.buildingdata!["1"]!.cL).toBeUndefined();
  });

  test("a build finishes at level 1 with the build formula; a Town Hall earns 100 more", () => {
    const save = saveOf({
      buildingdata: {
        "5": building(5, 20, { l: 0, cB: 30 }),
        "6": building(6, 14, { l: 0, cB: 10 }),
      },
    });

    const completed = catchUpYard(save, SAVED + 60);

    // Cannon costs[0] = [2000, 1500, 500, 0, 30]: 30 / 2 + 4000 / 10 = 415.
    // Town Hall costs[0] = [0, 0, 0, 0, 10]: 10 / 2 + 100 = 105.
    expect(completed.map((job) => [job.id, job.kind, job.detail])).toEqual([
      [6, "build", { from: 0, level: 1, points: 105 }],
      [5, "build", { from: 0, level: 1, points: 415 }],
    ]);
    expect(save.points).toBe(String(1000 + 415 + 105));
  });

  test("the completed list is ordered by the moment each job ended", () => {
    const save = saveOf({
      buildingdata: {
        "1": building(1, 20, { l: 1, cU: 500 }),
        "2": building(2, 20, { l: 1, cU: 50 }),
        "3": building(3, 20, { l: 1, cU: 200 }),
      },
    });

    const completed = catchUpYard(save, SAVED + 1000);

    expect(completed.map((job) => [job.id, job.at])).toEqual([
      [2, SAVED + 50],
      [3, SAVED + 200],
      [1, SAVED + 500],
    ]);
  });

  test("a damaged building's countdown stays paused (the existing rule)", () => {
    const save = saveOf({ buildinghealthdata: { "1": 400 } });

    const completed = catchUpYard(save, SAVED + 1000);

    expect(completed).toEqual([]);
    expect(save.buildingdata!["1"]).toMatchObject({ l: 1, cU: 100 });
  });

  test("a finished Flinger upgrade refreshes save.flinger", () => {
    const save = saveOf({
      buildingdata: { "2": building(2, FLINGER_TYPE, { l: 1, cU: 10 }) },
    });

    catchUpYard(save, SAVED + 10);

    expect(save.flinger).toBe(2);
  });
});

describe("catchUpYard — guarantees", () => {
  test("idempotent: a second run at the same now changes nothing", () => {
    const save = saveOf();
    const first = catchUpYard(save, SAVED + 250);
    const afterFirst = structuredClone(save);

    const second = catchUpYard(save, SAVED + 250);

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    expect(save).toEqual(afterFirst);
  });

  test("points are awarded once, however many catch-ups follow", () => {
    const save = saveOf();

    catchUpYard(save, SAVED + 250);
    catchUpYard(save, SAVED + 500);
    catchUpYard(save, SAVED + 5000);

    expect(save.points).toBe(String(1000 + CANNON_UPGRADE_POINTS));
  });

  test("elapsed time is clamped to 30 days", () => {
    const save = saveOf({
      savetime: SAVED - 60 * DAY,
      buildingdata: {
        "1": building(1, 20, { l: 1, cU: 40 * DAY }),
        "2": building(2, 20, { l: 1, cU: 29 * DAY }),
      },
    });

    const completed = catchUpYard(save, SAVED);

    // Only 30 of the 60 days count: the 40-day job has 10 days left.
    expect(save.buildingdata!["1"]).toMatchObject({ l: 1, cU: 10 * DAY });
    expect(completed.map((job) => job.id)).toEqual([2]);
    expect(save.savetime).toBe(SAVED);
  });

  test("a save that was never saved (savetime 0) replays no time at all", () => {
    const save = saveOf({ savetime: 0 });

    const completed = catchUpYard(save, SAVED + 250);

    expect(completed).toEqual([]);
    expect(save.buildingdata!["1"]).toMatchObject({ l: 1, cU: 100 });
    expect(save.savetime).toBe(SAVED + 250);
  });

  test("a savetime ahead of now replays nothing and does not count backwards", () => {
    const save = saveOf({ savetime: SAVED + 500 });

    const completed = catchUpYard(save, SAVED);

    expect(completed).toEqual([]);
    expect(save.buildingdata!["1"]).toMatchObject({ cU: 100 });
  });

  test("never charges: resources are not part of the slice it touches", () => {
    const save = { ...saveOf(), resources: { r1: 5, r2: 5, r3: 5, r4: 5 } };

    catchUpYard(save, SAVED + 250);

    expect(save.resources).toEqual({ r1: 5, r2: 5, r3: 5, r4: 5 });
  });
});

describe("catchUpYard — store buffs", () => {
  test("an entry past its e is removed and recorded; one still running stays", () => {
    const save = saveOf({
      storedata: {
        BST: { q: 1, e: SAVED + 100 },
        HOD: { q: 1, e: SAVED + 10_000 },
        BEW: { q: 2 },
      },
    });

    const completed = catchUpYard(save, SAVED + 250);

    expect(save.storedata).toEqual({ HOD: { q: 1, e: SAVED + 10_000 }, BEW: { q: 2 } });
    expect(completed).toContainEqual({
      kind: "storeItem",
      id: "BST",
      t: null,
      at: SAVED + 100,
      detail: {},
    });
  });

  test("nothing expired leaves storedata as the same object", () => {
    const storedata = { BEW: { q: 2 } };
    const save = saveOf({ storedata });

    catchUpYard(save, SAVED + 250);

    expect(save.storedata).toBe(storedata);
  });
});
