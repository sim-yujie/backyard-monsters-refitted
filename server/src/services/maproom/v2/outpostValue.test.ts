import { describe, expect, test } from "bun:test";
import { OUTPOST_COSTS, OUTPOST_TRAITS } from "../../../game-data/buildingCosts.js";
import { STARTER_KITS } from "../../../game-data/starterKits.js";
import type { BuildingData, BuildingDataMap } from "../../../types/BuildingData.js";
import { kitBuildings } from "../../yard/starterKit.js";
import { outpostValue } from "./outpostValue.js";
import { quoteTakeover, takeoverResourceCost } from "./takeoverCost.js";

/**
 * `BASE.CalcBaseValue` on an outpost (`client/scripts/BASE.as:4830-4862`),
 * then the takeover price `PopupTakeover.as:50-57` makes of it. Step sums are
 * `time + r1 + r2 + r3 + r4` of the outpost table's `costs[level - 1]`.
 */

const building = (t: number, extra: Partial<BuildingData> = {}): BuildingData =>
  ({ id: 0, x: 0, y: 0, t, ...extra }) as BuildingData;
const yard = (...buildings: BuildingData[]): BuildingDataMap =>
  Object.fromEntries(buildings.map((one, i) => [String(i + 1), { ...one, id: i + 1 }]));

const CORE = building(112, { l: 1 }); // step 10 seconds, nothing else
const CANNON_10 = 31_600_000 + 23_700_000 + 1_562_500 + 475_200; // 57,337,700
const CANNON_1 = 2000 + 1500 + 500 + 30;
const TWIG_8 = 135_000 + 86_400;

/** The price of an outpost of this value, nowhere near the main yard, no Conquest. */
const price = (empireValue: number) =>
  takeoverResourceCost({ isWildMonster: false, level: 0, empireValue, adjacentToMainYard: false, conquestActive: false });

const kit = (index: number) => kitBuildings(STARTER_KITS[index]!, "resources", {}).buildingdata;

describe("outpostValue", () => {
  test("nothing stored is worth 0; the core alone is ceil(10 x 0.1) = 1", () => {
    expect(outpostValue(null)).toBe(0);
    expect(outpostValue(undefined)).toBe(0);
    expect(outpostValue({})).toBe(0);
    expect(outpostValue(yard(CORE))).toBe(1);
  });

  test("each building adds the step that reached its level, the total a tenth, rounded up", () => {
    expect(outpostValue(yard(CORE, building(20, { l: 10 })))).toBe(Math.ceil((10 + CANNON_10) * 0.1));
    expect(outpostValue(yard(building(20, { l: 1 }), building(1, { l: 8 })))).toBe(Math.ceil((CANNON_1 + TWIG_8) * 0.1));
  });

  test("decorations, traps and the Horsey count for nothing; a Simple Sign (taunt) counts", () => {
    const bare = outpostValue(yard(CORE, building(20, { l: 10 })));
    const dressed = yard(
      CORE,
      building(20, { l: 10 }),
      building(24, { l: 1 }), // Booby Trap, 3,005
      building(117, { l: 1 }), // Heavy Trap
      building(55, { l: 1 }), // Acorn
      building(100, { l: 1 }), // Eiffel Tower
      building(127, { l: 1 }) // Horsey (enemy)
    );
    expect(outpostValue(dressed)).toBe(bare);
    expect(outpostValue(yard(CORE, building(20, { l: 10 }), building(52, { l: 1 })))).toBe(
      Math.ceil((10 + CANNON_10 + 400_000) * 0.1)
    );
  });

  test("a building still being built counts, at level 1 or at its prefab level", () => {
    // Placed and counting down: no level yet, which loads as 1.
    expect(outpostValue(yard(building(20, { cB: 30 })))).toBe(Math.ceil(CANNON_1 * 0.1));
    expect(outpostValue(yard(building(20, { l: 0, cB: 30 })))).toBe(Math.ceil(CANNON_1 * 0.1));
    // A Starter Kit prefab is its kit level from the start (BFOUNDATION.as:3053-3056).
    expect(outpostValue(yard(building(20, { l: 10, prefab: 10, cB: 999_999 })))).toBe(Math.ceil(CANNON_10 * 0.1));
    expect(outpostValue(yard(building(20, { prefab: 10, cB: 999_999 })))).toBe(Math.ceil(CANNON_10 * 0.1));
  });

  test("an upgrade in progress counts the level it is at, not the one it is going to", () => {
    expect(outpostValue(yard(building(1, { l: 8, cU: 3600 })))).toBe(Math.ceil(TWIG_8 * 0.1));
  });

  test("odd rows: the core is always level 1, a negative level counts as 1, a level past the table adds nothing", () => {
    expect(outpostValue(yard(building(112, { l: 5 })))).toBe(1);
    expect(outpostValue(yard(building(20, { l: -3 })))).toBe(Math.ceil(CANNON_1 * 0.1));
    expect(outpostValue(yard(building(20, { l: 11 })))).toBe(0);
  });

  test("odd rows: types the outpost table has no costs for, and 53/54, add nothing; a Stone Block is a level 2 Block", () => {
    expect(outpostValue(yard(building(6, { l: 5 }), building(53), building(54), building(9999), building(0)))).toBe(0);
    expect(outpostValue(yard(building(18, { l: 1 })))).toBe(Math.ceil((10_000 + 5) * 0.1));
    expect(outpostValue({ a: null as unknown as BuildingData, b: "x" as unknown as BuildingData })).toBe(0);
  });

  test("the three Starter Kits, fresh: Regular 10,000,000, Mega 34,250,000, Ultra 50,500,000 of each", () => {
    expect(outpostValue(kit(0))).toBe(3_222_316);
    expect(outpostValue(kit(1))).toBe(14_937_323);
    expect(outpostValue(kit(2))).toBe(41_497_094);
    expect(price(outpostValue(kit(0)))).toBe(10_000_000);
    expect(price(outpostValue(kit(1)))).toBe(34_250_000);
    expect(price(outpostValue(kit(2)))).toBe(50_500_000);
    // Paid with Shiny the kit is finished at once, at the same levels.
    expect(outpostValue(kitBuildings(STARTER_KITS[2]!, "shiny", {}).buildingdata)).toBe(41_497_094);
  });

  test("a built-up outpost: four level 10 Cannons is 41,000,000; everything at its cap and top level 63,500,000", () => {
    const cannons = yard(CORE, ...Array.from({ length: 4 }, () => building(20, { l: 10 })));
    expect(outpostValue(cannons)).toBe(22_935_081);
    expect(price(22_935_081)).toBe(41_000_000);

    const maxed: BuildingData[] = [CORE];
    for (const [type, row] of Object.entries(OUTPOST_COSTS)) {
      if (Number(type) === 112 || OUTPOST_TRAITS[Number(type)]?.blocked) continue;
      if (["decoration", "enemy", "immovable", "trap"].includes(row.kind)) continue;
      for (let i = 0; i < (row.quantity[1] ?? 0); i++) maxed.push(building(Number(type), { l: row.costs.length }));
    }
    expect(outpostValue(yard(...maxed))).toBe(95_531_750);
    expect(price(95_531_750)).toBe(63_500_000);
  });
});

describe("quoteTakeover prices a player outpost from its buildings", () => {
  const cell = { x: 100, y: 100 };
  const quote = (buildingdata: BuildingDataMap | null, isWildMonster = false) =>
    quoteTakeover({ cell, isWildMonster, buildingdata, takerHomebase: ["10", "10"], conquestActive: false });

  test("the quote is the formula's price of outpostValue", () => {
    for (const buildingdata of [kit(0), kit(1), kit(2), {}]) {
      expect(quote(buildingdata).resources).toBe(price(outpostValue(buildingdata)));
    }
    expect(quote(null).resources).toBe(1_000_000);
  });

  test("a wild camp ignores whatever buildings it has: its price is its level's", () => {
    expect(quote(kit(2), true)).toEqual(quote(null, true));
  });
});
