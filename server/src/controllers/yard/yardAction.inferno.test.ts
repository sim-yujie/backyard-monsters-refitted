import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import type z from "zod";
import type { User } from "../../database/models/user.model.js";
import { costOf, productionOf, siloCapacity } from "../../game-data/buildingCosts.js";
import { INFERNO_REPAIR_TIMES, REPAIR_TIMES } from "../../game-data/repairTimes.js";
import { footprintOf } from "../../game-data/buildingFootprints.js";
import { maxHp } from "../../game-rules/combat/stats.js";
import { refundOf, storageCap } from "../../services/base/economy/resourceBudget.js";
import { infernoStartBuildingData } from "../../services/inferno/infernoYard.js";
import { currentExpansion } from "../../services/yardplanner/layoutGeometry.js";
import { levelOf, pointsForBuild, pointsForUpgrade } from "../../services/yardplanner/costs.js";
import { workerCount } from "../../services/yardplanner/workers.js";
import { instantBuildPrice, instantUpgradePrice, timeCost } from "../../services/yard/shiny.js";
import type { BuildingData } from "../../types/BuildingData.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardBankAction } from "./bank.js";
import { yardBuildAction, yardCancelBuildAction, yardInstantBuildAction } from "./build.js";
import { yardCancelFortifyAction, yardFortifyAction } from "./fortify.js";
import { yardInstantUpgradeAction } from "./instantUpgrade.js";
import { yardLockerCancelAction } from "./locker.js";
import { yardMoveAction } from "./move.js";
import { yardRecycleAction } from "./recycle.js";
import { yardRepairAction, yardRepairInstantAction } from "./repair.js";
import { yardShopBuyAction } from "./shopBuy.js";
import { yardSpeedupAction } from "./speedup.js";
import { yardStateAction } from "./state.js";
import { yardCancelUpgradeAction, yardUpgradeAction } from "./upgrade.js";
import { runYardAction, type YardAction, type YardAnswer } from "./yardAction.js";

/**
 * The yard actions on the Inferno yard (`docs/design/inferno.md` §5, WP 1.15),
 * with the database replaced by in-memory rows (as in
 * `yardAction.outpost.test.ts`): a locked read takes the row's lock, writes
 * land on commit only, all or nothing.
 */

type Row = Record<string, unknown>;

const db = {
  rows: new Map<number, Row>(),
  /** Every locked read, in order, by `basesaveid`. */
  locked: [] as number[],
};

const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => row[key] === value);

const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    const read = new Map<number, Row>();
    const fork = {
      async findOne(_entity: unknown, where: Row, options?: { lockMode?: LockMode }) {
        const found = [...db.rows.values()].find((row) => matches(row, where));
        if (!found) return null;
        const id = found.basesaveid as number;
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) db.locked.push(id);
        const entity = structuredClone(found);
        read.set(id, entity);
        return entity;
      },
      async find() {
        return [];
      },
      async flush() {},
    };
    const result = await cb(fork);
    for (const [id, entity] of read) db.rows.set(id, structuredClone(entity));
    return result;
  },
};

const USERID = 2503;
const MAIN = 7;
const INFERNO = 95;
const INFERNO_BASEID = "950";
const OTHER_INFERNO = 96;
const OTHER_BASEID = "960";

const userOf = (): User =>
  ({
    userid: USERID,
    username: "agenttester",
    shiny_locked: false,
    save: { basesaveid: MAIN, baseid: "7" },
  }) as unknown as User;

const now = () => getCurrentDateTime();

const PURSE = { r1: 60_000, r2: 60_000, r3: 60_000, r4: 60_000 };
const POOL = { r1: 1_000_000, r2: 1_000_000, r3: 1_000_000, r4: 1_000_000 };

const mainRow = (overrides: Row = {}): Row => ({
  basesaveid: MAIN,
  baseid: "7",
  baseid_inferno: Number(INFERNO_BASEID),
  userid: USERID,
  saveuserid: USERID,
  type: "main",
  mapversion: 2,
  worldid: "world-a",
  attackid: 0,
  attacks: [],
  savetime: now() - 10,
  credits: 1000,
  points: "100",
  flinger: 0,
  catapult: 0,
  resources: { ...POOL },
  iresources: { ...PURSE },
  buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 10 } },
  buildinghealthdata: {},
  // Main-yard store data: bought workers and packing that are not the Inferno's.
  storedata: { BEW: { q: 4 }, BIP: { q: 5 } },
  monsters: {},
  lockerdata: {},
  academy: {},
  champion: [],
  mushrooms: { l: [], s: now() },
  researchdata: {},
  outposts: [],
  ...overrides,
});

/** The Inferno yard with Flash's start layout: Under Hall 1, two harvesters, two Resource Pods. */
const infernoRow = (overrides: Row = {}): Row => ({
  basesaveid: INFERNO,
  baseid: INFERNO_BASEID,
  userid: USERID,
  saveuserid: USERID,
  type: "inferno",
  attackid: 0,
  attacks: [],
  savetime: now() - 10,
  credits: 0,
  points: "0",
  flinger: 0,
  catapult: 0,
  resources: {},
  iresources: {},
  buildingdata: infernoStartBuildingData(),
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: {},
  academy: {},
  champion: [],
  mushrooms: {},
  researchdata: {},
  outposts: [],
  ...overrides,
});

const call = (action: YardAction<z.ZodType, unknown>, body: Row = {}): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, userOf(), action, body);

const inInferno = (action: YardAction<z.ZodType, unknown>, body: Row = {}) =>
  call(action, { ...body, baseid: INFERNO_BASEID });

const mainSave = () => db.rows.get(MAIN)!;
const infernoSave = () => db.rows.get(INFERNO)!;
const buildings = (row: Row) => row.buildingdata as Record<string, Row>;
const purse = () => mainSave().iresources as Record<string, number>;
const body = (answer: YardAnswer) => answer.body as Row & { report: Row };

/** The Inferno table's step, as `r1`..`r4`. */
const stepOf = (type: number, level = 0) => {
  const [r1, r2, r3, r4, time] = costOf(type, "inferno")!.costs[level]!;
  return { r1, r2, r3, r4, time };
};

/** Flash's Inferno start cap: 10,000 plus two level 3 Resource Pods. */
const START_CAP = 10_000 + 2 * siloCapacity(3, "inferno");

const SHARPSHOOTER = 21;
const HOUSING_BUNKER = 128;

let infernoEnv: string | undefined;

beforeEach(() => {
  infernoEnv = process.env.INFERNO_ENABLED;
  process.env.INFERNO_ENABLED = "on";
  db.rows = new Map([
    [MAIN, mainRow()],
    [INFERNO, infernoRow()],
    [OTHER_INFERNO, infernoRow({ basesaveid: OTHER_INFERNO, baseid: OTHER_BASEID, userid: 99, saveuserid: 99 })],
  ]);
  db.locked = [];
});

afterEach(() => {
  if (infernoEnv === undefined) delete process.env.INFERNO_ENABLED;
  else process.env.INFERNO_ENABLED = infernoEnv;
});

describe("which yard a request acts on", () => {
  test("the Inferno baseid locks the main row first, then the Inferno row", async () => {
    const answer = await inInferno(yardStateAction);
    expect(answer.status).toBe(200);
    expect(db.locked).toEqual([MAIN, INFERNO]);
    const state = body(answer);
    expect(state.resources).toEqual(PURSE);
    expect(state.caps).toEqual({ r1: START_CAP, r2: START_CAP, r3: START_CAP, r4: START_CAP });
    expect(state.workers).toEqual({ total: 1, busy: 0 });
    expect(answer.outpost).toBeNull();
  });

  test("while the new Inferno is switched off: 403 infernoOff, nothing read past the main row", async () => {
    process.env.INFERNO_ENABLED = "off";
    const answer = await inInferno(yardStateAction);
    expect(answer.status).toBe(403);
    expect(body(answer).reason).toBe("infernoOff");
    expect(db.locked).toEqual([MAIN]);
  });

  test("another player's Inferno yard: 403 notYourYard", async () => {
    const answer = await call(yardStateAction, { baseid: OTHER_BASEID });
    expect(answer.status).toBe(403);
    expect(body(answer).reason).toBe("notYourYard");
  });

  test("a main save naming someone else's Inferno row: 403 notYourYard", async () => {
    db.rows.set(MAIN, mainRow({ baseid_inferno: Number(OTHER_BASEID) }));
    const answer = await call(yardStateAction, { baseid: OTHER_BASEID });
    expect(answer.status).toBe(403);
    expect(body(answer).reason).toBe("notYourYard");
  });

  test("an Inferno yard being attacked: 409 underAttack", async () => {
    db.rows.set(INFERNO, infernoRow({ attackid: 5, attacks: [{ starttime: now() - 30 }] }));
    const answer = await inInferno(yardStateAction);
    expect(answer.status).toBe(409);
    expect(body(answer).reason).toBe("underAttack");
  });

  test("a route not checked for the Inferno refuses: 409 notInInferno, nothing written", async () => {
    const before = structuredClone(infernoSave());
    for (const [action, request] of [
      [yardShopBuyAction, { item: "BIP" }],
      [yardLockerCancelAction, {}],
    ] as const) {
      const answer = await inInferno(action as YardAction<z.ZodType, unknown>, request);
      expect(answer.status).toBe(409);
      expect(body(answer).reason).toBe("notInInferno");
    }
    expect(infernoSave()).toEqual(before);
  });
});

describe("building in the Inferno", () => {
  test("a Sharpshooter is priced from the Inferno table and paid from the Inferno purse", async () => {
    const step = stepOf(SHARPSHOOTER);
    const answer = await inInferno(yardBuildAction, { type: SHARPSHOOTER, x: 200, y: 200 });
    expect(answer.status).toBe(200);
    expect(purse()).toEqual({
      r1: PURSE.r1 - step.r1,
      r2: PURSE.r2 - step.r2,
      r3: PURSE.r3 - step.r3,
      r4: PURSE.r4 - step.r4,
    });
    // The surface pool is untouched.
    expect(mainSave().resources).toEqual(POOL);
    const built = Object.values(buildings(infernoSave())).find((b) => b.t === SHARPSHOOTER)!;
    expect(built).toMatchObject({ X: 200, Y: 200, cB: step.time });
    // Nothing lands on the main yard's buildings.
    expect(Object.keys(buildings(mainSave()))).toEqual(["0"]);
  });

  test("a type not in the Inferno menu: 400 notBuildable", async () => {
    // The Flinger is a surface building.
    const answer = await inInferno(yardBuildAction, { type: 5, x: 200, y: 200 });
    expect(answer.status).toBe(400);
    expect(body(answer).reason).toBe("notBuildable");
  });

  test("Under Hall gating: none without an Under Hall, and only as many as its level allows", async () => {
    const noHall = infernoStartBuildingData();
    delete noHall["1"];
    db.rows.set(INFERNO, infernoRow({ buildingdata: noHall }));
    const none = await inInferno(yardBuildAction, { type: SHARPSHOOTER, x: 200, y: 200 });
    expect(none.status).toBe(409);
    expect(body(none).reason).toBe("townHall");
    expect(body(none).error).toBe("You need an Under Hall before you can build anything.");

    // An Under Hall at level 1 allows two Sharpshooters (`INFERNOYARDPROPS.as:1764`).
    const two = {
      ...infernoStartBuildingData(),
      "6": { id: 6, t: SHARPSHOOTER, X: 200, Y: 200, l: 1 },
      "7": { id: 7, t: SHARPSHOOTER, X: 260, Y: 200, l: 1 },
    } as unknown as Record<string, BuildingData>;
    db.rows.set(INFERNO, infernoRow({ buildingdata: two }));
    const third = await inInferno(yardBuildAction, { type: SHARPSHOOTER, x: 200, y: 300 });
    expect(third.status).toBe(409);
    expect(body(third).reason).toBe("limit");
    expect(body(third).limit).toEqual({ have: 2, allowed: 2, next: 2 });
    expect(body(third).error).toBe("You already have 2. Upgrade your Under Hall to level 2 to build more.");
  });

  test("one worker, whatever the main yard bought", async () => {
    expect((await inInferno(yardBuildAction, { type: SHARPSHOOTER, x: 200, y: 200 })).status).toBe(200);
    const second = await inInferno(yardBuildAction, { type: SHARPSHOOTER, x: 200, y: 300 });
    expect(second.status).toBe(409);
    expect(body(second).reason).toBe("workers");
    expect(body(second).workers).toEqual({ total: 1, busy: 1 });
  });

  test("the Under Hall's Inferno footprint (160 x 160) blocks a spot the surface one would not", async () => {
    // The start Under Hall stands at (-100, 0): 130 wide on the surface, 160 here.
    const answer = await inInferno(yardBuildAction, { type: SHARPSHOOTER, x: -100, y: 140 });
    expect(answer.status).toBe(409);
    expect(body(answer).reason).toBe("placement");
    expect(body(answer)).toMatchObject({ placement: "overlap", with: 1 });
  });

  test("short of Inferno resources: 409 shortfall, though the surface pool could pay", async () => {
    db.rows.set(MAIN, mainRow({ iresources: { r1: 10, r2: 10, r3: 10, r4: 10 } }));
    const answer = await inInferno(yardBuildAction, { type: SHARPSHOOTER, x: 200, y: 200 });
    expect(answer.status).toBe(409);
    expect(body(answer).reason).toBe("shortfall");
    expect(mainSave().resources).toEqual(POOL);
  });

  test("cancelling refunds the Inferno build price into the purse", async () => {
    await inInferno(yardBuildAction, { type: SHARPSHOOTER, x: 200, y: 200 });
    const id = Object.values(buildings(infernoSave())).find((b) => b.t === SHARPSHOOTER)!.id;
    const answer = await inInferno(yardCancelBuildAction, { id });
    expect(answer.status).toBe(200);
    expect(purse()).toEqual(PURSE);
    expect(buildings(infernoSave())[String(id)]).toBeUndefined();
  });

  test("a finished build's points land on the Inferno row, not the main one", async () => {
    const pending = {
      ...infernoStartBuildingData(),
      "6": { id: 6, t: SHARPSHOOTER, X: 200, Y: 200, cB: 5, cL: 5 },
    } as unknown as Record<string, BuildingData>;
    db.rows.set(INFERNO, infernoRow({ buildingdata: pending, savetime: now() - 60 }));
    const answer = await inInferno(yardStateAction);
    expect(answer.status).toBe(200);
    expect(buildings(infernoSave())["6"]!.cB).toBeUndefined();
    expect(Number(infernoSave().points)).toBeGreaterThan(0);
    expect(mainSave().points).toBe("100");
  });
});

describe("upgrading in the Inferno", () => {
  test("an upgrade charges the Inferno table's next step; cancelling gives it back", async () => {
    const step = stepOf(1, 1);
    const answer = await inInferno(yardUpgradeAction, { id: 2 });
    expect(answer.status).toBe(200);
    expect(purse()).toEqual({
      r1: PURSE.r1 - step.r1,
      r2: PURSE.r2 - step.r2,
      r3: PURSE.r3 - step.r3,
      r4: PURSE.r4 - step.r4,
    });
    expect(buildings(infernoSave())["2"]!.cU).toBe(step.time);

    const cancel = await inInferno(yardCancelUpgradeAction, { id: 2 });
    expect(cancel.status).toBe(200);
    expect(purse()).toEqual(PURSE);
  });
});

describe("recycling in the Inferno", () => {
  test("half the Inferno levels' cost back into the purse, clamped to the Inferno cap", async () => {
    db.rows.set(MAIN, mainRow({ iresources: { r1: 0, r2: 0, r3: 0, r4: 0 } }));
    const owed = refundOf(buildings(infernoSave())["2"] as unknown as BuildingData, "inferno");
    const answer = await inInferno(yardRecycleAction, { id: 2 });
    expect(answer.status).toBe(200);
    expect(purse()).toEqual({ ...owed });
    expect(buildings(infernoSave())["2"]).toBeUndefined();

    // Over the cap: a pool already above it stays where it is.
    db.rows.set(MAIN, mainRow({ iresources: { r1: START_CAP, r2: 0, r3: 0, r4: 0 } }));
    db.rows.set(INFERNO, infernoRow());
    await inInferno(yardRecycleAction, { id: 3 });
    expect(purse().r1).toBe(START_CAP);
  });

  test("the Under Hall cannot be recycled", async () => {
    const answer = await inInferno(yardRecycleAction, { id: 1 });
    expect(answer.status).toBe(409);
    expect(body(answer).reason).toBe("isTownHall");
    expect(body(answer).error).toBe("The Under Hall cannot be recycled.");
  });

  test("a Housing Bunker whose monsters would have nowhere to live: 409 housingFull", async () => {
    const yard = {
      ...infernoStartBuildingData(),
      "6": { id: 6, t: HOUSING_BUNKER, X: 200, Y: 200, l: 1 },
    } as unknown as Record<string, BuildingData>;
    db.rows.set(INFERNO, infernoRow({ buildingdata: yard, monsters: { housed: { C1: 1 } } }));
    const answer = await inInferno(yardRecycleAction, { id: 6 });
    expect(answer.status).toBe(409);
    expect(body(answer).reason).toBe("housingFull");

    db.rows.set(INFERNO, infernoRow({ buildingdata: yard }));
    expect((await inInferno(yardRecycleAction, { id: 6 })).status).toBe(200);
  });
});

describe("moving a building (POST /bm/yard/move)", () => {
  test("only X and Y change, on the Inferno row", async () => {
    // A Resource Pod: no buffer for the catch-up to fill.
    const before = buildings(infernoSave())["4"]!;
    const answer = await inInferno(yardMoveAction, { id: 4, x: 200, y: -200 });
    expect(answer.status).toBe(200);
    expect(body(answer).report).toEqual({ id: 4, x: 200, y: -200 });
    expect(buildings(infernoSave())["4"]).toEqual({ ...before, X: 200, Y: -200 });
    expect(purse()).toEqual(PURSE);
  });

  test("onto another building: 409 placement; off the plot: outOfBounds; an unknown id: 400", async () => {
    const onto = await inInferno(yardMoveAction, { id: 2, x: 130, y: 0 });
    expect(onto.status).toBe(409);
    expect(body(onto)).toMatchObject({ reason: "placement", placement: "overlap", with: 4 });

    const off = await inInferno(yardMoveAction, { id: 2, x: 3000, y: 0 });
    expect(off.status).toBe(409);
    expect(body(off)).toMatchObject({ reason: "placement", placement: "outOfBounds" });

    const unknown = await inInferno(yardMoveAction, { id: 77, x: 200, y: 200 });
    expect(unknown.status).toBe(400);
  });

  test("a building may move onto its own old footprint (it does not block itself)", async () => {
    const answer = await inInferno(yardMoveAction, { id: 1, x: -110, y: 10 });
    expect(answer.status).toBe(200);
  });

  test("the Trojan Horse never moves", async () => {
    const yard = { "0": { id: 0, t: 14, X: 0, Y: 0, l: 10 }, "9": { id: 9, t: 27, X: 300, Y: 300 } };
    db.rows.set(MAIN, mainRow({ buildingdata: yard }));
    const answer = await call(yardMoveAction, { id: 9, x: 200, y: 200 });
    expect(answer.status).toBe(409);
    expect(body(answer).reason).toBe("immobile");
  });

  test("works on the main yard too", async () => {
    const answer = await call(yardMoveAction, { id: 0, x: 100, y: 100 });
    expect(answer.status).toBe(200);
    expect(buildings(mainSave())["0"]).toMatchObject({ X: 100, Y: 100 });
  });
});

describe("the catch-up an Inferno action runs", () => {
  test("is the Inferno's: harvesters fill at the Inferno rates", async () => {
    const bone = productionOf(1, "inferno")!;
    db.rows.set(INFERNO, infernoRow({ savetime: now() - 100 }));
    await inInferno(yardStateAction);
    // Ten 10-second cycles of 2 Bone (`INFERNOYARDPROPS.as:22`), give or take the clock's second.
    const st = Number(buildings(infernoSave())["2"]!.st);
    expect(st).toBeGreaterThanOrEqual(10 * bone.produce[0]!);
    expect(st).toBeLessThanOrEqual(11 * bone.produce[0]!);
    // Nothing banked: the purse waits for the bank (WP 1.16).
    expect(purse()).toEqual(PURSE);
  });
});

describe("the Inferno tables the rules read", () => {
  test("storage cap: Inferno Resource Pods, the yard's own packing, no outposts", () => {
    const yard = { type: "inferno", buildingdata: infernoStartBuildingData() };
    expect(storageCap(yard)).toBe(START_CAP);
    expect(storageCap({ ...yard, storedata: { BIP: { q: 2 } } })).toBe(Math.floor(START_CAP * 1.2));
    expect(storageCap({ ...yard, outposts: [[1, 2, "3"]] })).toBe(START_CAP);
  });

  test("footprints: the Under Hall is 160 x 160 and the Academy 80 x 80 in the Inferno", () => {
    expect(footprintOf(14, "inferno")).toMatchObject({ w: 160, h: 160 });
    expect(footprintOf(26, "inferno")).toMatchObject({ w: 80, h: 80 });
    expect(footprintOf(14)).toMatchObject({ w: 130, h: 130 });
  });

  test("one worker in the Inferno; the expansion is the Inferno shop's ENLI", () => {
    expect(workerCount({ BEW: { q: 4 } }, "inferno")).toBe(1);
    expect(currentExpansion({ ENL: { q: 3 } }, "inferno")).toBe(0);
    expect(currentExpansion({ ENLI: { q: 2 } }, "inferno")).toBe(2);
    expect(currentExpansion({ ENLI: { q: 2 } })).toBe(0);
  });

  test("a recycle refund is half the Inferno levels' price", () => {
    const pod = { id: 4, t: 6, l: 3 } as unknown as BuildingData;
    const steps = costOf(6, "inferno")!.costs.slice(0, 3);
    const half = (i: number) => Math.floor(steps.reduce((sum, step) => sum + Number(step[i]), 0) / 2);
    expect(refundOf(pod, "inferno")).toEqual({ r1: half(0), r2: half(1), r3: half(2), r4: half(3) });
  });
});

// WP 1.16: banking, repairs, Shiny finishes and fortification on the Inferno yard.

const INFERNO_CANNON = 130;
const WALL = 17;
const TRAP = 24;

/** The Inferno start layout with the Under Hall at `uhLevel`, plus `extra`. */
const layout = (uhLevel: number, extra: Record<string, Row> = {}) =>
  ({
    ...infernoStartBuildingData(),
    "1": { id: 1, t: 14, X: -100, Y: 0, l: uhLevel },
    ...extra,
  }) as unknown as Record<string, BuildingData>;

/** The Inferno yard with these buildings, saved just now so nothing produces or heals. */
const yardWith = (buildingdata: Record<string, BuildingData>, overrides: Row = {}) =>
  db.rows.set(INFERNO, infernoRow({ buildingdata, savetime: now(), ...overrides }));

/** The start layout with the harvesters' buffers holding `bone` and `coal`. */
const withBuffers = (bone: number, coal = 0) => {
  const yard = layout(1);
  yard["2"] = { ...yard["2"]!, st: bone } as BuildingData;
  yard["3"] = { ...yard["3"]!, st: coal } as BuildingData;
  return yard;
};

const infernoPoints = () => Number(infernoSave().points);

describe("banking in the Inferno (POST /bm/yard/bank)", () => {
  test("a harvester's Bone goes into the Inferno purse; half its amount in points on the Inferno row", async () => {
    yardWith(withBuffers(500));
    const answer = await inInferno(yardBankAction, { ids: "[2]" });
    expect(answer.status).toBe(200);
    expect(purse()).toEqual({ ...PURSE, r1: PURSE.r1 + 500 });
    expect(buildings(infernoSave())["2"]!.st).toBe(0);
    // Flash sets the tutorial to its end stage in the Inferno (`BASE.as:1072-1074`): half points.
    expect(infernoPoints()).toBe(250);
    expect(mainSave().points).toBe("100");
    expect(mainSave().resources).toEqual(POOL);
    // The surface bank goals (BK1-BK4) do not count it.
    expect(mainSave().onboarding).toBeUndefined();
    expect(infernoSave().onboarding).toBeUndefined();
  });

  test("Collect all banks both harvesters", async () => {
    yardWith(withBuffers(300, 200));
    const answer = await inInferno(yardBankAction, { all: 1 });
    expect(answer.status).toBe(200);
    expect(purse()).toEqual({ ...PURSE, r1: PURSE.r1 + 300, r2: PURSE.r2 + 200 });
  });

  test("only up to the Inferno cap; the rest stays in the buffer", async () => {
    db.rows.set(MAIN, mainRow({ iresources: { ...PURSE, r1: START_CAP - 100 } }));
    yardWith(withBuffers(500));
    const answer = await inInferno(yardBankAction, { ids: "[2]" });
    expect(answer.status).toBe(200);
    expect(purse().r1).toBe(START_CAP);
    expect(buildings(infernoSave())["2"]!.st).toBe(400);
    expect((body(answer).report.banked as Row).r1).toBe(100);
    expect((body(answer).report.leftInBuffers as Row).r1).toBe(400);
  });

  test("a purse already over the cap is left where it is", async () => {
    db.rows.set(MAIN, mainRow({ iresources: { ...PURSE, r1: START_CAP + 5000 } }));
    yardWith(withBuffers(500));
    await inInferno(yardBankAction, { ids: "[2]" });
    expect(purse().r1).toBe(START_CAP + 5000);
    expect(buildings(infernoSave())["2"]!.st).toBe(500);
  });
});

describe("repairing in the Inferno", () => {
  test("repair times come from the Inferno props table", () => {
    expect(INFERNO_REPAIR_TIMES[HOUSING_BUNKER]).toEqual([100, 200, 300, 400, 500, 600]);
    expect(REPAIR_TIMES[HOUSING_BUNKER]).toBeUndefined();
    expect(INFERNO_REPAIR_TIMES[INFERNO_CANNON]).toEqual([360, 720, 1440, 2880, 5760, 11520, 23000]);
  });

  const BUNKER_MAX = maxHp(HOUSING_BUNKER, 1, "inferno");
  const damagedBunker = (extra: Row = {}) =>
    layout(1, { "6": { id: 6, t: HOUSING_BUNKER, X: 200, Y: 200, l: 1, hp: 1000, ...extra } });

  test("repair starts a free repair on the damaged building", async () => {
    yardWith(damagedBunker(), { buildinghealthdata: { "6": 1000 } });
    const answer = await inInferno(yardRepairAction, { ids: "[6]" });
    expect(answer.status).toBe(200);
    expect(buildings(infernoSave())["6"]!.rE).toBe(1);
    expect(mainSave().credits).toBe(1000);
    expect(purse()).toEqual(PURSE);
  });

  test("the catch-up heals at the Inferno rate: a Housing Bunker heals in 100 s, not an hour", async () => {
    const rate = Math.ceil(BUNKER_MAX / 100);
    expect(rate).toBeGreaterThan(Math.ceil(BUNKER_MAX / 3600));
    yardWith(damagedBunker({ rE: 1 }), { buildinghealthdata: { "6": 1000 }, savetime: now() - 50 });
    await inInferno(yardStateAction);
    const health = (infernoSave().buildinghealthdata as Record<string, number>)["6"]!;
    // 50 seconds of healing, give or take the clock's second.
    expect(health).toBeGreaterThanOrEqual(1000 + 50 * rate);
    expect(health).toBeLessThanOrEqual(1000 + 51 * rate);
  });

  test("repair now: a few seconds left is free, and the building is whole", async () => {
    // (max - 1000) / rate seconds left, under the 5 free minutes.
    expect(Math.trunc((BUNKER_MAX - 1000) / Math.ceil(BUNKER_MAX / 100))).toBeLessThanOrEqual(300);
    yardWith(damagedBunker({ rE: 1 }), { buildinghealthdata: { "6": 1000 } });
    const answer = await inInferno(yardRepairInstantAction);
    expect(answer.status).toBe(200);
    expect(mainSave().credits).toBe(1000);
    const bunker = buildings(infernoSave())["6"]!;
    expect(bunker.hp).toBeUndefined();
    expect(bunker.rE).toBeUndefined();
    expect(infernoSave().buildinghealthdata).toEqual({});
  });
});

describe("Shiny finishes in the Inferno", () => {
  test("speed-up finishes an Inferno Cannon for the player's Shiny; the Inferno table's points", async () => {
    yardWith(layout(1, { "6": { id: 6, t: INFERNO_CANNON, X: 200, Y: 200, cB: 900, cL: 900 } }));
    const answer = await inInferno(yardSpeedupAction, { id: 6, item: "SP4" });
    expect(answer.status).toBe(200);
    expect(mainSave().credits).toBe(1000 - timeCost(900));
    const cannon = buildings(infernoSave())["6"]!;
    expect(levelOf(cannon as unknown as BuildingData)).toBe(1);
    expect(cannon.cB).toBeUndefined();
    // The Inferno Cannon has no main-table row: these points are the Inferno table's.
    expect(infernoPoints()).toBe(pointsForBuild(costOf(INFERNO_CANNON, "inferno")!.costs[0]!));
    expect(infernoPoints()).toBeGreaterThan(0);
    expect(mainSave().points).toBe("100");
  });

  test("instant build prices from the Inferno table", async () => {
    yardWith(layout(1));
    const answer = await inInferno(yardInstantBuildAction, { type: INFERNO_CANNON, x: 200, y: 200 });
    expect(answer.status).toBe(200);
    expect(mainSave().credits).toBe(1000 - instantBuildPrice(INFERNO_CANNON, "inferno"));
    expect(infernoPoints()).toBe(pointsForBuild(costOf(INFERNO_CANNON, "inferno")!.costs[0]!));
    const cannon = Object.values(buildings(infernoSave())).find((b) => b.t === INFERNO_CANNON)!;
    expect(cannon).toMatchObject({ X: 200, Y: 200 });
    expect(levelOf(cannon as unknown as BuildingData)).toBe(1);
    expect(purse()).toEqual(PURSE);
  });

  test("instant upgrade: gated by the Under Hall, priced from the Inferno table", async () => {
    const cannon = { "6": { id: 6, t: INFERNO_CANNON, X: 200, Y: 200, l: 1 } };
    yardWith(layout(1, cannon));
    const gated = await inInferno(yardInstantUpgradeAction, { id: 6 });
    expect(gated.status).toBe(409);
    expect(mainSave().credits).toBe(1000);

    yardWith(layout(2, cannon));
    const answer = await inInferno(yardInstantUpgradeAction, { id: 6 });
    expect(answer.status).toBe(200);
    expect(mainSave().credits).toBe(1000 - instantUpgradePrice(INFERNO_CANNON, 1, "inferno"));
    expect(buildings(infernoSave())["6"]!.l).toBe(2);
    expect(infernoPoints()).toBe(pointsForUpgrade(costOf(INFERNO_CANNON, "inferno")!.costs[1]!));
  });
});

describe("fortifying in the Inferno", () => {
  test("nothing fortifies there: 400 notFortifiable, and no fortification to cancel", async () => {
    const yard = layout(2, { "6": { id: 6, t: SHARPSHOOTER, X: 200, Y: 200, l: 1 } });
    yardWith(yard);
    const before = structuredClone(infernoSave());
    for (const id of [1, 2, 4, 6]) {
      const answer = await inInferno(yardFortifyAction, { id });
      expect(answer.status).toBe(400);
      expect(body(answer).reason).toBe("notFortifiable");
    }
    const cancel = await inInferno(yardCancelFortifyAction, { id: 6 });
    expect(cancel.status).toBe(409);
    expect(body(cancel).reason).toBe("notFortifying");
    expect(buildings(infernoSave())).toEqual(buildings(before));
    expect(purse()).toEqual(PURSE);
  });
});

describe("walls and traps in the Inferno", () => {
  for (const type of [WALL, TRAP]) {
    test(`type ${type}: built at once from the Inferno purse once the Under Hall allows it`, async () => {
      yardWith(layout(1));
      const refused = await inInferno(yardBuildAction, { type, x: 200, y: 200 });
      expect(refused.status).toBe(409);
      expect(purse()).toEqual(PURSE);

      yardWith(layout(2));
      const step = stepOf(type);
      const answer = await inInferno(yardBuildAction, { type, x: 200, y: 200 });
      expect(answer.status).toBe(200);
      const built = Object.values(buildings(infernoSave())).find((b) => b.t === type)!;
      expect(levelOf(built as unknown as BuildingData)).toBe(1);
      expect(built.cB).toBeUndefined();
      expect(purse()).toEqual({
        r1: PURSE.r1 - step.r1,
        r2: PURSE.r2 - step.r2,
        r3: PURSE.r3 - step.r3,
        r4: PURSE.r4 - step.r4,
      });
      expect(infernoPoints()).toBe(pointsForBuild(costOf(type, "inferno")!.costs[0]!));
    });
  }

  test("a wall upgrades on its own there (no planner): it waits for the Under Hall, then is paid from the purse", async () => {
    const wall = { "6": { id: 6, t: WALL, X: 200, Y: 200, l: 1 } };
    yardWith(layout(2, wall));
    const gated = await inInferno(yardUpgradeAction, { id: 6 });
    expect(gated.status).toBe(409);
    expect(body(gated).townHall).toEqual({ have: 2, need: 3 });

    yardWith(layout(3, wall));
    const answer = await inInferno(yardUpgradeAction, { id: 6 });
    expect(answer.status).toBe(200);
    expect(purse().r2).toBe(PURSE.r2 - stepOf(WALL, 1).r2);
    // A wall's step finishes at once, as on the surface's planner walk: no worker held.
    expect(buildings(infernoSave())["6"]).toMatchObject({ l: 2 });
    expect(buildings(infernoSave())["6"]!.cU).toBeUndefined();
  });
});
