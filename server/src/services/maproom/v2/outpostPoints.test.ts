import { describe, expect, test } from "bun:test";
import { OUTPOST_COSTS, OUTPOST_TRAITS } from "../../../game-data/buildingCosts.js";
import { STARTER_KITS } from "../../../game-data/starterKits.js";
import type { BuildingData, BuildingDataMap } from "../../../types/BuildingData.js";
import { kitBuildings } from "../../yard/starterKit.js";
import { buildingSum, countsOnBoard, netOutpostPoints, outpostPoints, outpostSum, tallyOutposts } from "./outpostPoints.js";
import { buildingValue, outpostValue } from "./outpostValue.js";

/**
 * The leaderboard's outpost points (beta 8, owner 17 Nov 2026): every cost
 * step a building climbed, plus every fortify step, summed as
 * `time + r1 + r2 + r3 + r4`, then `ceil(S / 3)` per outpost.
 */

const building = (t: number, extra: Partial<BuildingData> = {}): BuildingData =>
  ({ id: 0, x: 0, y: 0, t, ...extra }) as BuildingData;
const yard = (...buildings: BuildingData[]): BuildingDataMap =>
  Object.fromEntries(buildings.map((one, i) => [String(i + 1), { ...one, id: i + 1 }]));

const stepSum = (type: number, level: number): number => {
  const [r1, r2, r3, r4, time] = OUTPOST_COSTS[type]!.costs[level - 1]!;
  return time + r1 + r2 + r3 + r4;
};
const fortStepSum = (type: number, level: number): number => {
  const [r1, r2, r3, r4, time] = OUTPOST_TRAITS[type]!.fortify[level - 1]!;
  return time + r1 + r2 + r3 + r4;
};

const CANNON = 20;
const kitByName = (name: string) => STARTER_KITS.find((kit) => kit.name === name)!;

describe("the Starter Kits (owner's figures)", () => {
  // S, then ceil(S / 3), for each whole kit as `kitBuildings` lays it down.
  // The brief's S figures (38,469,280 / 197,841,450 / 897,816,490) were
  // worked back from `ceil(S / 10) * 10`, so each was a few units high; these
  // are the exact sums.
  const FIGURES = [
    { name: "Regular Kit", sum: 38_469_272, points: 12_823_091, fortify: 0 },
    { name: "Mega Kit", sum: 197_841_446, points: 65_947_149, fortify: 0 },
    { name: "Ultra Kit", sum: 897_816_486, points: 299_272_162, fortify: 66_336_400 },
  ];

  for (const { name, sum, points, fortify } of FIGURES) {
    for (const pay of ["resources", "shiny"] as const) {
      test(`${name} paid with ${pay}: S ${sum.toLocaleString("en")}, ${points.toLocaleString("en")} points`, () => {
        const { buildingdata } = kitBuildings(kitByName(name), pay, {});
        expect(outpostSum(buildingdata)).toBe(sum);
        expect(outpostPoints(buildingdata)).toBe(points);
        const fortPart = Object.values(buildingdata).reduce((all, one) => all + buildingSum(one).fortify, 0);
        expect(fortPart).toBe(fortify);
      });
    }
  }

  test("the resource-paid kit is prefabs mid-countdown, and still counts in full", () => {
    const { buildingdata } = kitBuildings(kitByName("Ultra Kit"), "resources", {});
    const running = Object.values(buildingdata).filter((one) => Number(one.cB) > 0 && Number(one.prefab) > 0);
    expect(running.length).toBeGreaterThan(10);
    expect(outpostPoints(buildingdata)).toBe(299_272_162);
  });

  test("rounds up once per outpost, never per building", () => {
    // Regular and Mega leave two thirds over and round up; Ultra divides exactly.
    expect(38_469_272 / 3).toBeCloseTo(12_823_090.667, 2);
    expect(197_841_446 / 3).toBeCloseTo(65_947_148.667, 2);
    expect(897_816_486 % 3).toBe(0);
    const perBuilding = (bd: BuildingDataMap) =>
      Object.values(bd).reduce((all, one) => {
        const part = buildingSum(one);
        return all + Math.ceil((part.build + part.fortify) / 3);
      }, 0);
    const regular = kitBuildings(kitByName("Regular Kit"), "shiny", {}).buildingdata;
    expect(perBuilding(regular)).toBeGreaterThan(outpostPoints(regular));
  });

  test("points per resource spent: Ultra > Mega > Regular", () => {
    // The kits' prices in resources (twigs + pebbles + putty).
    const price = (name: string) => {
      const { r1, r2, r3 } = kitByName(name).resources;
      return r1 + r2 + r3;
    };
    expect(price("Regular Kit")).toBe(30_000_000);
    expect(price("Mega Kit")).toBe(125_000_000);
    expect(price("Ultra Kit")).toBe(500_000_000);
    const rate = (name: string) => outpostPoints(kitBuildings(kitByName(name), "resources", {}).buildingdata) / price(name);
    expect(rate("Ultra Kit")).toBeGreaterThan(rate("Mega Kit"));
    expect(rate("Mega Kit")).toBeGreaterThan(rate("Regular Kit"));
  });
});

describe("buildingSum", () => {
  test("adds every cost step from level 1 up to the building's level", () => {
    const expected = stepSum(CANNON, 1) + stepSum(CANNON, 2) + stepSum(CANNON, 3);
    expect(buildingSum(building(CANNON, { l: 3 }))).toEqual({ build: expected, fortify: 0 });
  });

  test("adds every fortify step up to its fortification level", () => {
    const fortify = fortStepSum(CANNON, 1) + fortStepSum(CANNON, 2);
    expect(fortify).toBeGreaterThan(0);
    expect(buildingSum(building(CANNON, { l: 1, fort: 2 }))).toEqual({ build: stepSum(CANNON, 1), fortify });
  });

  test("a prefab mid-countdown counts at its kit level at once", () => {
    const prefab = buildingSum(building(CANNON, { l: 1, prefab: 5, cB: 9_000 }));
    expect(prefab).toEqual(buildingSum(building(CANNON, { l: 5 })));
  });

  test("damaged and destroyed buildings still count", () => {
    const whole = buildingSum(building(CANNON, { l: 4 }));
    expect(buildingSum(building(CANNON, { l: 4, hp: 0 }))).toEqual(whole);
    expect(buildingSum(building(CANNON, { l: 4, hp: 12 }))).toEqual(whole);
  });

  test("decorations, enemies and traps add nothing, as in outpostValue", () => {
    for (const type of [24, 27, 28, 117]) {
      expect(["trap", "enemy", "decoration"]).toContain(OUTPOST_COSTS[type]!.kind);
      expect(buildingSum(building(type, { l: 1 }))).toEqual({ build: 0, fortify: 0 });
    }
  });

  test("types 53 and 54, a missing type and junk add nothing", () => {
    expect(buildingSum(building(53, { l: 1 }))).toEqual({ build: 0, fortify: 0 });
    expect(buildingSum(building(54, { l: 1 }))).toEqual({ build: 0, fortify: 0 });
    expect(buildingSum(building(0))).toEqual({ build: 0, fortify: 0 });
    expect(buildingSum(null)).toEqual({ build: 0, fortify: 0 });
  });

  test("a legacy Stone Block is a level 2 Block", () => {
    expect(buildingSum(building(18, { l: 9 }))).toEqual({ build: stepSum(17, 1) + stepSum(17, 2), fortify: 0 });
  });

  test("the core counts at level 1 whatever it stores", () => {
    expect(buildingSum(building(112, { l: 7 }))).toEqual({ build: stepSum(112, 1), fortify: 0 });
  });

  test("matches outpostValue's one step at level 1, building by building", () => {
    for (const type of Object.keys(OUTPOST_COSTS).map(Number)) {
      const one = building(type, { l: 1 });
      expect(buildingSum(one).build).toBe(buildingValue(one));
    }
  });
});

describe("outpostPoints", () => {
  test("a bare outpost, its core alone, adds next to nothing", () => {
    expect(outpostPoints(yard(building(112, { l: 1 })))).toBe(Math.ceil(stepSum(112, 1) / 3));
    expect(outpostPoints(yard(building(112, { l: 1 })))).toBeLessThan(10);
  });

  test("an empty outpost is 0", () => {
    expect(outpostPoints({})).toBe(0);
    expect(outpostPoints(null)).toBe(0);
  });

  test("leaves Flash's takeover value alone (it reads one step, these read all)", () => {
    const buildingdata = yard(building(112, { l: 1 }), building(CANNON, { l: 6 }));
    expect(outpostValue(buildingdata)).toBe(Math.ceil((stepSum(112, 1) + stepSum(CANNON, 6)) * 0.1));
    expect(outpostSum(buildingdata)).toBeGreaterThan(stepSum(112, 1) + stepSum(CANNON, 6));
  });
});

describe("tallyOutposts", () => {
  test("adds each owner's outposts up, rounding each outpost on its own", () => {
    const regular = kitBuildings(kitByName("Regular Kit"), "resources", {}).buildingdata;
    const tally = tallyOutposts([
      { userid: "7", buildingdata: regular },
      { userid: 7, buildingdata: JSON.stringify(regular) },
      { userid: 9, buildingdata: null },
    ]);
    expect(tally.get(7)).toEqual({ count: 2, points: 2 * 12_823_091 });
    expect(tally.get(9)).toEqual({ count: 1, points: 0 });
    expect(tally.get(8)).toBeUndefined();
  });
});

describe("counted once (patch 8.1)", () => {
  const regular = () => kitBuildings(kitByName("Regular Kit"), "resources", {}).buildingdata;

  test("an outpost's board points are its points less the main points it paid, never below 0", () => {
    expect(netOutpostPoints(regular(), 0)).toBe(12_823_091);
    expect(netOutpostPoints(regular(), 823_091)).toBe(12_000_000);
    expect(netOutpostPoints(regular(), "823091")).toBe(12_000_000);
    expect(netOutpostPoints(regular(), 99_000_000)).toBe(0);
    // Missing or junk reads as nothing paid.
    expect(netOutpostPoints(regular(), null)).toBe(12_823_091);
    expect(netOutpostPoints(regular(), undefined)).toBe(12_823_091);
    expect(netOutpostPoints(regular(), "x")).toBe(12_823_091);
    expect(netOutpostPoints(regular(), -5)).toBe(12_823_091);
  });

  test("the tally floors each outpost on its own: one that paid more than it counts takes nothing off another", () => {
    const tally = tallyOutposts([
      { userid: 7, buildingdata: regular(), mainpointsearned: 99_000_000 },
      { userid: 7, buildingdata: regular(), mainpointsearned: "2823091" },
      { userid: 7, buildingdata: JSON.stringify(regular()) },
    ]);
    expect(tally.get(7)).toEqual({ count: 3, points: 0 + 10_000_000 + 12_823_091 });
  });

  test("traps, decorations and junk do not count on the board; buildings, walls and the core do", () => {
    for (const type of [1, 14, 15, 17, 18, 20, 112, 118]) expect(countsOnBoard(type)).toBe(true);
    for (const type of [24, 117, 28, 27, 53, 54, 0, Number.NaN]) expect(countsOnBoard(type)).toBe(false);
  });
});
