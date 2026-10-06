import { describe, expect, test } from "bun:test";
import { housingSpace } from "../../game-data/monsterCatalogue.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { housingCapacity } from "./housing.js";
import { planRecycle, type RecycleSave } from "./recycle.js";

const NOW = 1_800_000_000;

const building = (id: number, t: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t,
  x: 0,
  y: 0,
  ...extra,
});

/** A Town Hall 10 and whatever else; every resource empty, a big storage cap. */
const yardOf = (buildings: BuildingData[], extra: Partial<RecycleSave> = {}): RecycleSave => ({
  buildingdata: Object.fromEntries(
    [building(0, 14, { l: 10 }), ...buildings].map((one) => [String(one.id), one])
  ) as BuildingDataMap,
  buildinghealthdata: {},
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
  storedata: {},
  monsters: {},
  academy: {},
  lockerdata: {},
  champion: [],
  researchdata: {},
  ...extra,
});

/** The refusal's `reason`, or null when nothing was thrown. */
const reasonOf = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (err) {
    return (err as { data?: { reason?: string } }).data?.reason;
  }
  return null;
};

describe("planRecycle: what comes back", () => {
  test("half of every level paid, floored, and the building gone from both maps", () => {
    // Twig Snapper level 2: 750 + 1,575 pebbles paid, half is 1,162.
    const save = yardOf([building(1, 1, { l: 2, hp: 30 })], { buildinghealthdata: { "1": 30 } });
    const plan = planRecycle(save, 1, NOW);
    expect(plan.credit).toEqual({ r1: 0, r2: 1162, r3: 0, r4: 0 });
    expect(plan.report.refund).toEqual({ r1: 0, r2: 1162, r3: 0, r4: 0 });
    expect(plan.report.lost).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(plan.slices.buildingdata["1"]).toBeUndefined();
    expect(plan.slices.buildingdata["0"]).toBeDefined();
    expect(plan.slices.buildinghealthdata).toEqual({});
  });

  test("the report says what the storage cap turns away", () => {
    // No silos: the cap is the base 10,000, and 9,500 pebbles are held.
    const save = yardOf([building(1, 1, { l: 2 })], { resources: { r1: 0, r2: 9_500, r3: 0, r4: 0 } });
    const plan = planRecycle(save, 1, NOW);
    expect(plan.report.refund.r2).toBe(500);
    expect(plan.report.lost.r2).toBe(662);
  });

  test("a decoration goes into storage and refunds nothing", () => {
    const save = yardOf([building(1, 28)], { researchdata: { b28: 2 } });
    const plan = planRecycle(save, 1, NOW);
    expect(plan.credit).toBeUndefined();
    expect(plan.slices.researchdata).toEqual({ b28: 3 });
    expect(plan.report.stored).toEqual({ type: 28, count: 3 });
  });

  test("a totem keeps its level in storage", () => {
    const plan = planRecycle(yardOf([building(1, 121, { l: 4 })]), 1, NOW);
    expect(plan.slices.researchdata).toEqual({ b121: 1, bl121: 4 });
  });

  test("a taunt sign comes off for nothing", () => {
    const plan = planRecycle(yardOf([building(1, 52)]), 1, NOW);
    expect(plan.credit).toBeUndefined();
    expect(plan.report.stored).toBeNull();
    expect(plan.slices.buildingdata["1"]).toBeUndefined();
  });
});

describe("planRecycle: housing", () => {
  test("culls what no longer fits once a Housing building is gone", () => {
    const housing = [building(1, 15, { l: 1 }), building(2, 15, { l: 1 })];
    const one = housingCapacity({ buildingdata: { "1": housing[0]! } }, false, 0);
    const space = housingSpace("C1", 1)!;
    const army = Math.floor(one / space) + 3;
    const save = yardOf(housing, { monsters: { housed: { C1: army } } });

    const plan = planRecycle(save, 2, NOW);
    expect(plan.report.culled).toEqual({ C1: army - Math.floor(one / space) });
    const monsters = plan.slices.monsters as JsonObject;
    expect(monsters.housed).toEqual({ C1: Math.floor(one / space) });
    expect(monsters.space).toBe(one);
  });

  test("culls nothing, and leaves the monsters alone, when the army still fits", () => {
    const save = yardOf([building(1, 15, { l: 1 }), building(2, 15, { l: 1 })], {
      monsters: { housed: { C1: 1 } },
    });
    const plan = planRecycle(save, 2, NOW);
    expect(plan.report.culled).toEqual({});
    expect(plan.slices.monsters).toBeUndefined();
  });
});

describe("planRecycle: refusals", () => {
  test("an id not in the yard is a 400", () => {
    expect(reasonOf(() => planRecycle(yardOf([]), 42, NOW))).toBe("badRequest");
  });

  test("the Town Hall, the Map Room and a building on a job", () => {
    expect(reasonOf(() => planRecycle(yardOf([]), 0, NOW))).toBe("isTownHall");
    expect(reasonOf(() => planRecycle(yardOf([building(1, 11, { l: 2 })]), 1, NOW))).toBe("mapRoom");
    for (const job of [{ cU: 60 }, { cB: 60 }, { cF: 60 }]) {
      expect(reasonOf(() => planRecycle(yardOf([building(1, 20, { l: 3, ...job })]), 1, NOW))).toBe(
        "busy"
      );
    }
  });

  // The server places it and takes it away once it is sprung; a client can
  // never recycle it instead (`docs/design/trojan-horse.md` §7, issue #324).
  test("the Trojan Horse", () => {
    expect(reasonOf(() => planRecycle(yardOf([building(1, 27)]), 1, NOW))).toBe("trojanHorse");
  });

  test("a Champion Cage with its champion, a Chamber with frozen champions", () => {
    const cage = building(1, 114);
    expect(reasonOf(() => planRecycle(yardOf([cage], { champion: [{ t: 1, status: 0 }] }), 1, NOW))).toBe(
      "championInCage"
    );
    expect(planRecycle(yardOf([cage], { champion: [{ t: 1, status: 2 }] }), 1, NOW).report.id).toBe(1);

    const chamber = building(2, 119, { fz: JSON.stringify([{ t: 2 }]) });
    expect(reasonOf(() => planRecycle(yardOf([chamber]), 2, NOW))).toBe("championsFrozen");
    expect(
      reasonOf(() => planRecycle(yardOf([building(2, 119)], { champion: [{ t: 2, status: 1 }] }), 2, NOW))
    ).toBe("championsFrozen");
  });

  test("a Lab researching, an Academy training", () => {
    expect(reasonOf(() => planRecycle(yardOf([building(1, 116, { upg: "C5", upt: NOW + 60 })]), 1, NOW))).toBe(
      "researching"
    );
    expect(reasonOf(() => planRecycle(yardOf([building(1, 26, { upg: "C5" })]), 1, NOW))).toBe("training");
    expect(
      reasonOf(() =>
        planRecycle(yardOf([building(1, 26)], { academy: { C5: { level: 2, time: NOW + 60 } } }), 1, NOW)
      )
    ).toBe("training");
  });

  test("a Hatchery with production or a queue, an HCC with a queue", () => {
    const hatchery = building(1, 13);
    const producing = { h: [["C1", 10, [], 1]], hid: [1], hstage: [1] };
    expect(reasonOf(() => planRecycle(yardOf([hatchery], { monsters: producing }), 1, NOW))).toBe(
      "hatcheryBusy"
    );
    const queued = { h: [["", 0, [["C1", 3, 1]]]], hid: [1], hstage: [0] };
    expect(reasonOf(() => planRecycle(yardOf([hatchery], { monsters: queued }), 1, NOW))).toBe(
      "hatcheryBusy"
    );
    expect(planRecycle(yardOf([hatchery], { monsters: { h: [["", 0, []]], hid: [1], hstage: [0] } }), 1, NOW)
      .report.id).toBe(1);

    const hcc = building(2, 16);
    expect(reasonOf(() => planRecycle(yardOf([hcc], { monsters: { hcc: [["C1", 2, 1]] } }), 2, NOW))).toBe(
      "hatcheryBusy"
    );
  });

  test("the Monster Locker while an unlock runs", () => {
    const locker = building(1, 8);
    expect(
      reasonOf(() => planRecycle(yardOf([locker], { lockerdata: { C5: { t: 1, s: NOW, e: NOW + 60 } } }), 1, NOW))
    ).toBe("unlocking");
    expect(planRecycle(yardOf([locker], { lockerdata: { C5: { t: 2 } } }), 1, NOW).report.id).toBe(1);
  });
});
