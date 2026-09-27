import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import {
  academyLevel,
  expansionEndsAt,
  housedRows,
  housingBuildings,
  housingCapacity,
  housingSummary,
  housingUsed,
  stalledHatcheries,
} from "./housing";
import { housingSummary as headerSummary } from "./housingSummary";

/** The Housing tab's figures and the header's, against the server's transfer arithmetic. */

const T0 = 2_000_000;

const saveOf = (fields: Partial<BaseLoadResponse>): BaseLoadResponse =>
  ({ error: 0, currenttime: T0, ...fields }) as unknown as BaseLoadResponse;

describe("housingCapacity", () => {
  it("adds each finished Housing at its level's Map Room 2 room", () => {
    const save = saveOf({
      buildingdata: {
        "1": { id: 1, t: 15, X: 0, Y: 0 },
        "2": { id: 2, t: 15, l: 6, X: 0, Y: 0 },
        // Under construction, and wrecked: neither houses anything.
        "3": { id: 3, t: 15, l: 0, cB: 100, X: 0, Y: 0 },
        "4": { id: 4, t: 15, l: 3, hp: 10, X: 0, Y: 0 },
        // Not housing.
        "5": { id: 5, t: 13, l: 3, X: 0, Y: 0 },
      },
    });
    expect(housingCapacity(save, T0)).toBe(200 + 540);
  });

  it("reads health from buildinghealthdata too, and counts a mid-upgrade building at its old level", () => {
    const save = saveOf({
      buildingdata: {
        "1": { id: 1, t: 15, l: 2, cU: 600, X: 0, Y: 0 },
        "2": { id: 2, t: 15, l: 2, X: 0, Y: 0 },
      },
      buildinghealthdata: { "2": 5 },
    });
    expect(housingCapacity(save, T0)).toBe(260);
  });

  it("takes 1.25x while Housing Expansion runs", () => {
    const buildingdata = { "1": { id: 1, t: 15, l: 5, X: 0, Y: 0 } };
    expect(housingCapacity(saveOf({ buildingdata, storedata: { EXH: { e: T0 + 60 } } }), T0)).toBe(562);
    expect(housingCapacity(saveOf({ buildingdata, storedata: { EXH: { e: T0 - 1 } } }), T0)).toBe(450);
  });
});

describe("housingUsed", () => {
  it("counts each housed monster at its academy level's space", () => {
    const save = saveOf({
      monsters: { housed: { C1: 10, C3: 2, C200: 5, C2: 0 } },
      academy: { C1: { level: 6 } },
    });
    // Pokey at level 6 takes 7; Bolt at level 1 takes 15; an unknown id takes nothing.
    expect(housingUsed(save)).toBe(10 * 7 + 2 * 15);
  });

  it("reads an absent academy level as 1", () => {
    expect(academyLevel(null, "C1")).toBe(1);
    expect(academyLevel({ C1: { level: 0 } }, "C1")).toBe(1);
    expect(academyLevel({ C1: { level: 4 } }, "C1")).toBe(4);
  });
});

it("housingSummary pairs the two", () => {
  const save = saveOf({
    buildingdata: { "1": { id: 1, t: 15, X: 0, Y: 0 } },
    monsters: { housed: { C1: 3 } },
  });
  expect(housingSummary(save, T0)).toEqual({ used: 30, total: 200 });
});

it("the header's module still hands out the same summary", () => {
  expect(headerSummary).toBe(housingSummary);
});

describe("housingBuildings", () => {
  it("lists every Housing by id with what it houses and why a building counts zero", () => {
    const save = saveOf({
      buildingdata: {
        "9": { id: 9, t: 15, l: 6, X: 0, Y: 0 },
        "3": { id: 3, t: 15, l: 0, cB: 100, X: 0, Y: 0 },
        "4": { id: 4, t: 15, l: 3, X: 0, Y: 0 },
        "5": { id: 5, t: 15, l: 4, cU: 600, X: 0, Y: 0 },
        "6": { id: 6, t: 13, l: 3, X: 0, Y: 0 },
      },
      buildinghealthdata: { "4": 10 },
    });
    expect(housingBuildings(save, T0)).toEqual([
      { id: 3, level: 1, capacity: 0, zero: "building", upgrading: false },
      { id: 4, level: 3, capacity: 0, zero: "damaged", upgrading: false },
      // Mid-upgrade: houses at level 4 until it finishes.
      { id: 5, level: 4, capacity: 380, zero: null, upgrading: true },
      { id: 9, level: 6, capacity: 540, zero: null, upgrading: false },
    ]);
  });

  it("counts a building above 10 health, and one with no health on record, in full", () => {
    const save = saveOf({
      buildingdata: {
        "1": { id: 1, t: 15, l: 2, X: 0, Y: 0 },
        "2": { id: 2, t: 15, l: 2, hp: 11, X: 0, Y: 0 },
      },
    });
    expect(housingBuildings(save, T0).map((row) => row.capacity)).toEqual([260, 260]);
  });

  it("applies Housing Expansion per building, truncated as the server does", () => {
    const save = saveOf({
      buildingdata: {
        "1": { id: 1, t: 15, l: 5, X: 0, Y: 0 },
        "2": { id: 2, t: 15, l: 6, X: 0, Y: 0 },
      },
      storedata: { EXH: { e: T0 + 1 } },
    });
    expect(housingBuildings(save, T0).map((row) => row.capacity)).toEqual([562, 675]);
    expect(housingCapacity(save, T0)).toBe(562 + 675);
  });

  it("gives the owner's four level-6 Housings 2,160, so 25 Teratorn and 2 Zafreeti fill 2,150", () => {
    const buildingdata = Object.fromEntries(
      [1, 2, 3, 4].map((id) => [String(id), { id, t: 15, l: 6, X: 0, Y: 0 }]),
    );
    const save = saveOf({ buildingdata, monsters: { housed: { C14: 25, C15: 2 } } });
    expect(housingSummary(save, T0)).toEqual({ used: 2_150, total: 2_160 });
  });
});

describe("expansionEndsAt", () => {
  it("names the end of a running expansion and nothing once it has run out", () => {
    expect(expansionEndsAt(saveOf({ storedata: { EXH: { e: T0 + 3_600 } } }), T0)).toBe(T0 + 3_600);
    expect(expansionEndsAt(saveOf({ storedata: { EXH: { e: T0 } } }), T0)).toBeNull();
    expect(expansionEndsAt(saveOf({ storedata: {} }), T0)).toBeNull();
    expect(expansionEndsAt(saveOf({}), T0)).toBeNull();
  });
});

describe("housedRows", () => {
  it("gives one row per type in list order with space each and total, skipping empties and unknowns", () => {
    const save = saveOf({
      monsters: { housed: { C3: 2, C1: 10, C200: 5, C2: 0, C4: -1 } },
      academy: { C1: { level: 6 } },
    });
    expect(
      housedRows(save).map((row) => [row.monster.id, row.count, row.each, row.total]),
    ).toEqual([
      ["C1", 10, 7, 70],
      ["C3", 2, 15, 30],
    ]);
  });

  it("is empty for a yard with no army", () => {
    expect(housedRows(saveOf({}))).toEqual([]);
    expect(housingUsed(saveOf({ monsters: {} }))).toBe(0);
  });
});

describe("stalledHatcheries", () => {
  it("counts the hatcheries at stage 2 holding a finished monster", () => {
    const save = saveOf({
      monsters: {
        h: [
          ["C1", 0, []],
          ["C2", 30, []],
          ["C3", 0, []],
          ["", 0, []],
        ],
        hid: [10, 11, 12, 13],
        hstage: [2, 1, 2, 2],
      },
    });
    expect(stalledHatcheries(save)).toBe(2);
  });

  it("is 0 without production state", () => {
    expect(stalledHatcheries(saveOf({}))).toBe(0);
    expect(stalledHatcheries(saveOf({ monsters: { housed: { C1: 1 } } }))).toBe(0);
  });
});
