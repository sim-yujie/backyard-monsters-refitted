import { describe, expect, test } from "bun:test";
import { hatchCost } from "../../game-data/monsterCatalogue.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { catchUpYard, type CatchUpSave } from "./catchUp.js";
import { catchUpArmy, isMapRoom3Monsters } from "./catchUpMonsters.js";
import { cullHousing } from "./housing.js";

/**
 * Catch-up step 2 through `catchUpYard`, so the window splits at building
 * completions exactly as a real request runs it. Pokey (C1) at level 1: 15 s,
 * 10 space, 250 goo (checked in `production.test.ts`).
 */

const SAVED = 1_800_000_000;

const building = (id: number, t: number, extra: Partial<BuildingData> = {}): BuildingData =>
  ({ id, t, X: 0, Y: 0, ...extra }) as unknown as BuildingData;

/** Town Hall 6, one Housing L1 (200), hatcheries 21, 22 at L3. */
const yard = (extra: BuildingDataMap = {}): BuildingDataMap => ({
  "0": building(0, 14, { l: 6 }),
  "5": building(5, 15, { l: 1 }),
  "21": building(21, 13, { l: 3 }),
  "22": building(22, 13, { l: 3 }),
  ...extra,
});

const monstersOf = (h: unknown[][], extra: JsonObject = {}): JsonObject => ({
  saved: SAVED,
  housed: {},
  h,
  hid: [21, 22].slice(0, h.length),
  hstage: h.map((entry) => (entry[0] ? 1 : 0)),
  hcc: [],
  ...extra,
});

const saveOf = (overrides: Partial<CatchUpSave> = {}): CatchUpSave => ({
  savetime: SAVED,
  buildingdata: yard(),
  buildinghealthdata: {},
  storedata: {},
  points: "0",
  academy: { C1: { level: 1 } },
  resources: { r1: 0, r2: 0, r3: 0, r4: 1000 },
  monsters: monstersOf([["", 0, [["C1", 30, 1]]]]),
  ...overrides,
});

const housed = (save: CatchUpSave) => save.monsters!.housed as Record<string, number>;

describe("catchUpMonsters — production over a gap", () => {
  test("exact counts, the blob's bookkeeping written, a hatch record", () => {
    const save = saveOf();
    const completed = catchUpYard(save, SAVED + 150);

    expect(housed(save)).toEqual({ C1: 10 });
    expect(save.monsters).toMatchObject({
      saved: SAVED + 150,
      space: 200,
      hcount: 2,
      hid: [21, 22],
      hstage: [1, 0],
      h: [["C1", 15, [["C1", 19, 1]], 1], ["", 0, []]],
    });
    expect(completed).toContainEqual({ kind: "hatch", id: "C1", t: null, at: SAVED + 150, detail: { count: 10 } });
  });

  test("production starts at monsters.saved, not savetime (an attack save leaves them apart)", () => {
    const save = saveOf({ savetime: SAVED + 100 });
    catchUpYard(save, SAVED + 150);

    expect(housed(save)).toEqual({ C1: 10 });
  });

  test("stalls at full housing without losing or refunding anything", () => {
    const save = saveOf({ monsters: monstersOf([["", 0, [["C1", 30, 1]]]], { housed: { C1: 15 } }) });
    catchUpYard(save, SAVED + 10_000);

    expect(housed(save)).toEqual({ C1: 20 });
    expect(save.monsters!.hstage).toEqual([2, 0]);
    expect(save.monsters!.h).toEqual([["C1", 0, [["C1", 24, 1]], 1], ["", 0, []]]);
    expect(save.resources!.r4).toBe(1000);
  });

  test("a Housing upgrade finishing mid-window frees the stalled hatchery then", () => {
    // Housing 1 → 2 (200 → 260) finishes at SAVED + 1000.
    const save = saveOf({
      buildingdata: yard({ "5": building(5, 15, { l: 1, cU: 1000 }) }),
      monsters: monstersOf([["", 0, [["C1", 30, 1]]]], { housed: { C1: 15 } }),
    });
    catchUpYard(save, SAVED + 1060);

    // 5 before the stall, then 1000, 1015, 1030, 1045, 1060: 5 more.
    expect(housed(save)).toEqual({ C1: 25 });
    expect(save.monsters!.space).toBe(260);
  });

  test("a hatchery below half health does not work; one at half does", () => {
    const damaged = saveOf({ buildinghealthdata: { "21": 15_999 } });
    catchUpYard(damaged, SAVED + 150);
    expect(housed(damaged)).toEqual({});

    const half = saveOf({ buildinghealthdata: { "21": 16_000 } });
    catchUpYard(half, SAVED + 150);
    expect(housed(half)).toEqual({ C1: 10 });
  });

  test("a hatchery upgrading does nothing until its upgrade finishes", () => {
    const save = saveOf({ buildingdata: yard({ "21": building(21, 13, { l: 2, cU: 100 }) }) });
    catchUpYard(save, SAVED + 250);

    // Works from SAVED + 100: 10 done by SAVED + 250.
    expect(housed(save)).toEqual({ C1: 10 });
  });

  test("an overdrive that ran out inside the window speeds only its part", () => {
    // HOD 4x bought at SAVED - 3540, so it ends at SAVED + 60.
    const save = saveOf({ storedata: { HOD: { q: 1, s: SAVED - 3540, e: SAVED + 60 } } });
    catchUpYard(save, SAVED + 90);

    // 4 s each for 60 s = 15, then 2 at 15 s each by SAVED + 90.
    expect(housed(save)).toEqual({ C1: 17 });
    expect(save.storedata).toEqual({});
    expect(save.monsters).toMatchObject({ overdrivepower: 0, overdrivetime: 0 });
  });

  test("idempotent: a second run at the same moment changes nothing", () => {
    const save = saveOf({ buildingdata: yard({ "5": building(5, 15, { l: 1, cU: 50 }) }) });
    catchUpYard(save, SAVED + 400);
    const once = structuredClone(save);
    const again = catchUpYard(save, SAVED + 400);

    expect(save).toEqual(once);
    expect(again).toEqual([]);
  });

  test("two catch-ups in a row give what one would", () => {
    const one = saveOf({ buildingdata: yard({ "5": building(5, 15, { l: 1, cU: 500 }) }) });
    const two = structuredClone(one);
    catchUpYard(one, SAVED + 900);
    catchUpYard(two, SAVED + 333);
    catchUpYard(two, SAVED + 900);

    expect(two.monsters).toEqual(one.monsters);
    expect(two.buildingdata).toEqual(one.buildingdata);
  });
});

describe("catchUpMonsters — Hatchery Control Centre", () => {
  const withHcc = (hcc: Partial<BuildingData>) => yard({ "30": building(30, 16, { l: 1, ...hcc }) });

  test("its completion empties and refunds every queue, keeping the monster in production", () => {
    const save = saveOf({
      buildingdata: withHcc({ cB: 10 }),
      monsters: monstersOf(
        [
          ["C1", 15, [["C1", 4, 1], ["C2", 2, 2]]],
          ["", 0, [["C1", 3]]],
        ],
        { hcc: [] }
      ),
    });
    const completed = catchUpYard(save, SAVED + 10);

    // 22 was idle: it started one Pokey at SAVED (2 left). 21 still has its own.
    const goo = 4 * hatchCost("C1", 1)! + 2 * hatchCost("C2", 2)! + 2 * hatchCost("C1", 1)!;
    expect(save.resources!.r4).toBe(1000 + goo);
    expect(save.monsters!.h).toEqual([["C1", 5, [], 1], ["C1", 5, [], 1]]);
    expect(completed).toContainEqual({
      kind: "queueRefund",
      id: 30,
      t: 16,
      at: SAVED + 10,
      detail: { goo, monsters: { C1: 6, C2: 2 } },
    });
  });

  test("the refund is capped at the storage cap", () => {
    const save = saveOf({
      buildingdata: withHcc({ cB: 10 }),
      resources: { r1: 0, r2: 0, r3: 0, r4: 9_900 },
      monsters: monstersOf([["C1", 15, [["C1", 20, 1]]]]),
    });
    const completed = catchUpYard(save, SAVED + 10);

    expect(save.resources!.r4).toBe(10_000);
    expect(completed.find((job) => job.kind === "queueRefund")?.detail).toMatchObject({ goo: 100 });
  });

  test("a built HCC feeds the hatcheries from its shared queue in hid order", () => {
    const save = saveOf({
      buildingdata: withHcc({}),
      monsters: monstersOf([["", 0, []], ["", 0, []]], { hcc: [["C1", 3, 1]] }),
    });
    catchUpYard(save, SAVED + 15);

    // Both take one at SAVED and house it at SAVED + 15; 21 takes the last.
    expect(housed(save)).toEqual({ C1: 2 });
    expect(save.monsters!.h).toEqual([["C1", 15, [], 1], ["", 0, []]]);
    expect(save.monsters!.hcc).toEqual([]);
  });
});

describe("catchUpMonsters — cull and bookkeeping", () => {
  test("culls one of every type per pass when housing is destroyed, no refund", () => {
    const save = saveOf({
      buildingdata: yard({ "6": building(6, 15, { l: 1 }) }),
      buildinghealthdata: { "6": 0 },
      monsters: monstersOf([], { housed: { C1: 20, C2: 1 } }),
    });
    const completed = catchUpYard(save, SAVED);

    // The destroyed Housing counts nothing: 21 × 10 > 200, and one
    // pass takes a C1 and the C2.
    expect(housed(save)).toEqual({ C1: 19 });
    expect(completed.filter((job) => job.kind === "cull")).toHaveLength(2);
    expect(save.resources!.r4).toBe(1000);
  });

  test("a Housing upgrade in progress keeps its old capacity: nothing culled", () => {
    const save = saveOf({
      buildingdata: yard({ "5": building(5, 15, { l: 2, cU: 5000 }) }),
      monsters: monstersOf([], { housed: { C1: 26 } }),
    });
    catchUpYard(save, SAVED);

    expect(housed(save)).toEqual({ C1: 26 });
  });

  test("cullHousing thins evenly until the army fits", () => {
    // 10 space each: 100 into 60 takes two passes.
    expect(cullHousing({ C1: 5, C2: 5 }, 60, {})).toEqual({
      housed: { C1: 3, C2: 3 },
      culled: { C1: 2, C2: 2 },
    });
  });

  test("drops the hatchery and HCC building-field copies", () => {
    const save = saveOf({
      buildingdata: yard({ "21": building(21, 13, { l: 3, rPS: 1, rCP: 4, rIP: "C1", mq: [["C1", 1]] }) }),
    });
    catchUpYard(save, SAVED);

    expect(Object.keys(save.buildingdata!["21"]!).sort()).toEqual(["X", "Y", "id", "l", "t"]);
  });

  test("a Map Room 3 blob is left alone", () => {
    const monsters = { C1: [{ health: 100, ownerID: 1, q: 0 }], Q: [] };
    const save = saveOf({ monsters });
    catchUpYard(save, SAVED + 1000);

    expect(isMapRoom3Monsters(monsters)).toBe(true);
    expect(save.monsters).toEqual(monsters);
  });
});

describe("catchUpArmy — the map's in-memory read", () => {
  test("equals what the next full catch-up writes, and touches nothing", () => {
    const save = saveOf({
      buildingdata: yard({
        "5": building(5, 15, { l: 1, cU: 300 }),
        "30": building(30, 16, { l: 1, cB: 200 }),
      }),
      storedata: { HOD: { q: 1, s: SAVED - 3500, e: SAVED + 100 } },
      monsters: monstersOf([["C1", 3, [["C1", 20, 1]]], ["", 0, [["C1", 10]]]], { housed: { C1: 12 } }),
    });
    const snapshot = structuredClone(save);

    const read = catchUpArmy(snapshot, SAVED + 2000);
    expect(snapshot).toEqual(structuredClone(save));

    catchUpYard(save, SAVED + 2000);
    expect(read.monsters).toEqual(save.monsters!);
    expect(read.resources).toEqual(save.resources!);
  });
});
