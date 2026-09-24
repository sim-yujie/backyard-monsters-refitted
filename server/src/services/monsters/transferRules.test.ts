import { describe, expect, test } from "bun:test";
import {
  HOUSING_BUNKER_BUILDING_TYPE,
  HOUSING_BUILDING_TYPE,
  badQuantities,
  checkMonsterTransfer,
  deriveHousingCapacity,
  housedCounts,
  housingUsed,
  monsterStorage,
  productionAllowance,
  queuedProduction,
  type TransferInput,
  type TransferYard,
} from "./transferRules.js";
import { BaseType } from "../../enums/Base.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";

/**
 * Issue #27. The rules are pure, so the whole decision is testable without a
 * database or a request: four monster rosters, two capacities and a verdict.
 *
 * The numbers in the housing tests are the real yard the dev server carries —
 * four level-6 Monster Housings, 2,160 space, `C14 × 25` and `C15 × 2` housed —
 * which is also what its stored `monsters.space` says, so the derivation is
 * checked against the client's own figure rather than against itself.
 */

const housing = (id: number, level: number): BuildingDataMap[string] => ({
  x: 0,
  y: 0,
  t: HOUSING_BUILDING_TYPE,
  id,
  l: level,
});

const yard = (overrides: Partial<TransferYard> = {}): TransferYard => ({
  baseid: "1001",
  type: BaseType.MAIN,
  stored: { housed: {} },
  capacity: 2160,
  ...overrides,
});

const transfer = (overrides: Partial<TransferInput> = {}): TransferInput => ({
  from: yard({ baseid: "1001", type: BaseType.MAIN }),
  to: yard({ baseid: "2002", type: BaseType.OUTPOST }),
  fromBlob: { housed: {} },
  toBlob: { housed: {} },
  ...overrides,
});

/** A main yard holding `housed`, and an empty outpost with `capacity` space. */
const move = (
  storedFrom: Record<string, number>,
  storedTo: Record<string, number>,
  nextFrom: Record<string, number>,
  nextTo: Record<string, number>,
  overrides: Partial<TransferInput> = {}
) =>
  checkMonsterTransfer(
    transfer({
      from: yard({ baseid: "1001", type: BaseType.MAIN, stored: { housed: storedFrom } }),
      to: yard({ baseid: "2002", type: BaseType.OUTPOST, stored: { housed: storedTo } }),
      fromBlob: { housed: nextFrom },
      toBlob: { housed: nextTo },
      ...overrides,
    })
  );

describe("monsterStorage", () => {
  test("reads cStorage for the monster", () => {
    expect(monsterStorage("C14")).toBe(70);
    expect(monsterStorage("C15")).toBe(200);
  });

  test("follows the Academy level where cStorage varies by it", () => {
    expect(monsterStorage("C1")).toBe(10);
    expect(monsterStorage("C1", { C1: 6 })).toBe(7);
  });

  test("clamps a level past the end of the table, like CREATURES.GetProperty", () => {
    expect(monsterStorage("C1", { C1: 99 })).toBe(7);
    expect(monsterStorage("C1", { C1: 0 })).toBe(10);
  });

  test("costs nothing for a monster id the server does not know", () => {
    expect(monsterStorage("NOPE")).toBe(0);
  });
});

describe("housingUsed", () => {
  test("sums cStorage times count", () => {
    expect(housingUsed({ C14: 25, C15: 2 })).toBe(25 * 70 + 2 * 200);
  });
});

describe("housedCounts", () => {
  test("reads the housed map and drops zeroes", () => {
    expect(housedCounts({ housed: { C1: 3, C4: 0 } })).toEqual({ C1: 3 });
  });

  test("returns nothing for a blob with no usable housed map", () => {
    expect(housedCounts(null)).toEqual({});
    expect(housedCounts({})).toEqual({});
    expect(housedCounts({ housed: [] })).toEqual({});
  });
});

describe("badQuantities", () => {
  test("accepts non-negative whole numbers", () => {
    expect(badQuantities({ housed: { C1: 0, C4: 12 } })).toEqual([]);
  });

  test("names fractional and negative counts", () => {
    expect(badQuantities({ housed: { C1: 1.5, C4: -2, C5: 3 } })).toEqual(["C1", "C4"]);
  });

  test("rejects a housed field that is not an object", () => {
    expect(badQuantities({ housed: "C1" })).toEqual(["housed"]);
  });

  test("accepts a blob with no housed field at all", () => {
    expect(badQuantities({})).toEqual([]);
  });
});

describe("queuedProduction", () => {
  test("counts the monster in production, the hatchery queue and the HCC queue", () => {
    const blob = {
      hcount: 2,
      h: [
        ["C1", 9, [["C1", 20]]],
        ["C4", 300],
      ],
      hcc: [["C4", 7]],
    };

    expect(queuedProduction(blob)).toEqual({ C1: 21, C4: 8 });
  });

  test("ignores idle hatcheries and empty queues", () => {
    const blob = { h: [["", 2373, []], ["", 2380, []]], hcc: [] };

    expect(queuedProduction(blob)).toEqual({});
  });

  test("survives a blob with no hatchery fields", () => {
    expect(queuedProduction({ housed: { C1: 1 } })).toEqual({});
  });
});

describe("productionAllowance", () => {
  test("caps the queue at what the yard could house", () => {
    const stored = { h: [["C15", 10, [["C15", 500]]]], hcc: [] };

    // 2,160 space / 200 each is ten Zafreeti, however long the queue claims to be.
    expect(productionAllowance(yard({ stored }))).toEqual({ C15: 10 });
  });

  test("is nothing when the yard has no housing at all", () => {
    const stored = { h: [["C1", 5, [["C1", 3]]]], hcc: [] };

    expect(productionAllowance(yard({ stored, capacity: 0 }))).toEqual({ C1: 0 });
  });
});

describe("deriveHousingCapacity", () => {
  test("matches the dev server's stored space for four level-6 housings", () => {
    const buildingData: BuildingDataMap = {
      "82": housing(82, 6),
      "584": housing(584, 6),
      "585": housing(585, 6),
      "586": housing(586, 6),
      "83": { x: 0, y: 0, t: 22, id: 83 },
    };

    expect(deriveHousingCapacity({ buildingData })).toBe(2160);
  });

  test("skips a housing building that has not finished building", () => {
    const buildingData: BuildingDataMap = {
      "1": housing(1, 6),
      "2": { ...housing(2, 6), cB: 120 },
    };

    expect(deriveHousingCapacity({ buildingData })).toBe(540);
  });

  test("houses at the old level while an upgrade is still running", () => {
    const buildingData: BuildingDataMap = { "1": { ...housing(1, 3), cU: 900 } };

    expect(deriveHousingCapacity({ buildingData })).toBe(320);
  });

  test("clamps a Map Room 3 level to the Map Room 2 maximum of 6", () => {
    const buildingData: BuildingDataMap = { "1": housing(1, 10) };

    expect(deriveHousingCapacity({ buildingData })).toBe(540);
  });

  test("drops a housing building at or below 10 health", () => {
    const buildingData: BuildingDataMap = { "1": housing(1, 6), "2": housing(2, 6) };

    expect(deriveHousingCapacity({ buildingData, healthData: { "2": 0 } })).toBe(540);
    expect(deriveHousingCapacity({ buildingData, healthData: { "2": 11 } })).toBe(1080);
  });

  test("applies the Housing Expansion multiplier per building", () => {
    const buildingData: BuildingDataMap = { "1": housing(1, 6), "2": housing(2, 6) };

    expect(deriveHousingCapacity({ buildingData, housingExpansionActive: true })).toBe(1350);
  });

  test("reads the Housing Bunker table on an Inferno yard", () => {
    const buildingData: BuildingDataMap = {
      "1": { x: 0, y: 0, t: HOUSING_BUNKER_BUILDING_TYPE, id: 1, l: 6 },
    };

    expect(deriveHousingCapacity({ buildingData, inferno: true })).toBe(1820);
  });

  test("is nothing for a fresh outpost, whose buildingdata is empty", () => {
    expect(deriveHousingCapacity({ buildingData: {} })).toBe(0);
    expect(deriveHousingCapacity({ buildingData: null })).toBe(0);
  });
});

describe("checkMonsterTransfer — endpoints", () => {
  test("accepts a main yard sending to an outpost", () => {
    expect(move({ C4: 10 }, {}, { C4: 4 }, { C4: 6 }).ok).toBe(true);
  });

  test("accepts an outpost sending back to the main yard", () => {
    const verdict = move(
      { C4: 10 },
      {},
      { C4: 4 },
      { C4: 6 },
      {
        from: yard({ baseid: "2002", type: BaseType.OUTPOST, stored: { housed: { C4: 10 } } }),
        to: yard({ baseid: "1001", type: BaseType.MAIN, stored: { housed: {} } }),
        fromBlob: { housed: { C4: 4 } },
        toBlob: { housed: { C4: 6 } },
      }
    );

    expect(verdict.ok).toBe(true);
  });

  test("refuses a yard sending to itself", () => {
    const verdict = checkMonsterTransfer(
      transfer({ to: yard({ baseid: "1001", type: BaseType.OUTPOST }) })
    );

    expect(verdict).toMatchObject({ ok: false, rule: "endpoints" });
  });

  test("refuses main to main, since one end has to be an outpost", () => {
    const verdict = checkMonsterTransfer(
      transfer({ to: yard({ baseid: "2002", type: BaseType.MAIN }) })
    );

    expect(verdict).toMatchObject({ ok: false, rule: "endpoints" });
  });

  test("refuses a wild monster camp as an endpoint", () => {
    const verdict = checkMonsterTransfer(
      transfer({ to: yard({ baseid: "2002", type: BaseType.TRIBE }) })
    );

    expect(verdict).toMatchObject({ ok: false, rule: "endpoints" });
  });
});

describe("checkMonsterTransfer — quantities", () => {
  test("refuses a fractional count", () => {
    expect(move({ C4: 10 }, {}, { C4: 4.5 }, { C4: 5.5 })).toMatchObject({
      ok: false,
      rule: "quantities",
    });
  });

  test("refuses a negative count", () => {
    expect(move({ C4: 10 }, {}, { C4: -5 }, { C4: 15 })).toMatchObject({
      ok: false,
      rule: "quantities",
    });
  });
});

describe("checkMonsterTransfer — holdings", () => {
  test("refuses sending more monsters than the source holds", () => {
    expect(move({ C4: 3 }, {}, {}, { C4: 30 })).toMatchObject({
      ok: false,
      rule: "conservation",
    });
  });

  test("refuses a source that ends up holding more than it could have", () => {
    expect(move({ C4: 3 }, { C4: 20 }, { C4: 10 }, { C4: 13 })).toMatchObject({
      ok: false,
      rule: "holdings",
      detail: { monster: "C4", claimed: 10, held: 3 },
    });
  });

  test("refuses a monster type the source never had", () => {
    expect(move({ C4: 3 }, {}, { C4: 3 }, { C12: 1 })).toMatchObject({
      ok: false,
      rule: "conservation",
    });
  });
});

describe("checkMonsterTransfer — conservation", () => {
  test("refuses totals that do not add up", () => {
    expect(move({ C4: 10 }, { C4: 2 }, { C4: 10 }, { C4: 12 })).toMatchObject({
      ok: false,
      rule: "conservation",
      detail: { monster: "C4", before: 12, after: 22 },
    });
  });

  test("allows losing monsters, which is what a partial client blob looks like", () => {
    expect(move({ C4: 10 }, {}, { C4: 4 }, { C4: 5 }).ok).toBe(true);
  });

  test("allows the monsters the map finished locally from the stored queue", () => {
    const stored = { housed: { C1: 2 }, h: [["C1", 9, [["C1", 20]]]], hcc: [] };

    const verdict = checkMonsterTransfer(
      transfer({
        from: yard({ baseid: "1001", type: BaseType.MAIN, stored }),
        fromBlob: { housed: { C1: 0 } },
        toBlob: { housed: { C1: 23 } },
      })
    );

    expect(verdict.ok).toBe(true);
  });

  test("still refuses more than the stored queue could ever finish", () => {
    const stored = { housed: { C1: 2 }, h: [["C1", 9, [["C1", 20]]]], hcc: [] };

    const verdict = checkMonsterTransfer(
      transfer({
        from: yard({ baseid: "1001", type: BaseType.MAIN, stored }),
        fromBlob: { housed: { C1: 0 } },
        toBlob: { housed: { C1: 24 } },
      })
    );

    expect(verdict).toMatchObject({ ok: false, rule: "conservation" });
  });
});

describe("checkMonsterTransfer — capacity", () => {
  test("refuses a destination that cannot house the result", () => {
    const verdict = move({ C15: 20 }, {}, { C15: 9 }, { C15: 11 }, {
      to: yard({ baseid: "2002", type: BaseType.OUTPOST, stored: { housed: {} }, capacity: 2000 }),
    });

    expect(verdict).toMatchObject({
      ok: false,
      rule: "capacity",
      detail: { used: 2200, capacity: 2000 },
    });
  });

  test("accepts a destination filled exactly to capacity", () => {
    const verdict = move({ C15: 20 }, {}, { C15: 10 }, { C15: 10 }, {
      to: yard({ baseid: "2002", type: BaseType.OUTPOST, stored: { housed: {} }, capacity: 2000 }),
    });

    expect(verdict.ok).toBe(true);
  });

  test("refuses any transfer into an outpost with no housing built yet", () => {
    const verdict = move({ C4: 10 }, {}, { C4: 9 }, { C4: 1 }, {
      to: yard({ baseid: "2002", type: BaseType.OUTPOST, stored: {}, capacity: 0 }),
    });

    expect(verdict).toMatchObject({ ok: false, rule: "capacity" });
  });

  test("measures the destination at the caller's Academy level", () => {
    const from = yard({ baseid: "1001", type: BaseType.MAIN, stored: { housed: { C1: 300 } } });
    const to = yard({ baseid: "2002", type: BaseType.OUTPOST, stored: { housed: {} }, capacity: 2160 });

    const atLevelOne = checkMonsterTransfer({
      from,
      to,
      fromBlob: { housed: { C1: 80 } },
      toBlob: { housed: { C1: 220 } },
    });

    const atLevelSix = checkMonsterTransfer({
      from,
      to,
      fromBlob: { housed: { C1: 80 } },
      toBlob: { housed: { C1: 220 } },
      monsterLevels: { C1: 6 },
    });

    // 220 Pokeys cost 2,200 space at level 1 and 1,540 at level 6.
    expect(atLevelOne).toMatchObject({ ok: false, rule: "capacity" });
    expect(atLevelSix.ok).toBe(true);
  });
});
