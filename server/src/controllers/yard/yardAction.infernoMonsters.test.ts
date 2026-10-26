import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import type z from "zod";
import type { User } from "../../database/models/user.model.js";
import { siloCapacity } from "../../game-data/buildingCosts.js";
import { hatchCost, monsterEntry, trainingStep } from "../../game-data/monsterCatalogue.js";
import { infernoStartBuildingData } from "../../services/inferno/infernoYard.js";
import { INFERNO_TOP_TRAINING_LEVEL } from "../../services/yard/academy.js";
import { juiceGoo, juicerRate } from "../../services/yard/juice.js";
import { instantUnlockPrice } from "../../services/yard/shiny.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardAcademyTrainAction } from "./academy.js";
import { yardHatcheryAddAction, yardHatcheryFinishAction } from "./hatchery.js";
import { yardJuiceAction } from "./juice.js";
import { yardLockerCancelAction, yardLockerInstantAction, yardLockerStartAction } from "./locker.js";
import { yardStateAction } from "./state.js";
import { runYardAction, type YardAction, type YardAnswer } from "./yardAction.js";

/**
 * The Inferno monsters' routes (`docs/design/inferno.md` §5, WP 2.1-2.3):
 * Monster Locker, Monster Academy, Incubator, Housing Bunker and Monster
 * Juicer on the Inferno yard, paid from the Inferno purse (the main save's
 * `iresources`), and Inferno monsters juiced on the main yard. The database
 * is in-memory rows, as in `yardAction.inferno.test.ts`.
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
/** The purse's amounts; its caps are {@link caps}. */
const purse = () => {
  const { r1max: _r1, r2max: _r2, r3max: _r3, r4max: _r4, ...amounts } = mainSave().iresources as Record<string, number>;
  return amounts;
};
/** The main yard's Inferno caps, as the main save's `iresources` holds them. */
const caps = () => {
  const { r1max, r2max, r3max, r4max } = mainSave().iresources as Record<string, number>;
  return { r1max, r2max, r3max, r4max };
};
const body = (answer: YardAnswer) => answer.body as Row & { report: Row };

/** Flash's Inferno start cap: 10,000 plus two level 3 Resource Pods. */
const START_CAP = 10_000 + 2 * siloCapacity(3, "inferno");

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

const LOCKER = { id: 6, t: 8, X: 300, Y: 0, l: 1 };
const ACADEMY = { id: 7, t: 26, X: 300, Y: 100, l: 4 };
const INCUBATOR = { id: 8, t: 13, X: 300, Y: 200, l: 1 };
const BUNKER = { id: 9, t: HOUSING_BUNKER, X: 400, Y: 0, l: 1 };
const JUICER = { id: 10, t: 9, X: 400, Y: 100, l: 1 };
const TOWN_HALL = { id: 0, t: 14, X: 0, Y: 0, l: 10 };
const HOUSING = { id: 11, t: 15, X: 400, Y: 200, l: 6 };

/** The Inferno yard's start layout plus `extra` buildings. */
const infernoWith = (extra: Row[], overrides: Row = {}): Row =>
  infernoRow({
    buildingdata: {
      ...infernoStartBuildingData(),
      ...Object.fromEntries(extra.map((building) => [String(building.id), building])),
    },
    ...overrides,
  });

/** The main yard with a Town Hall and `extra` buildings. */
const mainWith = (extra: Row[], overrides: Row = {}): Row =>
  mainRow({
    buildingdata: Object.fromEntries([TOWN_HALL, ...extra].map((building) => [String(building.id), building])),
    ...overrides,
  });

const lockerdata = () => infernoSave().lockerdata as Record<string, Row>;
const academyOf = () => infernoSave().academy as Record<string, Row>;
const infernoBuilding = (id: number) => (infernoSave().buildingdata as Record<string, Row>)[String(id)]!;
const housed = (row: Row) => (row.monsters as { housed?: Record<string, number> }).housed;
const juicedCount = () =>
  Number((mainSave().onboarding as { counters?: { juiced?: number } } | undefined)?.counters?.juiced ?? 0);

describe("Monster Locker in the Inferno", () => {
  test("Spurtz (IC1) is always unlocked there, and the Pokey is not", async () => {
    expect((await inInferno(yardStateAction)).status).toBe(200);
    expect(lockerdata().IC1).toEqual({ t: 2 });
    expect(lockerdata().C1).toBeUndefined();
  });

  test("an unlock charges the catalogue's Sulfur from the purse and lands on the Inferno row", async () => {
    db.rows.set(INFERNO, infernoWith([LOCKER]));
    const answer = await inInferno(yardLockerStartAction, { monster: "IC2" });
    expect(answer.status).toBe(200);
    const price = monsterEntry("IC2")!.resource;
    expect(body(answer).report).toMatchObject({ monster: "IC2", cost: { r3: price } });
    expect(purse().r3).toBe(PURSE.r3 - price);
    expect(lockerdata().IC2).toMatchObject({ t: 1 });
    expect((mainSave().lockerdata as Row).IC2).toBeUndefined();
    // The surface pool is not touched.
    expect(mainSave().resources).toEqual(POOL);

    // Cancelling gives the Sulfur back into the purse.
    expect((await inInferno(yardLockerCancelAction)).status).toBe(200);
    expect(purse().r3).toBe(PURSE.r3);
    expect(lockerdata().IC2).toBeUndefined();
  });

  test("a surface monster cannot be unlocked there: 400 badRequest", async () => {
    db.rows.set(INFERNO, infernoWith([LOCKER]));
    expect((await inInferno(yardLockerStartAction, { monster: "C2" })).status).toBe(400);
    expect(purse()).toEqual(PURSE);
  });

  test("an Inferno monster cannot be unlocked on the main yard: 400 badRequest", async () => {
    db.rows.set(MAIN, mainWith([LOCKER]));
    expect((await call(yardLockerStartAction, { monster: "IC2" })).status).toBe(400);
  });

  test("the Inferno Locker gates: no Locker, its level, the starter already unlocked", async () => {
    expect(await inInferno(yardLockerStartAction, { monster: "IC2" })).toMatchObject({
      status: 409,
      body: { reason: "noLocker" },
    });
    db.rows.set(INFERNO, infernoWith([LOCKER]));
    expect(await inInferno(yardLockerStartAction, { monster: "IC3" })).toMatchObject({
      status: 409,
      body: { reason: "lockerLevel", have: 1, need: monsterEntry("IC3")!.level },
    });
    expect(await inInferno(yardLockerStartAction, { monster: "IC1" })).toMatchObject({
      status: 409,
      body: { reason: "alreadyUnlocked" },
    });
  });

  test("an instant unlock is paid in the player's Shiny, no Sulfur", async () => {
    db.rows.set(MAIN, mainRow({ credits: 100_000 }));
    db.rows.set(INFERNO, infernoWith([LOCKER]));
    expect((await inInferno(yardLockerInstantAction, { monster: "IC2" })).status).toBe(200);
    const { time, resource } = monsterEntry("IC2")!;
    expect(mainSave().credits).toBe(100_000 - instantUnlockPrice(time, resource));
    expect(purse()).toEqual(PURSE);
    expect(lockerdata().IC2).toEqual({ t: 2 });
    expect(academyOf().IC2).toEqual({ level: 1 });
  });

  test("the catch-up finishes an Inferno unlock that has run out", async () => {
    db.rows.set(
      INFERNO,
      infernoWith([LOCKER], { lockerdata: { IC1: { t: 2 }, IC2: { t: 1, s: now() - 20_000, e: now() - 10 } } })
    );
    expect((await inInferno(yardStateAction)).status).toBe(200);
    expect(lockerdata().IC2).toEqual({ t: 2 });
    expect(academyOf().IC2).toEqual({ level: 1 });
  });
});

describe("Monster Academy in the Inferno", () => {
  test("training an Inferno monster charges the step's Sulfur from the purse", async () => {
    db.rows.set(INFERNO, infernoWith([ACADEMY], { academy: { IC1: { level: 4 } } }));
    const answer = await inInferno(yardAcademyTrainAction, { monster: "IC1" });
    expect(answer.status).toBe(200);
    const [sulfur] = trainingStep("IC1", 4)!;
    expect(body(answer).report).toMatchObject({ monster: "IC1", academy: ACADEMY.id, to: 5, cost: { r3: sulfur } });
    expect(purse().r3).toBe(PURSE.r3 - sulfur);
    expect(infernoBuilding(ACADEMY.id).upg).toBe("IC1");
  });

  test(`level ${INFERNO_TOP_TRAINING_LEVEL} is the top in the Inferno: 409 maxLevel`, async () => {
    db.rows.set(INFERNO, infernoWith([ACADEMY], { academy: { IC1: { level: INFERNO_TOP_TRAINING_LEVEL } } }));
    // The table has a further step, which Flash's four-level Inferno Academy never reached.
    expect(trainingStep("IC1", INFERNO_TOP_TRAINING_LEVEL)).toBeDefined();
    expect(await inInferno(yardAcademyTrainAction, { monster: "IC1" })).toMatchObject({
      status: 409,
      body: { reason: "maxLevel", monster: "IC1", level: INFERNO_TOP_TRAINING_LEVEL },
    });
    expect(purse()).toEqual(PURSE);
  });

  test("a surface monster cannot be trained there", async () => {
    db.rows.set(INFERNO, infernoWith([ACADEMY], { lockerdata: { IC1: { t: 2 }, C1: { t: 2 } } }));
    const answer = await inInferno(yardAcademyTrainAction, { monster: "C1" });
    expect(answer.status).toBe(400);
    expect(purse()).toEqual(PURSE);
  });

  test("the catch-up finishes an Inferno training that has run out", async () => {
    db.rows.set(
      INFERNO,
      infernoWith([{ ...ACADEMY, upg: "IC1" }], {
        academy: { IC1: { level: 4, time: now() - 10, duration: 14_400 } },
      })
    );
    expect((await inInferno(yardStateAction)).status).toBe(200);
    expect(academyOf().IC1).toMatchObject({ level: 5 });
    expect(infernoBuilding(ACADEMY.id).upg).toBeUndefined();
  });
});

describe("Incubator and Housing Bunker in the Inferno", () => {
  test("hatching an Inferno monster charges its Magma from the purse", async () => {
    db.rows.set(INFERNO, infernoWith([INCUBATOR, BUNKER]));
    const answer = await inInferno(yardHatcheryAddAction, { hatchery: INCUBATOR.id, monster: "IC1", count: 2 });
    expect(answer.status).toBe(200);
    const price = hatchCost("IC1", 1)!;
    expect(body(answer).report).toMatchObject({ monster: "IC1", added: 2, cost: { r4: 2 * price } });
    expect(purse().r4).toBe(PURSE.r4 - 2 * price);
    expect(mainSave().resources).toEqual(POOL);
  });

  test("a surface monster cannot be hatched there, nor an Inferno one on the main yard", async () => {
    db.rows.set(INFERNO, infernoWith([INCUBATOR], { lockerdata: { IC1: { t: 2 }, C1: { t: 2 } } }));
    const surface = await inInferno(yardHatcheryAddAction, { hatchery: INCUBATOR.id, monster: "C1", count: 1 });
    expect(surface.status).toBe(400);
    db.rows.set(MAIN, mainWith([INCUBATOR], { lockerdata: { IC1: { t: 2 } } }));
    const inferno = await call(yardHatcheryAddAction, { hatchery: INCUBATOR.id, monster: "IC1", count: 1 });
    expect(inferno.status).toBe(400);
  });

  test("the Housing Bunkers are the Inferno's housing: none is housingFull, one houses the hatch", async () => {
    db.rows.set(MAIN, mainRow({ credits: 100_000 }));
    db.rows.set(INFERNO, infernoWith([INCUBATOR]));
    await inInferno(yardHatcheryAddAction, { hatchery: INCUBATOR.id, monster: "IC1", count: 2 });
    expect(await inInferno(yardHatcheryFinishAction, { hatchery: INCUBATOR.id })).toMatchObject({
      status: 409,
      body: { reason: "housingFull", free: 0 },
    });

    const row = infernoSave();
    db.rows.set(INFERNO, { ...row, buildingdata: { ...(row.buildingdata as Row), [String(BUNKER.id)]: BUNKER } });
    const answer = await inInferno(yardHatcheryFinishAction, { hatchery: INCUBATOR.id });
    expect(answer).toMatchObject({ status: 200, body: { report: { housed: { IC1: 2 } } } });
    expect(housed(infernoSave())).toEqual({ IC1: 2 });
  });

  test("a level 1 Housing Bunker holds 200: 13 Spurtz (15 each) leave 5 free", async () => {
    db.rows.set(MAIN, mainRow({ credits: 100_000 }));
    db.rows.set(INFERNO, infernoWith([INCUBATOR, BUNKER], { monsters: { housed: { IC1: 13 } } }));
    await inInferno(yardHatcheryAddAction, { hatchery: INCUBATOR.id, monster: "IC1", count: 1 });
    expect(await inInferno(yardHatcheryFinishAction, { hatchery: INCUBATOR.id })).toMatchObject({
      status: 409,
      body: { reason: "housingFull", free: 5 },
    });
  });
});

describe("Monster Juicer and Inferno monsters", () => {
  const each = juiceGoo("IC1", 1, {}, juicerRate(1));

  test("on the Inferno yard an Inferno monster juices into Magma, up to the Inferno cap", async () => {
    db.rows.set(MAIN, mainRow({ iresources: { ...PURSE, r4: START_CAP - each } }));
    db.rows.set(INFERNO, infernoWith([JUICER, BUNKER], { monsters: { housed: { IC1: 4 } } }));
    const answer = await inInferno(yardJuiceAction, { monsters: JSON.stringify({ IC1: 3 }) });
    expect(answer.status).toBe(200);
    expect(body(answer).report).toMatchObject({ juiced: { IC1: 3 }, goo: 0, magma: each, magmaLost: 2 * each });
    expect(purse().r4).toBe(START_CAP);
    expect(housed(infernoSave())).toEqual({ IC1: 1 });
    expect(mainSave().resources).toEqual(POOL);
    // Goals BL1-BL4 are the surface tutorial's: an Inferno monster does not count.
    expect(juicedCount()).toBe(0);
  });

  test("a surface monster cannot be juiced on the Inferno yard: 400 badRequest", async () => {
    db.rows.set(INFERNO, infernoWith([JUICER, BUNKER], { monsters: { housed: { C1: 4 } } }));
    expect((await inInferno(yardJuiceAction, { monsters: JSON.stringify({ C1: 1 }) })).status).toBe(400);
    expect(housed(infernoSave())).toEqual({ C1: 4 });
  });

  test("on the main yard an Inferno monster's Magma goes into the Inferno purse, up to its cap", async () => {
    db.rows.set(
      MAIN,
      mainWith([JUICER, HOUSING], {
        monsters: { housed: { IC1: 2, C1: 1 } },
        iresources: {
          ...PURSE,
          r4: START_CAP - each,
          r1max: START_CAP,
          r2max: START_CAP,
          r3max: START_CAP,
          r4max: START_CAP,
        },
      })
    );
    const answer = await call(yardJuiceAction, { monsters: JSON.stringify({ IC1: 2, C1: 1 }) });
    expect(answer.status).toBe(200);
    expect(body(answer).report).toMatchObject({ magma: each, magmaLost: each });
    expect(purse().r4).toBe(START_CAP);
    expect(caps().r4max).toBe(START_CAP);
    expect(housed(mainSave())).toEqual({});
    // Only the surface monster counts towards BL1-BL4.
    expect(juicedCount()).toBe(1);
  });
});
