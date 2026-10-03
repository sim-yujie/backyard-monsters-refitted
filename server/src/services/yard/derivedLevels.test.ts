import { describe, expect, test } from "bun:test";
import { COSTS } from "../../game-data/buildingCosts.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import {
  CATAPULT_TYPE,
  FLINGER_TYPE,
  derivedLevels,
  syncBaseValue,
  syncDerivedLevels,
  type BaseValueSave,
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

describe("syncBaseValue (#209)", () => {
  /**
   * Flash's sum over {@link yard}, written out the way `BASE.CalcBaseValue`
   * reads it (`client/scripts/BASE.as:4830-4861`): `time + r1 + r2 + r3 + r4`
   * of `costs[level - 1]` for each building.
   */
  const flashSum = (): number => {
    let total = 0;
    for (const [type, level] of [
      [14, 6],
      [FLINGER_TYPE, 3],
      [CATAPULT_TYPE, 2],
      [20, 9],
      [17, 4],
    ] as const) {
      const [r1, r2, r3, r4, time] = COSTS[type]!.costs[level - 1]!;
      total += time + r1 + r2 + r3 + r4;
    }
    return total;
  };

  const mainOf = (basevalue?: string): BaseValueSave => ({ type: "main", buildingdata: yard(), basevalue });

  test("matches Flash's formula on a sample yard: a tenth of the sum, rounded up", () => {
    const save = mainOf("0");

    expect(syncBaseValue(save)).toBe(true);
    expect(save.basevalue).toBe(String(Math.ceil(flashSum() * 0.1)));
  });

  test("a missing or unreadable value is written", () => {
    for (const basevalue of [undefined, "", "abc"]) {
      const save = mainOf(basevalue);
      syncBaseValue(save);
      expect(save.basevalue).toBe(String(Math.ceil(flashSum() * 0.1)));
    }
  });

  test("never lowered: a stored value above the yard's worth is kept, and no change reported", () => {
    const save = mainOf("99999999");

    expect(syncBaseValue(save)).toBe(false);
    expect(save.basevalue).toBe("99999999");
  });

  test("a value already in step reports no change", () => {
    const save = mainOf(String(Math.ceil(flashSum() * 0.1)));

    expect(syncBaseValue(save)).toBe(false);
  });

  test("a building under construction counts nothing; a finished one with level 0 counts as 1", () => {
    const save: BaseValueSave = {
      type: "main",
      buildingdata: {
        "1": building(1, 20, { l: 0, cB: 600 }),
        "2": building(2, 17, { l: 0 }),
      },
      basevalue: "0",
    };
    const [r1, r2, r3, r4, time] = COSTS[17]!.costs[0]!;

    syncBaseValue(save);

    expect(save.basevalue).toBe(String(Math.ceil(0.1 * (time + r1 + r2 + r3 + r4))));
  });

  test("main yards only: an outpost, a wild monster yard or an Inferno yard is left alone", () => {
    for (const type of ["outpost", "tribe", "inferno", undefined]) {
      const save: BaseValueSave = { type, buildingdata: yard(), basevalue: "0" };

      expect(syncBaseValue(save)).toBe(false);
      expect(save.basevalue).toBe("0");
    }
  });
});
