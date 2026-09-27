import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { academyLevel, housingCapacity, housingSummary, housingUsed } from "./housingSummary";

/** The Monsters screen's header figures, against the server's transfer arithmetic. */

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
