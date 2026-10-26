import { describe, expect, test } from "bun:test";

import { baseValueOf } from "../base/economy/resourceBudget.js";
import { calculateBaseLevel } from "../base/calculateBaseLevel.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { infernoStartBuildingData } from "./infernoYard.js";
import {
  currentInfernoTribes,
  infernoTribeFlingCapacity,
  infernoTribeRespawnAt,
  infernoTribeRespawned,
  infernoTribeYardOf,
  infernoYardLevel,
  isInfernoTribeBaseid,
  respawnInfernoTribe,
  underHallFallen,
} from "./infernoTribes.js";

/**
 * The Moloch tribes' rules (Inferno WP 2.7-2.8, `docs/design/inferno.md`
 * §2.7): seven tribes by the Inferno yard's level, the level pattern, the
 * hour's respawn, a Housing Bunker's load per fling (R11) and the Under Hall
 * win.
 */

const bunker = (id: number, l: number, extra: object = {}) => ({ [String(id)]: { t: 128, id, l, X: 0, Y: 0, ...extra } });

describe("which tribes", () => {
  test("base ids 214-234 are the tribes; the Descent's and others are not", () => {
    expect(isInfernoTribeBaseid("214")).toBe(true);
    expect(isInfernoTribeBaseid("234")).toBe(true);
    expect(isInfernoTribeBaseid(220)).toBe(true);
    expect(isInfernoTribeBaseid("213")).toBe(false);
    expect(isInfernoTribeBaseid("235")).toBe(false);
    expect(isInfernoTribeBaseid("21a")).toBe(false);
    expect(isInfernoTribeBaseid(undefined)).toBe(false);
  });

  test("up to level 10 the seven are 214-220, at -2, -1, 0, 0, 0, +1, +3", () => {
    expect(currentInfernoTribes(5)).toEqual([
      { baseid: "214", level: 3 },
      { baseid: "215", level: 4 },
      { baseid: "216", level: 5 },
      { baseid: "217", level: 5 },
      { baseid: "218", level: 5 },
      { baseid: "219", level: 6 },
      { baseid: "220", level: 8 },
    ]);
    expect(currentInfernoTribes(10)[0]!.baseid).toBe("214");
  });

  test("11-20 face 221-227 and 21 up 228-234", () => {
    expect(currentInfernoTribes(11).map((slot) => slot.baseid)).toEqual(["221", "222", "223", "224", "225", "226", "227"]);
    expect(currentInfernoTribes(20)[6]!.baseid).toBe("227");
    expect(currentInfernoTribes(21).map((slot) => slot.baseid)).toEqual(["228", "229", "230", "231", "232", "233", "234"]);
    expect(currentInfernoTribes(60)[0]).toEqual({ baseid: "228", level: 58 });
  });

  test("a level is never below 1", () => {
    expect(currentInfernoTribes(1).map((slot) => slot.level)).toEqual([1, 1, 1, 1, 1, 2, 4]);
    expect(currentInfernoTribes(0).map((slot) => slot.level)).toEqual([1, 1, 1, 1, 1, 2, 4]);
  });

  test("every tribe yard is in the data, with an Under Hall", () => {
    for (let id = 214; id <= 234; id++) {
      const yard = infernoTribeYardOf(String(id));
      expect(yard?.baseid).toBe(String(id));
      const halls = Object.values(yard!.buildingdata as BuildingDataMap).filter((row) => Number(row.t) === 14);
      expect(halls.length).toBe(1);
    }
    expect(infernoTribeYardOf("201")).toBeUndefined();
  });
});

describe("the Inferno yard's level", () => {
  test("its own points and its buildings at the Inferno prices", () => {
    // A Housing Bunker is priced only in the Inferno table.
    const buildingdata = { ...infernoStartBuildingData(), ...bunker(90, 2) } as BuildingDataMap;
    const value = baseValueOf(buildingdata, "inferno");
    expect(value).toBeGreaterThan(baseValueOf(buildingdata));
    expect(infernoYardLevel({ points: "0", basevalue: "0", buildingdata })).toBe(calculateBaseLevel("0", String(value)));
  });

  test("a stored value above the buildings' is kept, as Flash keeps the high-water mark", () => {
    const buildingdata = infernoStartBuildingData();
    expect(infernoYardLevel({ points: "0", basevalue: "50000000", buildingdata })).toBe(calculateBaseLevel("0", "50000000"));
  });

  test("points raise it", () => {
    const buildingdata = infernoStartBuildingData();
    expect(infernoYardLevel({ points: "40000000", basevalue: "0", buildingdata })).toBeGreaterThan(
      infernoYardLevel({ points: "0", basevalue: "0", buildingdata })
    );
  });
});

describe("respawn", () => {
  test("a wrecked tribe is back an hour after it fell", () => {
    const tribe = { destroyed: 1, destroyedAt: 1_000 };
    expect(infernoTribeRespawnAt(tribe)).toBe(4_600);
    expect(infernoTribeRespawned(tribe, 4_599)).toBe(false);
    expect(infernoTribeRespawned(tribe, 4_600)).toBe(true);
  });

  test("a standing tribe has no respawn; one wrecked with no time is back already", () => {
    expect(infernoTribeRespawnAt({ destroyed: 0 })).toBe(0);
    expect(infernoTribeRespawnAt(undefined)).toBe(0);
    expect(infernoTribeRespawned({ destroyed: 0 }, 99_999)).toBe(false);
    expect(infernoTribeRespawned({ destroyed: 1 }, 3_600)).toBe(true);
  });

  test("respawning clears the damage, the wreck and the loot given", () => {
    const tribe = {
      baseid: "214",
      tribeHealthData: { "0": 0 },
      destroyed: 1,
      destroyedAt: 5,
      damage: 80,
      looted: { r1: 100 },
    };
    respawnInfernoTribe(tribe);
    expect(tribe).toEqual({
      baseid: "214",
      tribeHealthData: {},
      destroyed: 0,
      destroyedAt: undefined,
      damage: undefined,
      looted: undefined,
      monsters: undefined,
    } as never);
  });
});

describe("what one fling carries (R11)", () => {
  test("a level 4 Housing Bunker allows 780, not the Flinger table's 640", () => {
    expect(infernoTribeFlingCapacity(bunker(1, 4), false)).toBe(780);
  });

  test("each level holds 200/300/520/780/1,140/1,820", () => {
    expect([1, 2, 3, 4, 5, 6].map((l) => infernoTribeFlingCapacity(bunker(1, l), false))).toEqual([
      200, 300, 520, 780, 1140, 1820,
    ]);
  });

  test("the best finished bunker counts; one still being built does not", () => {
    expect(infernoTribeFlingCapacity({ ...bunker(1, 2), ...bunker(2, 5) }, false)).toBe(1140);
    expect(infernoTribeFlingCapacity({ ...bunker(1, 2), ...bunker(2, 1, { cB: 900 }) }, false)).toBe(300);
    expect(infernoTribeFlingCapacity(bunker(2, 1, { cB: 900 }), false)).toBe(0);
    expect(infernoTribeFlingCapacity({}, false)).toBe(0);
  });

  test("Declare War adds a quarter", () => {
    expect(infernoTribeFlingCapacity(bunker(1, 4), true)).toBe(975);
  });
});

describe("the Under Hall win", () => {
  const buildingdata = infernoTribeYardOf("214")!.buildingdata as BuildingDataMap;

  test("won when the Under Hall is at 0", () => {
    expect(underHallFallen(buildingdata, { "0": 0, "1": 300 })).toBe(true);
  });

  test("not while it stands, however much else fell", () => {
    const allButHall = Object.fromEntries(Object.keys(buildingdata).map((id) => [id, 0]));
    expect(underHallFallen(buildingdata, { ...allButHall, "0": 1 })).toBe(false);
    expect(underHallFallen(buildingdata, {})).toBe(false);
    expect(underHallFallen(buildingdata, null)).toBe(false);
  });
});
