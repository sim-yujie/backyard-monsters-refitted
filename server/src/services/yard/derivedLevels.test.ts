import { describe, expect, test } from "bun:test";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import {
  CATAPULT_TYPE,
  FLINGER_TYPE,
  derivedLevels,
  syncDerivedLevels,
  type DerivedLevelsSave,
} from "./derivedLevels.js";

const building = (id: number, t: number, extra: Partial<BuildingData> = {}): BuildingData =>
  ({ id, t, X: 0, Y: 0, ...extra }) as unknown as BuildingData;

/** A small yard: Town Hall 6, Flinger 3, Catapult 2, and some noise. */
const yard = (): BuildingDataMap => ({
  "0": building(0, 14, { l: 6 }),
  "1": building(1, FLINGER_TYPE, { l: 3 }),
  "2": building(2, CATAPULT_TYPE, { l: 2 }),
  "3": building(3, 20, { l: 9 }),
  "4": building(4, 17, { l: 4 }),
});

describe("derivedLevels", () => {
  test("reads the Flinger and Catapult levels off a yard", () => {
    expect(derivedLevels(yard())).toEqual({ flinger: 3, catapult: 2 });
  });

  test("a yard with neither reads 0 for both", () => {
    const buildings = yard();
    delete buildings["1"];
    delete buildings["2"];

    expect(derivedLevels(buildings)).toEqual({ flinger: 0, catapult: 0 });
  });

  test("an empty or missing buildingdata reads 0", () => {
    expect(derivedLevels({})).toEqual({ flinger: 0, catapult: 0 });
    expect(derivedLevels(null)).toEqual({ flinger: 0, catapult: 0 });
    expect(derivedLevels(undefined)).toEqual({ flinger: 0, catapult: 0 });
  });

  test("a Flinger still under construction does not count", () => {
    const buildings = yard();
    buildings["1"] = building(1, FLINGER_TYPE, { l: 0, cB: 600 });

    expect(derivedLevels(buildings).flinger).toBe(0);
  });

  test("a Flinger mid-upgrade counts at the level it has, not the one it is going to", () => {
    const buildings = yard();
    buildings["1"] = building(1, FLINGER_TYPE, { l: 3, cU: 3600 });

    expect(derivedLevels(buildings).flinger).toBe(3);
  });

  test("a finished building with no l is level 1, as everywhere else", () => {
    const buildings = yard();
    buildings["2"] = building(2, CATAPULT_TYPE);

    expect(derivedLevels(buildings).catapult).toBe(1);
  });

  test("the highest one wins when a save somehow holds two", () => {
    const buildings = yard();
    buildings["9"] = building(9, FLINGER_TYPE, { l: 4 });

    expect(derivedLevels(buildings).flinger).toBe(4);
  });
});

describe("syncDerivedLevels", () => {
  test("a stale cache is overwritten and the change reported", () => {
    const save: DerivedLevelsSave = { buildingdata: yard(), flinger: 1, catapult: 0 };

    expect(syncDerivedLevels(save)).toBe(true);
    expect(save).toMatchObject({ flinger: 3, catapult: 2 });
  });

  test("a cache already in step is left alone and reports no change", () => {
    const save: DerivedLevelsSave = { buildingdata: yard(), flinger: 3, catapult: 2 };

    expect(syncDerivedLevels(save)).toBe(false);
    expect(save).toMatchObject({ flinger: 3, catapult: 2 });
  });

  test("losing the Flinger brings the cache back to 0", () => {
    const buildings = yard();
    delete buildings["1"];
    const save: DerivedLevelsSave = { buildingdata: buildings, flinger: 3, catapult: 2 };

    expect(syncDerivedLevels(save)).toBe(true);
    expect(save.flinger).toBe(0);
    expect(save.catapult).toBe(2);
  });
});
