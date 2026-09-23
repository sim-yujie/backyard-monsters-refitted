import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import {
  checkRequirements,
  parseWallIds,
  planWallUpgrade,
  type WallUpgradeSave,
} from "./wallUpgrade.js";

/**
 * The sandbox yard capture the web client's tests run against: a real 575
 * building save with 400 walls at level 1, a level 10 Town Hall, no damage and
 * resources in the billions (`docs/design/yard-planner-phase1-remainder.md`
 * §4.1).
 */
const FIXTURE = "../../../../web/test/fixtures/baseload-sandbox-yard.json";

interface Fixture {
  buildingdata: BuildingDataMap;
  buildinghealthdata: Record<string, number>;
  resources: Record<string, number>;
}

const loadFixture = (): Fixture =>
  JSON.parse(readFileSync(new URL(FIXTURE, import.meta.url), "utf8"));

/** A fresh, mutable save slice from the fixture. */
const sandbox = (): WallUpgradeSave => {
  const fixture = loadFixture();
  return {
    buildingdata: structuredClone(fixture.buildingdata),
    buildinghealthdata: structuredClone(fixture.buildinghealthdata),
    resources: structuredClone(fixture.resources),
  };
};

/** Every wall id in a yard. */
const wallIds = (buildings: BuildingDataMap): number[] =>
  Object.values(buildings)
    .filter((building) => Number(building.t) === 17)
    .map((building) => Number(building.id));

/** The error a call threw, typed, so a test can read its status and data. */
const rejection = (run: () => unknown): ClientSafeError => {
  try {
    run();
  } catch (err) {
    if (err instanceof ClientSafeError) return err;
    throw err;
  }
  throw new Error("expected planWallUpgrade to reject");
};

describe("parseWallIds", () => {
  test("reads a JSON list of ids", () => {
    expect(parseWallIds("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  test("refuses a missing field", () => {
    expect(rejection(() => parseWallIds(undefined)).status).toBe(400);
    expect(rejection(() => parseWallIds("")).status).toBe(400);
  });

  test("refuses something that is not JSON", () => {
    expect(rejection(() => parseWallIds("not json")).status).toBe(400);
  });

  test("refuses an empty list", () => {
    expect(rejection(() => parseWallIds("[]")).status).toBe(400);
  });

  test("refuses a list that is not of integers", () => {
    const err = rejection(() => parseWallIds('["7"]'));
    expect(err.data).toHaveProperty("issues");
  });

  test("refuses a repeated id", () => {
    expect(rejection(() => parseWallIds("[7, 8, 7]")).data).toMatchObject({ duplicated: [7] });
  });

  test("refuses more ids than one batch may carry", () => {
    const ids = JSON.stringify(Array.from({ length: 1201 }, (_, at) => at));
    expect(rejection(() => parseWallIds(ids)).data).toMatchObject({ ids: 1201 });
  });
});

describe("planWallUpgrade over the sandbox yard", () => {
  test("400 walls from level 1 to 5 cost 280M twigs and 284M pebbles", () => {
    const save = sandbox();
    const ids = wallIds(save.buildingdata!);
    expect(ids).toHaveLength(400);

    const plan = planWallUpgrade(save, ids, 5);

    // costs[1..4] of type 17 sum to 700,000 twigs and 710,000 pebbles per wall.
    expect(plan.cost).toEqual({ r1: 280_000_000, r2: 284_000_000, r3: 0, r4: 0 });
    expect(plan.upgraded).toBe(400);
    expect(plan.level).toBe(5);
  });

  test("points match the Flash client's Upgraded() formula, summed over every step", () => {
    const save = sandbox();
    const plan = planWallUpgrade(save, wallIds(save.buildingdata!), 5);

    // floor((time + r1 + r2 + r3 + r4) / 3) per step: 3335 + 66668 + 133335 +
    // 266668 = 470006 per wall (`client/scripts/BFOUNDATION.as:2455-2457`).
    expect(plan.points).toBe(470_006 * 400);
  });

  test("writes l on every listed wall and touches nothing else", () => {
    const save = sandbox();
    const before = structuredClone(save.buildingdata!);
    const ids = wallIds(save.buildingdata!);

    const plan = planWallUpgrade(save, ids, 5);

    for (const id of ids) {
      expect(plan.buildingdata[String(id)]).toEqual({ ...before[String(id)], t: 17, l: 5 });
    }
    for (const [key, building] of Object.entries(before)) {
      if (Number(building.t) === 17) continue;
      expect(plan.buildingdata[key]).toEqual(building);
    }
    // The caller's own map is left alone; the plan is a new object.
    expect(save.buildingdata).toEqual(before);
  });

  test("one wall to level 2 costs one step", () => {
    const save = sandbox();
    const [id] = wallIds(save.buildingdata!);

    const plan = planWallUpgrade(save, [id!], 2);

    expect(plan.cost).toEqual({ r1: 0, r2: 10_000, r3: 0, r4: 0 });
    expect(plan.upgraded).toBe(1);
    expect(plan.points).toBe(3335);
  });
});

describe("planWallUpgrade rejections", () => {
  test("unknown: an id the yard does not have", () => {
    const save = sandbox();
    const err = rejection(() => planWallUpgrade(save, [999_999], 5));
    expect(err.status).toBe(400);
    expect(err.data).toMatchObject({ unknown: [999_999] });
  });

  test("notWalls: an id whose type is not 17 or 18", () => {
    const save = sandbox();
    // Building 0 is the Town Hall.
    const err = rejection(() => planWallUpgrade(save, [0], 5));
    expect(err.status).toBe(400);
    expect(err.data).toMatchObject({ notWalls: [0] });
  });

  test("level: a target outside 2 to maxLevel(17)", () => {
    const save = sandbox();
    const [id] = wallIds(save.buildingdata!);

    for (const level of [0, 1, 6, 2.5]) {
      const err = rejection(() => planWallUpgrade(save, [id!], level));
      expect(err.status).toBe(400);
      expect(err.data).toMatchObject({ level });
    }
  });

  test("alreadyAtLevel: a wall at or above the target", () => {
    const save = sandbox();
    const [id] = wallIds(save.buildingdata!);
    save.buildingdata![String(id)]!.l = 5;

    const err = rejection(() => planWallUpgrade(save, [id!], 5));
    expect(err.status).toBe(400);
    expect(err.data).toMatchObject({ alreadyAtLevel: [id] });
  });

  test("busy: a wall with a countdown running", () => {
    for (const timer of ["cB", "cU", "cF"] as const) {
      const save = sandbox();
      const [id] = wallIds(save.buildingdata!);
      save.buildingdata![String(id)]![timer] = 5;

      const err = rejection(() => planWallUpgrade(save, [id!], 5));
      expect(err.status).toBe(400);
      expect(err.data, timer).toMatchObject({ busy: [id] });
    }
  });

  test("damaged: hp on the building, or an entry in buildinghealthdata", () => {
    const byHp = sandbox();
    const [first] = wallIds(byHp.buildingdata!);
    byHp.buildingdata![String(first)]!.hp = 10;
    expect(rejection(() => planWallUpgrade(byHp, [first!], 5)).data).toMatchObject({
      damaged: [first],
    });

    const byHealthData = sandbox();
    const [second] = wallIds(byHealthData.buildingdata!);
    byHealthData.buildinghealthdata![String(second)] = 0;
    expect(rejection(() => planWallUpgrade(byHealthData, [second!], 5)).data).toMatchObject({
      damaged: [second],
    });
  });

  test("townHall: level 5 needs a level 6 Town Hall", () => {
    const save = sandbox();
    save.buildingdata!["0"]!.l = 5;
    const [id] = wallIds(save.buildingdata!);

    const err = rejection(() => planWallUpgrade(save, [id!], 5));
    expect(err.status).toBe(409);
    expect(err.data).toMatchObject({ townHall: { have: 5, need: 6 } });
  });

  test("townHall: a yard with no hall at all", () => {
    const save = sandbox();
    delete save.buildingdata!["0"];
    const [id] = wallIds(save.buildingdata!);

    const err = rejection(() => planWallUpgrade(save, [id!], 5));
    expect(err.status).toBe(409);
    expect(err.data).toMatchObject({ townHall: { have: 0, need: 1 } });
  });

  test("shortfall names only the resources that are short", () => {
    const save = sandbox();
    save.resources!.r2 = 1_000;
    const ids = wallIds(save.buildingdata!);

    const err = rejection(() => planWallUpgrade(save, ids, 5));
    expect(err.status).toBe(409);
    expect(err.data).toMatchObject({
      shortfall: { r1: 0, r2: 284_000_000 - 1_000, r3: 0, r4: 0 },
    });
  });
});

describe("legacy type 18 walls", () => {
  test("upgrade from level 2 and come back as type 17", () => {
    const save = sandbox();
    const [id] = wallIds(save.buildingdata!);
    const key = String(id);
    save.buildingdata![key] = { ...save.buildingdata![key]!, t: 18 } as BuildingData;
    delete save.buildingdata![key]!.l;

    const plan = planWallUpgrade(save, [id!], 3);

    // costs[2] only: the level 1 to 2 step is already paid for by being a
    // Stone Block (`client/scripts/BASE.as:1523-1526`).
    expect(plan.cost).toEqual({ r1: 100_000, r2: 100_000, r3: 0, r4: 0 });
    expect(plan.buildingdata[key]).toMatchObject({ t: 17, l: 3 });
  });

  test("a type 18 row is already at level 2", () => {
    const save = sandbox();
    const [id] = wallIds(save.buildingdata!);
    save.buildingdata![String(id)]!.t = 18;

    expect(rejection(() => planWallUpgrade(save, [id!], 2)).data).toMatchObject({
      alreadyAtLevel: [id],
    });
  });
});

describe("checkRequirements", () => {
  const yard: BuildingDataMap = {
    "0": { t: 14, id: 0, l: 4 } as unknown as BuildingData,
    "1": { t: 8, id: 1, l: 2 } as unknown as BuildingData,
  };

  test("passes when every entry is met", () => {
    expect(() => checkRequirements([[14, 1, 4]], yard, 4)).not.toThrow();
    expect(() => checkRequirements([[14, 1, 4], [8, 1, 1]], yard, 4)).not.toThrow();
  });

  test("blames the Town Hall when that is the entry that failed", () => {
    const err = rejection(() => checkRequirements([[14, 1, 6]], yard, 4));
    expect(err.status).toBe(409);
    expect(err.data).toMatchObject({ townHall: { have: 4, need: 6 } });
  });

  test("requirements: any other unmet gate, and not the hall that is met", () => {
    const err = rejection(() => checkRequirements([[14, 1, 4], [8, 2, 1]], yard, 4));
    expect(err.status).toBe(409);
    expect(err.data).toMatchObject({ requirements: [[8, 2, 1]] });
  });
});
