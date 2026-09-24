import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { COSTS } from "../../game-data/buildingCosts.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { LayoutNode } from "../../schemas/YardPlannerSchemas.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { pointsForUpgrade } from "./costs.js";
import { walkUpgrades, type UpgradeWalkSave } from "./startUpgrades.js";

/**
 * The upgrade walk (`docs/design/planner-upgrades.md` §3.4), against the same
 * sandbox capture the batch wall route's tests use: a real 575-building save
 * with six Cannon Towers at level 1, 400 Blocks at level 1, a level 10 Town
 * Hall, `BEW.q = 4` so five workers, no damage, no countdowns and resources in
 * the billions.
 *
 * Every case here is one rule of §3.4 read off one walk. The two the file is
 * really for are the pair decision Q1 turns on: a long step takes a worker and
 * ends its building's turn, and a step short enough to finish for free takes
 * none and does not.
 */

const FIXTURE = "../../../../web/test/fixtures/baseload-sandbox-yard.json";

/** Types the cases below name. */
const SNAPPER = 1;
const ACADEMY = 8;
const TOWN_HALL = 14;
const WALL = 17;
const BAITER = 19;
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

/** One planned node. Positions are never read by the walk, so they stay at 0. */
const planned = (id: number, t: number, level: number, order = 0): LayoutNode => ({
  id,
  t,
  x: 0,
  y: 0,
  plan: { level, order },
});

/** The first Block in the yard, which is at level 1 like the other 399. */
const firstWallId = (buildings: BuildingDataMap): number =>
  Number(Object.values(buildings).find((building) => Number(building.t) === WALL)!.id);

/** The error a call threw, typed, so a test can read its status and data. */
const rejection = (run: () => unknown): ClientSafeError => {
  try {
    run();
  } catch (err) {
    if (err instanceof ClientSafeError) return err;
    throw err;
  }
  throw new Error("expected walkUpgrades to throw");
};

/** One step off the generated table, so no price is retyped into a test. */
const step = (type: number, from: number) => COSTS[type]!.costs[from]!;

/** The four resource amounts of a run of steps. */
const priceOf = (type: number, from: number, to: number) => {
  const total = { r1: 0, r2: 0, r3: 0, r4: 0 };
  for (let level = from; level < to; level++) {
    const [r1, r2, r3, r4] = step(type, level);
    total.r1 += r1;
    total.r2 += r2;
    total.r3 += r3;
    total.r4 += r4;
  }
  return total;
};

/** Every id in a list of report rows, in the order the walk reported them. */
const idsOf = (rows: readonly { id: number }[]): number[] => rows.map((row) => row.id);

describe("walkUpgrades: workers", () => {
  test("starts one job per free worker and reports the rest waiting", () => {
    const save = sandbox();
    const nodes = CANNON_IDS.map((id, index) => planned(id, CANNON, 2, index));

    const walk = walkUpgrades(save, nodes, NOW);

    expect(walk.workers).toEqual({ total: 5, busyBefore: 0, busyAfter: 5 });
    expect(idsOf(walk.started)).toEqual([32, 33, 34, 35, 36]);
    expect(idsOf(walk.waiting)).toEqual([37]);
    expect(walk.skipped).toEqual([]);
    expect(walk.finished).toEqual([]);
  });

  test("a started job is one step, at the countdown the cost table names", () => {
    const save = sandbox();
    const walk = walkUpgrades(save, [planned(32, CANNON, 2)], NOW);

    expect(walk.started).toEqual([
      { id: 32, t: CANNON, from: 1, to: 2, seconds: 900, cost: priceOf(CANNON, 1, 2) },
    ]);
    expect(walk.buildingdata["32"]).toMatchObject({ t: CANNON, cU: 900 });
    // The level does not move: the countdown raises it when it finishes.
    expect(walk.buildingdata["32"]!.l).toBeUndefined();
  });

  test("charges every started job once and nothing for one that waits", () => {
    const save = sandbox();
    const nodes = CANNON_IDS.map((id, index) => planned(id, CANNON, 2, index));

    const walk = walkUpgrades(save, nodes, NOW);
    const one = priceOf(CANNON, 1, 2);

    expect(walk.cost).toEqual({ r1: one.r1 * 5, r2: one.r2 * 5, r3: one.r3 * 5, r4: one.r4 * 5 });
    // No points yet: a long step earns them when it completes.
    expect(walk.points).toBe(0);
  });

  test("the building that waits is left exactly as it was", () => {
    const save = sandbox();
    const before = structuredClone(save.buildingdata!["37"]);
    const nodes = CANNON_IDS.map((id, index) => planned(id, CANNON, 2, index));

    const walk = walkUpgrades(save, nodes, NOW);

    expect(walk.buildingdata["37"]).toEqual(before);
    expect(walk.waiting).toEqual([{ id: 37, t: CANNON, from: 1, to: 2, reason: "workers" }]);
  });

  test("the player's order decides which job waits", () => {
    const save = sandbox();
    const nodes = CANNON_IDS.map((id, index) => planned(id, CANNON, 2, CANNON_IDS.length - index));

    const walk = walkUpgrades(save, nodes, NOW);

    expect(idsOf(walk.started)).toEqual([37, 36, 35, 34, 33]);
    expect(idsOf(walk.waiting)).toEqual([32]);
  });

  test("ties in the order are broken by building id", () => {
    const save = sandbox();
    const nodes = [...CANNON_IDS].reverse().map((id) => planned(id, CANNON, 2, 0));

    expect(idsOf(walkUpgrades(save, nodes, NOW).started)).toEqual([32, 33, 34, 35, 36]);
  });

  test("a job already running holds a worker the walk cannot use", () => {
    const save = sandbox();
    save.buildingdata!["32"] = { ...save.buildingdata!["32"]!, cU: 500 };
    const nodes = CANNON_IDS.slice(1).map((id, index) => planned(id, CANNON, 2, index));

    const walk = walkUpgrades(save, nodes, NOW);

    expect(walk.workers).toEqual({ total: 5, busyBefore: 1, busyAfter: 5 });
    expect(walk.started).toHaveLength(4);
    expect(walk.waiting).toHaveLength(1);
  });

  test("a yard with no extra workers bought starts one job", () => {
    const save = sandbox();
    save.storedata = {};
    const nodes = CANNON_IDS.map((id, index) => planned(id, CANNON, 2, index));

    const walk = walkUpgrades(save, nodes, NOW);

    expect(walk.workers.total).toBe(1);
    expect(walk.started).toHaveLength(1);
    expect(walk.waiting).toHaveLength(5);
  });

  test("a layout with no plans does nothing at all", () => {
    const save = sandbox();
    const walk = walkUpgrades(save, [{ id: 32, t: CANNON, x: 0, y: 0 }], NOW);

    expect(walk.started).toEqual([]);
    expect(walk.finished).toEqual([]);
    expect(walk.waiting).toEqual([]);
    expect(walk.skipped).toEqual([]);
    expect(walk.cost).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(walk.workers).toEqual({ total: 5, busyBefore: 0, busyAfter: 0 });
  });
});

describe("walkUpgrades: steps that finish for free", () => {
  test("a Block planned to level 5 finishes every step on the spot", () => {
    const save = sandbox();
    const id = firstWallId(save.buildingdata!);

    const walk = walkUpgrades(save, [planned(id, WALL, 5)], NOW);

    expect(walk.started).toEqual([]);
    expect(walk.waiting).toEqual([]);
    expect(walk.finished.map((row) => [row.from, row.to])).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ]);
    expect(walk.buildingdata[String(id)]).toMatchObject({ t: WALL, l: 5 });
    expect(walk.buildingdata[String(id)]!.cU).toBeUndefined();
  });

  test("free steps use no worker and are charged and scored as the wall route charges them", () => {
    const save = sandbox();
    const id = firstWallId(save.buildingdata!);

    const walk = walkUpgrades(save, [planned(id, WALL, 5)], NOW);

    expect(walk.workers).toEqual({ total: 5, busyBefore: 0, busyAfter: 0 });
    expect(walk.cost).toEqual(priceOf(WALL, 1, 5));
    expect(walk.points).toBe(
      [1, 2, 3, 4].reduce((total, level) => total + pointsForUpgrade(step(WALL, level)), 0)
    );
  });

  test("a harvester's 300-second step is inside the window too", () => {
    const save = sandbox();
    const walk = walkUpgrades(save, [planned(1, SNAPPER, 2)], NOW);

    expect(step(SNAPPER, 1)[4]).toBe(300);
    expect(walk.finished).toEqual([
      { id: 1, t: SNAPPER, from: 1, to: 2, cost: priceOf(SNAPPER, 1, 2) },
    ]);
    expect(walk.buildingdata["1"]).toMatchObject({ l: 2 });
    expect(walk.points).toBe(pointsForUpgrade(step(SNAPPER, 1)));
  });

  test("the first step past the window starts and the free ones before it do not wait", () => {
    const save = sandbox();
    // Level 1 to 2 is 300 seconds and free; 2 to 3 is 1,200 and is not.
    const walk = walkUpgrades(save, [planned(1, SNAPPER, 3)], NOW);

    expect(walk.finished.map((row) => [row.from, row.to])).toEqual([[1, 2]]);
    expect(walk.started.map((row) => [row.from, row.to, row.seconds])).toEqual([[2, 3, 1200]]);
    expect(walk.buildingdata["1"]).toMatchObject({ l: 2, cU: 1200 });
    expect(walk.workers.busyAfter).toBe(1);
  });

  test("free steps still cost a worker nothing when every worker is already busy", () => {
    const save = sandbox();
    for (const id of CANNON_IDS.slice(0, 5)) {
      save.buildingdata![String(id)] = { ...save.buildingdata![String(id)]!, cU: 500 };
    }
    const id = firstWallId(save.buildingdata!);

    const walk = walkUpgrades(save, [planned(id, WALL, 3)], NOW);

    expect(walk.workers).toEqual({ total: 5, busyBefore: 5, busyAfter: 5 });
    expect(walk.finished).toHaveLength(2);
    expect(walk.waiting).toEqual([]);
  });
});

describe("walkUpgrades: one job per building", () => {
  test("a multi-level plan starts one step and leaves the rest planned", () => {
    const save = sandbox();
    const walk = walkUpgrades(save, [planned(32, CANNON, 3)], NOW);

    expect(walk.started.map((row) => [row.from, row.to])).toEqual([[1, 2]]);
    expect(walk.finished).toEqual([]);
    expect(walk.waiting).toEqual([]);
    expect(walk.skipped).toEqual([]);
    expect(walk.cost).toEqual(priceOf(CANNON, 1, 2));
    expect(walk.buildingdata["32"]).toMatchObject({ cU: 900 });
  });
});

describe("walkUpgrades: Sharper Tools", () => {
  test("a running buff shortens the countdown by a fifth", () => {
    const save = sandbox();
    save.storedata = { ...save.storedata, BST: { e: NOW + 3600 } };

    const walk = walkUpgrades(save, [planned(32, CANNON, 2)], NOW);

    expect(walk.started[0]!.seconds).toBe(720);
    expect(walk.buildingdata["32"]).toMatchObject({ cU: 720 });
    // The price is the cost table's, buff or no buff.
    expect(walk.cost).toEqual(priceOf(CANNON, 1, 2));
  });

  test("a buff that has expired leaves the countdown alone", () => {
    const save = sandbox();
    save.storedata = { ...save.storedata, BST: { e: NOW } };

    expect(walkUpgrades(save, [planned(32, CANNON, 2)], NOW).started[0]!.seconds).toBe(900);
  });
});

describe("walkUpgrades: skipped", () => {
  test("a building with a countdown of its own is busy", () => {
    const save = sandbox();
    save.buildingdata!["32"] = { ...save.buildingdata!["32"]!, cU: 60 };

    const walk = walkUpgrades(save, [planned(32, CANNON, 2)], NOW);

    expect(walk.skipped).toEqual([{ id: 32, t: CANNON, reason: "busy", from: 1, to: 2 }]);
    expect(walk.started).toEqual([]);
  });

  test("a damaged building has to be repaired first", () => {
    const save = sandbox();
    save.buildingdata!["32"] = { ...save.buildingdata!["32"]!, hp: 10 };

    expect(walkUpgrades(save, [planned(32, CANNON, 2)], NOW).skipped).toEqual([
      { id: 32, t: CANNON, reason: "damaged", from: 1, to: 2 },
    ]);
  });

  test("damage recorded only in buildinghealthdata counts as well", () => {
    const save = sandbox();
    save.buildinghealthdata = { "32": 10 };

    expect(walkUpgrades(save, [planned(32, CANNON, 2)], NOW).skipped).toEqual([
      { id: 32, t: CANNON, reason: "damaged", from: 1, to: 2 },
    ]);
  });

  test("a yard that has already reached the planned level is caught up", () => {
    const save = sandbox();
    save.buildingdata!["32"] = { ...save.buildingdata!["32"]!, l: 3 };

    expect(walkUpgrades(save, [planned(32, CANNON, 3)], NOW).skipped).toEqual([
      { id: 32, t: CANNON, reason: "caughtUp", from: 3, to: 3 },
    ]);
  });

  test("a yard with no Town Hall cannot upgrade anything", () => {
    const save = sandbox();
    delete save.buildingdata![String(HALL_ID)];

    expect(walkUpgrades(save, [planned(32, CANNON, 2)], NOW).skipped).toEqual([
      { id: 32, t: CANNON, reason: "townHall", from: 1, to: 2, townHall: { have: 0, need: 1 } },
    ]);
  });

  test("a step gated on a higher Town Hall names the level it wants", () => {
    const save = sandbox();
    save.buildingdata![String(HALL_ID)] = {
      ...save.buildingdata![String(HALL_ID)]!,
      l: 1,
    };

    expect(walkUpgrades(save, [planned(32, CANNON, 2)], NOW).skipped).toEqual([
      { id: 32, t: CANNON, reason: "townHall", from: 1, to: 2, townHall: { have: 1, need: 2 } },
    ]);
  });

  test("a gate that is not the Town Hall is reported as a requirement list", () => {
    const save = sandbox();
    delete save.buildingdata![String(ACADEMY_ID)];

    const walk = walkUpgrades(save, [planned(BAITER_ID, BAITER, 2)], NOW);

    expect(walk.skipped).toEqual([
      {
        id: BAITER_ID,
        t: BAITER,
        reason: "requirements",
        from: 1,
        to: 2,
        requirements: [[ACADEMY, 1, 2]],
      },
    ]);
  });

  test("a job the yard cannot pay for is skipped and the walk carries on", () => {
    // Putty is the one resource a Cannon Tower step spends and a Block step does
    // not, so emptying it starves the tower and nothing else. The plan's own
    // sketch used pebbles, which every Block step spends too.
    const save = sandbox();
    save.resources = { ...save.resources, r3: 0 };
    const wall = firstWallId(save.buildingdata!);

    const walk = walkUpgrades(save, [planned(32, CANNON, 2, 0), planned(wall, WALL, 2, 1)], NOW);

    expect(walk.skipped).toEqual([
      {
        id: 32,
        t: CANNON,
        reason: "shortfall",
        from: 1,
        to: 2,
        shortfall: { r1: 0, r2: 0, r3: step(CANNON, 1)[2], r4: 0 },
      },
    ]);
    expect(idsOf(walk.finished)).toEqual([wall]);
    expect(walk.cost).toEqual(priceOf(WALL, 1, 2));
  });

  test("an earlier job's charge is what a later one is measured against", () => {
    const save = sandbox();
    // Exactly one Cannon Tower step's worth of putty in the yard.
    save.resources = { ...save.resources, r3: step(CANNON, 1)[2] };

    const walk = walkUpgrades(
      save,
      [planned(32, CANNON, 2, 0), planned(33, CANNON, 2, 1)],
      NOW
    );

    expect(idsOf(walk.started)).toEqual([32]);
    expect(walk.skipped).toMatchObject([{ id: 33, reason: "shortfall" }]);
    expect(walk.cost).toEqual(priceOf(CANNON, 1, 2));
  });

  test("a building the cost table cannot price is skipped, not priced on the node's type", () => {
    // `checkNodesOwned` refuses a node whose type disagrees with the save's, so
    // this is only reachable by calling the walk directly. It still must not
    // charge a decoration a Cannon Tower's price.
    const save: UpgradeWalkSave = {
      buildingdata: {
        "0": { x: 0, y: 0, t: TOWN_HALL, id: 0, l: 10 },
        "9": { x: 0, y: 0, t: BIRDHOUSE, id: 9 },
      },
      resources: { r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 },
      storedata: {},
    };

    const walk = walkUpgrades(save, [planned(9, CANNON, 2)], NOW);

    expect(walk.skipped).toEqual([{ id: 9, t: BIRDHOUSE, reason: "noLadder" }]);
    expect(walk.cost).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });

  test("a plan on a building the save does not hold is ignored", () => {
    const save = sandbox();
    const walk = walkUpgrades(save, [planned(999_999, CANNON, 2)], NOW);

    expect(walk.skipped).toEqual([]);
    expect(walk.started).toEqual([]);
  });
});

describe("walkUpgrades: malformed plans", () => {
  test("a target past the top of the ladder is the client's fault", () => {
    const save = sandbox();
    const error = rejection(() => walkUpgrades(save, [planned(32, CANNON, 11)], NOW));

    expect(error.status).toBe(400);
    expect(error.data).toMatchObject({ planLevel: [32] });
  });

  test("a plan on a type with no ladder at all is refused the same way", () => {
    const save = sandbox();
    const error = rejection(() => walkUpgrades(save, [planned(32, BIRDHOUSE, 2)], NOW));

    expect(error.status).toBe(400);
    expect(error.data).toMatchObject({ planLevel: [32] });
  });
});
