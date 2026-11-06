import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { COSTS } from "../../game-data/buildingCosts.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { pointsForUpgrade } from "./costs.js";
import { planOneUpgrade, type OneUpgrade, type UpgradeWalkSave } from "./startUpgrades.js";

/**
 * One building's next upgrade step (`planOneUpgrade`), the rule set the
 * building panel's Upgrade button uses, against the sandbox capture the batch
 * wall route's tests use: a real 575-building save with six Cannon Towers at
 * level 1, 400 Blocks at level 1, a level 10 Town Hall, `BEW.q = 4` so five
 * workers, no damage, no countdowns and resources in the billions.
 *
 * These cases used to be read off the planner's upgrade walk, which Apply ran
 * over a layout's planned upgrades until the owner removed it (2026-11-03).
 * The walk is gone; the single-step rules it was built from are still the
 * Upgrade button's, so they are tested here directly.
 */

const FIXTURE = "../../../../web/test/fixtures/baseload-sandbox-yard.json";

/** Types the cases below name. */
const SNAPPER = 1;
const ACADEMY = 8;
const TOWN_HALL = 14;
const WALL = 17;
const CANNON = 20;
const BIRDHOUSE = 57;

/** The six Cannon Towers in the sandbox yard, in id order. */
const CANNON_IDS = [32, 33, 34, 35, 36, 37];

/** The Monster Academy the Wild Monster Baiter's second step is gated on. */
const ACADEMY_ID = 81;
const BAITER_ID = 592;
const HALL_ID = 0;

/** A fixed clock, so a Sharper Tools window is a plain arithmetic comparison. */
const NOW = 1_700_000_000;

interface Fixture {
  buildingdata: BuildingDataMap;
  buildinghealthdata: Record<string, number>;
  resources: Record<string, number>;
  storedata: JsonObject;
}

const loadFixture = (): Fixture =>
  JSON.parse(readFileSync(new URL(FIXTURE, import.meta.url), "utf8"));

/** A fresh, mutable save slice from the fixture. */
const sandbox = (): UpgradeWalkSave => {
  const fixture = loadFixture();
  return {
    buildingdata: structuredClone(fixture.buildingdata),
    buildinghealthdata: structuredClone(fixture.buildinghealthdata),
    resources: structuredClone(fixture.resources),
    storedata: structuredClone(fixture.storedata),
  };
};

/** The first Block in the yard, which is at level 1 like the other 399. */
const firstWallId = (buildings: BuildingDataMap): number =>
  Number(Object.values(buildings).find((building) => Number(building.t) === WALL)!.id);

/** One step off the generated table, so no price is retyped into a test. */
const step = (type: number, from: number) => COSTS[type]!.costs[from]!;

/** The four resource amounts of one step. */
const priceOf = (type: number, from: number) => {
  const [r1, r2, r3, r4] = step(type, from);
  return { r1, r2, r3, r4 };
};

/** A step that was taken, or a failed test naming why it was refused. */
const taken = (result: OneUpgrade) => {
  if (!result.ok) throw new Error(`expected a step, got ${result.reason}`);
  return result;
};

/** Puts the first five Cannon Towers on a job, so every worker is busy. */
const busyAll = (save: UpgradeWalkSave): void => {
  for (const id of CANNON_IDS.slice(0, 5)) {
    save.buildingdata![String(id)] = { ...save.buildingdata![String(id)]!, cU: 500 };
  }
};

describe("planOneUpgrade: a long step", () => {
  test("starts one step at the countdown the cost table names", () => {
    const save = sandbox();
    const next = taken(planOneUpgrade(save, 32, NOW));

    expect(next).toMatchObject({ id: 32, t: CANNON, from: 1, to: 2, seconds: 900, finished: false, points: 0 });
    expect(next.cost).toEqual(priceOf(CANNON, 1));
    expect(next.building).toMatchObject({ t: CANNON, cU: 900, cL: 900 });
    // The level does not move: the countdown raises it when it finishes.
    expect(next.building.l).toBeUndefined();
  });

  test("a harvester's 300-second step starts a countdown too (#137)", () => {
    const save = sandbox();
    expect(step(SNAPPER, 1)[4]).toBe(300);

    const next = taken(planOneUpgrade(save, 1, NOW));

    expect(next).toMatchObject({ from: 1, to: 2, seconds: 300, finished: false });
    expect(next.building).toMatchObject({ cU: 300 });
  });

  test("is refused when every worker is busy", () => {
    const save = sandbox();
    busyAll(save);

    expect(planOneUpgrade(save, 1, NOW)).toMatchObject({
      ok: false,
      reason: "workers",
      scope: "step",
      workers: { total: 5, busy: 5 },
    });
  });

  test("a yard with no extra workers bought has one", () => {
    const save = sandbox();
    save.storedata = {};
    save.buildingdata!["32"] = { ...save.buildingdata!["32"]!, cU: 500 };

    expect(planOneUpgrade(save, 33, NOW)).toMatchObject({
      ok: false,
      reason: "workers",
      workers: { total: 1, busy: 1 },
    });
  });
});

describe("planOneUpgrade: wall and trap steps finish at once (D13)", () => {
  test("a Block step is written at its new level, with its points", () => {
    const save = sandbox();
    const id = firstWallId(save.buildingdata!);

    const next = taken(planOneUpgrade(save, id, NOW));

    expect(next).toMatchObject({ from: 1, to: 2, seconds: 0, finished: true });
    expect(next.points).toBe(pointsForUpgrade(step(WALL, 1)));
    expect(next.cost).toEqual(priceOf(WALL, 1));
    expect(next.building).toMatchObject({ t: WALL, l: 2 });
    expect(next.building.cU).toBeUndefined();
  });

  test("needs no worker even when every worker is busy", () => {
    const save = sandbox();
    busyAll(save);

    expect(planOneUpgrade(save, firstWallId(save.buildingdata!), NOW).ok).toBe(true);
  });
});

describe("planOneUpgrade: Sharper Tools", () => {
  test("a running buff shortens the countdown by a fifth, not the price", () => {
    const save = sandbox();
    save.storedata = { ...save.storedata, BST: { e: NOW + 3600 } };

    const next = taken(planOneUpgrade(save, 32, NOW));

    expect(next.seconds).toBe(720);
    // The job keeps its shortened length too, so its bar starts at 0 (#136).
    expect(next.building).toMatchObject({ cU: 720, cL: 720 });
    expect(next.cost).toEqual(priceOf(CANNON, 1));
  });

  test("a short step under Sharper Tools is floor(300 × 0.8)", () => {
    const save = sandbox();
    save.storedata = { ...save.storedata, BST: { e: NOW + 3600 } };

    expect(taken(planOneUpgrade(save, 1, NOW)).seconds).toBe(240);
  });

  test("a buff that has expired leaves the countdown alone", () => {
    const save = sandbox();
    save.storedata = { ...save.storedata, BST: { e: NOW } };

    expect(taken(planOneUpgrade(save, 32, NOW)).seconds).toBe(900);
  });
});

describe("planOneUpgrade: refused", () => {
  test("a building with a countdown of its own is busy", () => {
    const save = sandbox();
    save.buildingdata!["32"] = { ...save.buildingdata!["32"]!, cU: 60 };

    expect(planOneUpgrade(save, 32, NOW)).toMatchObject({ ok: false, reason: "busy", scope: "building" });
  });

  test("a damaged building has to be repaired first", () => {
    const save = sandbox();
    save.buildingdata!["32"] = { ...save.buildingdata!["32"]!, hp: 10 };

    expect(planOneUpgrade(save, 32, NOW)).toMatchObject({ ok: false, reason: "damaged" });
  });

  test("damage recorded only in buildinghealthdata counts as well", () => {
    const save = sandbox();
    save.buildinghealthdata = { "32": 10 };

    expect(planOneUpgrade(save, 32, NOW)).toMatchObject({ ok: false, reason: "damaged" });
  });

  test("a yard with no Town Hall cannot upgrade anything", () => {
    const save = sandbox();
    delete save.buildingdata![String(HALL_ID)];

    expect(planOneUpgrade(save, 32, NOW)).toMatchObject({
      ok: false,
      reason: "townHall",
      townHall: { have: 0, need: 1 },
    });
  });

  test("a step gated on a higher Town Hall names the level it wants", () => {
    const save = sandbox();
    save.buildingdata![String(HALL_ID)] = { ...save.buildingdata![String(HALL_ID)]!, l: 1 };

    expect(planOneUpgrade(save, 32, NOW)).toMatchObject({
      ok: false,
      reason: "townHall",
      scope: "step",
      townHall: { have: 1, need: 2 },
    });
  });

  test("a gate that is not the Town Hall is reported as a requirement list", () => {
    const save = sandbox();
    delete save.buildingdata![String(ACADEMY_ID)];

    expect(planOneUpgrade(save, BAITER_ID, NOW)).toMatchObject({
      ok: false,
      reason: "requirements",
      requirements: [[ACADEMY, 1, 2]],
    });
  });

  test("a step the yard cannot pay for names what is missing", () => {
    const save = sandbox();
    save.resources = { ...save.resources, r3: 0 };

    expect(planOneUpgrade(save, 32, NOW)).toMatchObject({
      ok: false,
      reason: "shortfall",
      shortfall: { r1: 0, r2: 0, r3: step(CANNON, 1)[2], r4: 0 },
    });
  });

  test("a building the cost table cannot price has no ladder", () => {
    const save: UpgradeWalkSave = {
      buildingdata: {
        "0": { x: 0, y: 0, t: TOWN_HALL, id: 0, l: 10 },
        "9": { x: 0, y: 0, t: BIRDHOUSE, id: 9 },
      },
      resources: { r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 },
      storedata: {},
    };

    expect(planOneUpgrade(save, 9, NOW)).toMatchObject({ ok: false, reason: "noLadder" });
  });

  test("a building at the top of its ladder", () => {
    const save = sandbox();
    save.buildingdata!["32"] = { ...save.buildingdata!["32"]!, l: COSTS[CANNON]!.costs.length + 1 };

    expect(planOneUpgrade(save, 32, NOW)).toMatchObject({ ok: false, reason: "maxLevel" });
  });

  test("a building the save does not hold is missing", () => {
    expect(planOneUpgrade(sandbox(), 999_999, NOW)).toMatchObject({ ok: false, reason: "missing" });
  });
});
