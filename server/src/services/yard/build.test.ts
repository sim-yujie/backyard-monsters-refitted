import { describe, expect, test } from "bun:test";
import { COSTS } from "../../game-data/buildingCosts.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import { storageCap } from "../base/economy/resourceBudget.js";
import {
  BUILDABLE_TYPES,
  nextBuildingId,
  planBuild,
  planCancelBuild,
  planInstantBuild,
  placementProblem,
  type BuildSave,
} from "./build.js";

/**
 * The build menu's routes (`docs/design/yard-buildings.md` §5.3), against a
 * small hand-built yard on the smallest plot, 1000 x 800, which spans
 * `[-500, 500) x [-400, 400)`. Prices read off the cost table:
 *
 * - Cannon Tower (20) `costs[0]` = 2,000 / 1,500 / 500, 30 s, Town Hall 1;
 *   four allowed at Town Hall 3; build points floor(15 + 400) = 415.
 * - Block (17) `costs[0]` = 1,000 twigs, 5 s, Town Hall 2; build points 102.
 * - Monster Lab (116): none allowed below Town Hall 5.
 * - Monster Academy (26): Town Hall 3 and a level 2 Monster Locker.
 */

const NOW = 1_700_000_000;

const HALL = 14;
const CANNON = 20;
const BLOCK = 17;
const TRAP = 24;
const LAB = 116;
const ACADEMY = 26;
const LOCKER = 8;
const SILO = 6;
const RADIO = 113;
const QUAKE = 129;

const RICH = { r1: 10_000_000, r2: 10_000_000, r3: 10_000_000, r4: 10_000_000 };

/** A level 3 hall in the middle, a level 1 Locker and a level 10 silo; one worker, all idle. */
const yard = (overrides: Partial<BuildSave> = {}): BuildSave => ({
  buildingdata: {
    "1": { id: 1, t: HALL, X: -65, Y: -65, l: 3 } as never,
    "2": { id: 2, t: LOCKER, X: 200, Y: 200, l: 1 } as never,
    "5": { id: 5, t: SILO, X: -400, Y: 200, l: 10 } as never,
  },
  buildinghealthdata: {},
  resources: { ...RICH },
  storedata: {},
  mushrooms: { l: [] },
  ...overrides,
});

/** The error a call threw, so a test can read its status and data. */
const refusal = (run: () => unknown): ClientSafeError => {
  try {
    run();
  } catch (err) {
    if (err instanceof ClientSafeError) return err;
    throw err;
  }
  throw new Error("expected a refusal");
};

/** `[status, data]` of what a call threw. */
const refusedWith = (run: () => unknown): [number, Record<string, unknown>] => {
  const err = refusal(run);
  return [err.status, err.data as Record<string, unknown>];
};

describe("build", () => {
  test("a tower starts: cB and cL at the table's time, charged costs[0], no l, no points yet", () => {
    const save = yard();
    const outcome = planBuild(save, { type: CANNON, x: 300, y: -300 }, NOW);

    expect(outcome.report).toEqual({
      id: 6,
      t: CANNON,
      x: 300,
      y: -300,
      seconds: 30,
      finished: false,
      cost: { r1: 2000, r2: 1500, r3: 500, r4: 0 },
      points: 0,
    });
    expect(outcome.debit).toEqual({ r1: 2000, r2: 1500, r3: 500, r4: 0 });
    expect(outcome).not.toHaveProperty("points");
    expect(outcome.slices.buildingdata["6"]).toEqual({
      id: 6,
      t: CANNON,
      X: 300,
      Y: -300,
      cB: 30,
      cL: 30,
    } as never);
    // Every other building carried over untouched; the save itself not written.
    expect(outcome.slices.buildingdata["1"]).toBe(save.buildingdata!["1"]);
    expect(save.buildingdata!["6"]).toBeUndefined();
  });

  test("Sharper Tools running: floor(time × 0.8)", () => {
    const outcome = planBuild(
      yard({ storedata: { BST: { q: 1, e: NOW + 60 } } }),
      { type: CANNON, x: 300, y: -300 },
      NOW
    );

    expect(outcome.report.seconds).toBe(24);
    expect(outcome.slices.buildingdata["6"]).toMatchObject({ cB: 24, cL: 24 });
  });

  test("a wall is written finished at level 1, holds no worker and pays its points now (D13)", () => {
    // The one worker is already busy: a wall does not need it.
    const busy = yard();
    busy.buildingdata!["2"] = { ...busy.buildingdata!["2"]!, cU: 500 };
    const outcome = planBuild(busy, { type: BLOCK, x: 0, y: 200 }, NOW);

    expect(outcome.report).toMatchObject({ id: 6, seconds: 0, finished: true, points: 102 });
    expect(outcome.points).toBe(102);
    expect(outcome.debit).toEqual({ r1: 1000, r2: 0, r3: 0, r4: 0 });
    expect(outcome.slices.buildingdata["6"]).toEqual({ id: 6, t: BLOCK, X: 0, Y: 200 } as never);
  });

  test("a trap is finished at once too", () => {
    const outcome = planBuild(yard(), { type: TRAP, x: 0, y: 200 }, NOW);

    expect(outcome.report.finished).toBe(true);
    expect(outcome.slices.buildingdata["6"]).not.toHaveProperty("cB");
  });

  test("walls sit edge to edge: touching footprints do not overlap", () => {
    const save = yard();
    save.buildingdata!["9"] = { id: 9, t: BLOCK, X: 0, Y: 200 } as never;

    const outcome = planBuild(save, { type: BLOCK, x: 20, y: 200 }, NOW);
    expect(outcome.report.id).toBe(10);
  });

  describe("refusals, in order", () => {
    test("400 notBuildable: the Radio, an Inferno tower, the Town Hall, a decoration, an unknown type", () => {
      for (const type of [RADIO, QUAKE, HALL, 28, 7, 999]) {
        const [status, data] = refusedWith(() => planBuild(yard(), { type, x: 300, y: -300 }, NOW));
        expect(status).toBe(400);
        expect(data.reason).toBe("notBuildable");
      }
    });

    test("409 townHall with no hall at all", () => {
      const save = yard({ buildingdata: {} });
      const [status, data] = refusedWith(() => planBuild(save, { type: CANNON, x: 0, y: 0 }, NOW));

      expect(status).toBe(409);
      expect(data).toMatchObject({ reason: "townHall", townHall: { have: 0, need: 1 } });
    });

    test("409 townHall when the hall allows none yet: the Lab needs level 5", () => {
      const [status, data] = refusedWith(() =>
        planBuild(yard(), { type: LAB, x: 300, y: -300 }, NOW)
      );

      expect(status).toBe(409);
      expect(data).toMatchObject({ reason: "townHall", townHall: { have: 3, need: 5 } });
    });

    test("409 limit at the hall's allowance, naming the hall that allows more", () => {
      const save = yard();
      for (const id of [10, 11, 12, 13]) {
        // One still under construction counts too.
        save.buildingdata![String(id)] = {
          id,
          t: CANNON,
          X: 400,
          Y: -400 + (id - 10) * 70,
          ...(id === 13 ? { cB: 20 } : {}),
        } as never;
      }

      const [status, data] = refusedWith(() =>
        planBuild(save, { type: CANNON, x: 300, y: 300 }, NOW)
      );
      expect(status).toBe(409);
      expect(data).toMatchObject({ reason: "limit", limit: { have: 4, allowed: 4, next: 4 } });
    });

    test("409 limit with next null at the top of the ladder", () => {
      const save = yard();
      save.buildingdata!["1"] = { id: 1, t: HALL, X: -65, Y: -65, l: 10 } as never;
      save.buildingdata!["9"] = { id: 9, t: 10, X: 300, Y: 300 } as never; // the one Yard Planner

      const [, data] = refusedWith(() => planBuild(save, { type: 10, x: -300, y: -300 }, NOW));
      expect(data).toMatchObject({ reason: "limit", limit: { have: 1, allowed: 1, next: null } });
    });

    test("409 requirements: the Academy needs a level 2 Locker", () => {
      const [status, data] = refusedWith(() =>
        planBuild(yard(), { type: ACADEMY, x: 300, y: -300 }, NOW)
      );

      expect(status).toBe(409);
      expect(data).toMatchObject({ reason: "requirements", requirements: [[LOCKER, 1, 2]] });
    });

    test("a Locker still upgrading keeps its level for the requirement; one still building does not count", () => {
      // Two workers, so the Locker's own job leaves one free.
      const save = yard({ storedata: { BEW: { q: 1 } } });
      save.buildingdata!["2"] = { id: 2, t: LOCKER, X: 200, Y: 200, cB: 60 } as never;
      const [, data] = refusedWith(() => planBuild(save, { type: ACADEMY, x: 300, y: -300 }, NOW));
      expect(data.reason).toBe("requirements");

      save.buildingdata!["2"] = { id: 2, t: LOCKER, X: 200, Y: 200, l: 2, cU: 60 } as never;
      expect(planBuild(save, { type: ACADEMY, x: 300, y: -300 }, NOW).report.t).toBe(ACADEMY);
    });

    test("409 shortfall before placement", () => {
      const save = yard({ resources: { r1: 100, r2: 100, r3: 100, r4: 0 } });
      // On top of the hall, too: the shortfall is what is reported.
      const [status, data] = refusedWith(() => planBuild(save, { type: CANNON, x: 0, y: 0 }, NOW));

      expect(status).toBe(409);
      expect(data).toMatchObject({
        reason: "shortfall",
        shortfall: { r1: 1900, r2: 1400, r3: 400, r4: 0 },
      });
    });

    test("409 placement outOfBounds: the footprint must end inside the plot", () => {
      // 500 - 70 = 430 is the last origin that fits on x.
      expect(planBuild(yard(), { type: CANNON, x: 430, y: 0 }, NOW).report.x).toBe(430);

      const [status, data] = refusedWith(() =>
        planBuild(yard(), { type: CANNON, x: 435, y: 0 }, NOW)
      );
      expect(status).toBe(409);
      expect(data).toMatchObject({ reason: "placement", placement: "outOfBounds" });
    });

    test("a bigger plot moves the edge (ENL)", () => {
      const save = yard({ storedata: { ENL: { q: 1 } } }); // 1100 x 880
      expect(planBuild(save, { type: CANNON, x: 435, y: 0 }, NOW).report.x).toBe(435);
    });

    test("409 placement overlap names the building in the way", () => {
      const [status, data] = refusedWith(() =>
        planBuild(yard(), { type: CANNON, x: 250, y: 250 }, NOW)
      );

      expect(status).toBe(409);
      expect(data).toMatchObject({ reason: "placement", placement: "overlap", with: 2 });
    });

    test("a mushroom is no placement problem (#263): the wrapper moves it", () => {
      const save = yard({ mushrooms: { l: [[1, 320, -280]] } });
      expect(placementProblem(save, { type: CANNON, x: 300, y: -300 })).toBeNull();
      expect(planBuild(save, { type: CANNON, x: 300, y: -300 }, NOW).report.x).toBe(300);
    });

    test("409 workers last, with the counts", () => {
      const save = yard();
      save.buildingdata!["2"] = { ...save.buildingdata!["2"]!, cU: 500 };

      const [status, data] = refusedWith(() =>
        planBuild(save, { type: CANNON, x: 300, y: -300 }, NOW)
      );
      expect(status).toBe(409);
      expect(data).toMatchObject({ reason: "workers", workers: { total: 1, busy: 1 } });
    });

    test("a building under construction holds a worker too", () => {
      const save = yard();
      save.buildingdata!["9"] = { id: 9, t: CANNON, X: 400, Y: -400, cB: 20 } as never;

      const [, data] = refusedWith(() => planBuild(save, { type: CANNON, x: 300, y: -300 }, NOW));
      expect(data.reason).toBe("workers");
    });
  });
});

describe("build/instant", () => {
  test("finished now: level 1, no countdown, Shiny and the build's points, no resources", () => {
    const save = yard();
    const outcome = planInstantBuild(save, { type: CANNON, x: 300, y: -300 }, NOW);

    expect(outcome.report).toEqual({ id: 6, t: CANNON, x: 300, y: -300, credits: 17, points: 415 });
    expect(outcome.shiny).toBe(17);
    expect(outcome.points).toBe(415);
    expect(outcome).not.toHaveProperty("debit");
    expect(outcome.slices.buildingdata["6"]).toEqual({ id: 6, t: CANNON, X: 300, Y: -300 } as never);
  });

  test("needs no worker and no resources", () => {
    const save = yard({ resources: { r1: 0, r2: 0, r3: 0, r4: 0 } });
    save.buildingdata!["2"] = { ...save.buildingdata!["2"]!, cU: 500 };

    expect(planInstantBuild(save, { type: CANNON, x: 300, y: -300 }, NOW).report.id).toBe(6);
  });

  test("keeps every other gate: limit, requirements, placement", () => {
    expect(
      refusedWith(() => planInstantBuild(yard(), { type: ACADEMY, x: 300, y: -300 }, NOW))[1].reason
    ).toBe("requirements");
    expect(
      refusedWith(() => planInstantBuild(yard(), { type: CANNON, x: 250, y: 250 }, NOW))[1].reason
    ).toBe("placement");
    expect(
      refusedWith(() => planInstantBuild(yard(), { type: RADIO, x: 300, y: -300 }, NOW))[1].reason
    ).toBe("notBuildable");
  });
});

describe("build/cancel", () => {
  const building = (): BuildSave => {
    const save = yard();
    save.buildingdata!["6"] = { id: 6, t: CANNON, X: 300, Y: -300, cB: 20, cL: 30 } as never;
    return save;
  };

  test("removes the building and refunds costs[0] in full", () => {
    const save = building();
    save.resources = { r1: 0, r2: 0, r3: 0, r4: 0 };
    const outcome = planCancelBuild(save, 6);

    expect(outcome.credit).toEqual({ r1: 2000, r2: 1500, r3: 500, r4: 0 });
    expect(outcome.report).toEqual({
      id: 6,
      t: CANNON,
      refund: { r1: 2000, r2: 1500, r3: 500, r4: 0 },
    });
    expect(outcome.slices.buildingdata).not.toHaveProperty("6");
    expect(outcome.slices.buildingdata["1"]).toBe(save.buildingdata!["1"]);
    expect(outcome.slices).not.toHaveProperty("buildinghealthdata");
  });

  test("the report says what the storage cap lets through", () => {
    const save = building();
    const cap = storageCap(save);
    save.resources = { r1: cap - 500, r2: cap, r3: 0, r4: 0 };

    expect(planCancelBuild(save, 6).report.refund).toEqual({ r1: 500, r2: 0, r3: 500, r4: 0 });
  });

  test("drops the building's health entry with it", () => {
    const save = building();
    save.buildinghealthdata = { "6": 10, "1": 900 };

    expect(planCancelBuild(save, 6).slices.buildinghealthdata).toEqual({ "1": 900 });
  });

  test("refuses a finished building (409 notBuilding) and an unknown id (400)", () => {
    expect(refusedWith(() => planCancelBuild(yard(), 2))).toEqual([
      409,
      expect.objectContaining({ reason: "notBuilding" }),
    ]);
    expect(refusedWith(() => planCancelBuild(yard(), 77))[0]).toBe(400);
  });
});

describe("nextBuildingId", () => {
  test("one above every id in buildingdata and buildinghealthdata", () => {
    expect(nextBuildingId(yard())).toBe(6);
    expect(nextBuildingId(yard({ buildinghealthdata: { "40": 0 } }))).toBe(41);
    expect(nextBuildingId({})).toBe(1);
  });
});

describe("BUILDABLE_TYPES", () => {
  test("every type has a build step and a hall allowance, and none is Inferno, Radio or Map Room 3", () => {
    for (const type of BUILDABLE_TYPES) {
      const row = COSTS[type];
      expect(row?.costs[0]).toBeDefined();
      expect(Math.max(...row!.quantity)).toBeGreaterThan(0);
      expect(["decoration", "enemy", "placeholder", "mushroom", "taunt"]).not.toContain(row!.kind);
    }
    for (const excluded of [14, 18, 113, 129, 132, 133, 134, 136, 137, 138, 139, 140]) {
      expect(BUILDABLE_TYPES.has(excluded)).toBe(false);
    }
  });
});
