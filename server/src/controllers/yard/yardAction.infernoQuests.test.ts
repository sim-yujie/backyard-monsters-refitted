import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import type z from "zod";
import type { User } from "../../database/models/user.model.js";
import { siloCapacity } from "../../game-data/buildingCosts.js";
import { infernoGoalById } from "../../game-data/infernoGoals.js";
import { hatchCost } from "../../game-data/monsterCatalogue.js";
import type { BaiterTokenStore } from "../../services/goals/baiterRun.js";
import { infernoStartBuildingData } from "../../services/inferno/infernoYard.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardBankAction } from "./bank.js";
import { goalsActions } from "./goalsActions.js";
import { yardStateAction } from "./state.js";
import { runYardAction, type YardAction, type YardAnswer } from "./yardAction.js";

/**
 * The Inferno quests' routes (`docs/design/inferno.md` §2.8, WP 4.1-4.3):
 * `goals/state` and `goals/claim` on the Inferno yard answer its 38 quests,
 * pay into the Inferno purse under the Inferno cap, house monster rewards in
 * the Compound (Housing Bunkers), add points to the Inferno row and pay the
 * five quests' Shiny once to the shared Shiny. Every Inferno yard action
 * marks the quests met and reports the Under Hall's level for achievement
 * 20. The database is in-memory rows, as in `yardAction.infernoMonsters.test.ts`.
 */

type Row = Record<string, unknown>;

const db = { rows: new Map<number, Row>() };

const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => row[key] === value);

const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    const read = new Map<number, Row>();
    const fork = {
      async findOne(_entity: unknown, where: Row, _options?: { lockMode?: LockMode }) {
        const found = [...db.rows.values()].find((row) => matches(row, where));
        if (!found) return null;
        const entity = structuredClone(found);
        read.set(found.basesaveid as number, entity);
        return entity;
      },
      async find() {
        return [];
      },
      // An achievement's notification (`recordNotifications`).
      async insertMany() {},
      async nativeDelete() {},
      getConnection: () => ({ async execute() {} }),
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

const userOf = (): User =>
  ({
    userid: USERID,
    username: "agenttester",
    shiny_locked: false,
    save: { basesaveid: MAIN, baseid: "7" },
  }) as unknown as User;

const now = () => getCurrentDateTime();

const PURSE = { r1: 1_000, r2: 1_000, r3: 1_000, r4: 1_000 };
const POOL = { r1: 1_000_000, r2: 1_000_000, r3: 1_000_000, r4: 1_000_000 };
const SHINY = 1000;

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
  credits: SHINY,
  points: "100",
  flinger: 0,
  catapult: 0,
  resources: { ...POOL },
  iresources: { ...PURSE },
  buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 10 } },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: {},
  academy: {},
  champion: [],
  mushrooms: { l: [], s: now() },
  researchdata: {},
  outposts: [],
  // A save from after Goals: the baseline is done, so the surface badge counts.
  onboarding: { v: 1, guide: { state: "legacy" }, goalsBaseline: 1 },
  ...overrides,
});

/** The Inferno yard with Flash's start layout plus `extra` buildings. */
const infernoRow = (extra: Row[] = [], overrides: Row = {}): Row => ({
  basesaveid: INFERNO,
  baseid: INFERNO_BASEID,
  userid: USERID,
  saveuserid: USERID,
  type: "inferno",
  attackid: 0,
  attacks: [],
  savetime: now(),
  credits: 0,
  points: "0",
  flinger: 0,
  catapult: 0,
  resources: {},
  iresources: {},
  buildingdata: {
    ...infernoStartBuildingData(),
    ...Object.fromEntries(extra.map((building) => [String(building.id), building])),
  },
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

const noTokens: BaiterTokenStore = {
  async issue() {},
  async take() {
    return null;
  },
};
const goals = goalsActions(noTokens);

const call = (action: YardAction<z.ZodType, unknown>, body: Row = {}): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, userOf(), action, body);
const inInferno = (action: YardAction<z.ZodType, unknown>, body: Row = {}) =>
  call(action, { ...body, baseid: INFERNO_BASEID });

const mainSave = () => db.rows.get(MAIN)!;
const infernoSave = () => db.rows.get(INFERNO)!;
const purse = () => {
  const { r1, r2, r3, r4 } = mainSave().iresources as Record<string, number>;
  return { r1, r2, r3, r4 };
};
const body = (answer: YardAnswer) => answer.body as Row & { report: Row; onboarding: { goalsReady: number } };
const infernoRecords = () =>
  (mainSave().onboarding as { infernoGoals?: Record<string, { done?: number; claimed?: number }> }).infernoGoals ?? {};
const achieved = () => (mainSave().achievements as { c?: Record<string, unknown> } | undefined)?.c ?? {};

/** Flash's Inferno start cap: 10,000 plus two level 3 Resource Pods. */
const START_CAP = 10_000 + 2 * siloCapacity(3, "inferno");

const SHARPSHOOTER = { id: 20, t: 21, X: 300, Y: 0, l: 1 };
const QUAKE_TOWER = { id: 21, t: 129, X: 300, Y: 100, l: 1 };
const COMPOUND = { id: 22, t: 128, X: 400, Y: 0, l: 1 };
const UNDER_HALL = (level: number) => ({ id: 1, t: 14, X: -100, Y: 0, l: level });

let infernoEnv: string | undefined;

beforeEach(() => {
  infernoEnv = process.env.INFERNO_ENABLED;
  process.env.INFERNO_ENABLED = "on";
  db.rows = new Map([
    [MAIN, mainRow()],
    [INFERNO, infernoRow()],
  ]);
});

afterEach(() => {
  if (infernoEnv === undefined) delete process.env.INFERNO_ENABLED;
  else process.env.INFERNO_ENABLED = infernoEnv;
});

describe("goals/state on the Inferno yard", () => {
  test("answers the 38 Inferno quests, all shown; the start layout's Resource Pods have IS2 and IS3 ready", async () => {
    const answer = await inInferno(goals.state);
    expect(answer.status).toBe(200);
    const views = body(answer).report.goals as { id: string; status: string; shiny?: number }[];
    expect(views).toHaveLength(38);
    expect(views.filter((view) => view.status === "ready").map((view) => view.id)).toEqual(["IS2", "IS3"]);
    expect(views.find((view) => view.id === "IQT1")!.shiny).toBe(10);
    // Written on the main row's record, apart from the Goals.
    expect(Object.keys(infernoRecords()).sort()).toEqual(["IS2", "IS3"]);
    expect((mainSave().onboarding as { goals?: Row }).goals ?? {}).toEqual({});
    expect(infernoSave().onboarding).toBeUndefined();
    expect(body(answer).onboarding.goalsReady).toBe(2);
  });

  test("the main yard still answers the surface's Goals", async () => {
    const answer = await call(goals.state);
    const ids = (body(answer).report.goals as { id: string }[]).map((view) => view.id);
    expect(ids).not.toContain("IT1");
    expect(ids).not.toContain("IS2");
  });
});

describe("every Inferno yard action marks the quests met", () => {
  test("yard/state on the Inferno marks a finished Sharpshooter's IT1 done and badges it", async () => {
    db.rows.set(INFERNO, infernoRow([SHARPSHOOTER]));
    const answer = await inInferno(yardStateAction);
    expect(answer.status).toBe(200);
    expect(infernoRecords().IT1?.done).toBeNumber();
    expect(body(answer).onboarding.goalsReady).toBe(3);
  });

  test("a main yard action leaves the Inferno quests alone", async () => {
    db.rows.set(INFERNO, infernoRow([SHARPSHOOTER]));
    await call(yardStateAction);
    expect(infernoRecords()).toEqual({});
  });
});

describe("goals/claim on the Inferno yard", () => {
  test("IT1 pays its Bone and Coal into the Inferno purse and its points onto the Inferno row", async () => {
    db.rows.set(INFERNO, infernoRow([SHARPSHOOTER]));
    const answer = await inInferno(goals.claim, { id: "IT1" });
    expect(answer.status).toBe(200);
    expect(body(answer).report).toMatchObject({
      id: "IT1",
      credited: { r1: 2_000, r2: 2_000, r3: 0, r4: 0 },
      points: 80,
    });
    expect(purse()).toEqual({ r1: 3_000, r2: 3_000, r3: 1_000, r4: 1_000 });
    expect(mainSave().resources).toEqual(POOL);
    expect(infernoSave().points).toBe("80");
    expect(mainSave().points).toBe("100");
    expect(mainSave().credits).toBe(SHINY);
    expect(infernoRecords().IT1?.claimed).toBeNumber();
  });

  test("the purse takes only up to the Inferno cap; the report says what was turned away", async () => {
    const nearCap = START_CAP - 5_000;
    db.rows.set(MAIN, mainRow({ iresources: { r1: nearCap, r2: nearCap, r3: nearCap, r4: nearCap } }));
    db.rows.set(INFERNO, infernoRow([QUAKE_TOWER]));
    const answer = await inInferno(goals.claim, { id: "IQT1" });
    expect(answer.status).toBe(200);
    expect(purse()).toEqual({ r1: START_CAP, r2: START_CAP, r3: START_CAP, r4: START_CAP });
    const report = body(answer).report as { credited: Record<string, number>; overflow: Record<string, number> };
    expect(report.credited).toEqual({ r1: 5_000, r2: 5_000, r3: 5_000, r4: 5_000 });
    expect(report.overflow).toEqual({ r1: 25_000, r2: 15_000, r3: 15_000, r4: 15_000 });
  });

  test("a Shiny quest pays its Shiny once, to the shared Shiny on the main row", async () => {
    db.rows.set(INFERNO, infernoRow([QUAKE_TOWER]));
    const first = await inInferno(goals.claim, { id: "IQT1" });
    expect(first.status).toBe(200);
    expect(body(first).report.shiny).toBe(10);
    expect(mainSave().credits).toBe(SHINY + 10);
    expect(infernoSave().credits).toBe(0);
    expect(body(first).credits).toBe(SHINY + 10);

    const second = await inInferno(goals.claim, { id: "IQT1" });
    expect(second.status).toBe(409);
    expect(second.body.reason).toBe("alreadyClaimed");
    expect(mainSave().credits).toBe(SHINY + 10);
  });

  test("a quest with no Shiny pays none", async () => {
    db.rows.set(INFERNO, infernoRow([SHARPSHOOTER]));
    const answer = await inInferno(goals.claim, { id: "IT1" });
    expect(body(answer).report.shiny).toBeUndefined();
    expect(mainSave().credits).toBe(SHINY);
  });

  test("a quest not met is refused notMet; an unknown id unknownGoal; a surface goal is unknown here", async () => {
    expect((await inInferno(goals.claim, { id: "IT1" })).body.reason).toBe("notMet");
    expect((await inInferno(goals.claim, { id: "NOPE" })).body.reason).toBe("unknownGoal");
    expect((await inInferno(goals.claim, { id: "T1" })).body.reason).toBe("unknownGoal");
  });

  test("an Inferno quest cannot be claimed from the main yard", async () => {
    db.rows.set(INFERNO, infernoRow([SHARPSHOOTER]));
    expect((await call(goals.claim, { id: "IT1" })).body.reason).toBe("unknownGoal");
  });

  test("monster rewards move into the Compound, and count for points at their hatch cost", async () => {
    db.rows.set(INFERNO, infernoRow([COMPOUND], { lockerdata: { IC2: { t: 2 } } }));
    const answer = await inInferno(goals.claim, { id: "IUC2" });
    expect(answer.status).toBe(200);
    expect(body(answer).report.monsters).toEqual({ id: "IC2", count: 10 });
    expect((infernoSave().monsters as { housed: Row }).housed).toEqual({ IC2: 10 });
    expect((mainSave().monsters as { housed?: Row }).housed).toBeUndefined();
    expect(body(answer).report.points).toBe(Math.ceil((hatchCost("IC2", 1)! * 10) / 50));
  });

  test("with no Compound room the claim is refused in Flash's words, and nothing is paid", async () => {
    db.rows.set(INFERNO, infernoRow([], { lockerdata: { IC2: { t: 2 } } }));
    const answer = await inInferno(goals.claim, { id: "IUC2" });
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({
      reason: "housing",
      error: "Make room in your Compound for this quest's monsters first.",
      monster: "IC2",
      count: 10,
      free: 0,
    });
    expect(infernoRecords().IUC2?.claimed).toBeUndefined();
  });

  test("goals/state says whether the Compound has room for a ready monster quest", async () => {
    db.rows.set(INFERNO, infernoRow([], { lockerdata: { IC2: { t: 2 } } }));
    const views = body(await inInferno(goals.state)).report.goals as { id: string; room?: boolean }[];
    expect(views.find((view) => view.id === "IUC2")!.room).toBe(false);
  });
});

describe("the bank quests' counter", () => {
  test("an Inferno bank raises infernoBestBank, which IBK1 reads", async () => {
    const buildingdata = infernoStartBuildingData() as Record<string, Row>;
    buildingdata["2"] = { ...buildingdata["2"]!, st: 600 };
    buildingdata["3"] = { ...buildingdata["3"]!, st: 500 };
    db.rows.set(INFERNO, infernoRow([], { buildingdata }));
    const banked = await inInferno(yardBankAction, { all: 1 });
    expect(banked.status).toBe(200);
    const counters = (mainSave().onboarding as { counters: Record<string, number> }).counters;
    expect(counters.infernoBestBank).toBe(1_100);
    expect(counters.bestBank).toBe(0);
    expect(infernoRecords().IBK1?.done).toBeNumber();
    expect((await inInferno(goals.claim, { id: "IBK1" })).status).toBe(200);
  });
});

describe("achievements 20 and 21", () => {
  test("an Inferno action with the Under Hall at level 5 earns 20 (Hall of the Deep)", async () => {
    db.rows.set(INFERNO, infernoRow([UNDER_HALL(4)]));
    await inInferno(yardStateAction);
    expect(achieved()["20"]).toBeUndefined();
    db.rows.set(INFERNO, infernoRow([UNDER_HALL(5)]));
    const answer = await inInferno(yardStateAction);
    // Unlocked on the main row's record (tests hold the paying back, `testing/preload.ts`).
    expect(achieved()["20"]).toMatchObject({ shiny: 15 });
    expect(answer.status).toBe(200);
  });

  test("10 Inferno quests met, none claimed, earn 21 (Hellraiser)", async () => {
    // The start layout meets IS2 and IS3; the Under Hall at 5 meets IC13, IC14, IC15;
    // the Sharpshooter IT1, the Compound ICR3, the Quake Tower IQT1; Zagnoid IUC2, Malphus IUC3.
    db.rows.set(
      INFERNO,
      infernoRow([UNDER_HALL(5), SHARPSHOOTER, COMPOUND, QUAKE_TOWER], { lockerdata: { IC2: { t: 2 }, IC3: { t: 2 } } })
    );
    await inInferno(yardStateAction);
    expect(Object.keys(infernoRecords()).length).toBeGreaterThanOrEqual(10);
    expect(achieved()["21"]).toBeDefined();
  });

  test("with the Inferno switched off neither is offered", async () => {
    db.rows.set(INFERNO, infernoRow([UNDER_HALL(5)]));
    process.env.INFERNO_ENABLED = "off";
    expect((await inInferno(yardStateAction)).status).not.toBe(200);
    expect(achieved()["20"]).toBeUndefined();
  });
});

test("the quest data the route reads is the Inferno's", () => {
  expect(infernoGoalById("IQT1")?.shiny).toBe(10);
});
