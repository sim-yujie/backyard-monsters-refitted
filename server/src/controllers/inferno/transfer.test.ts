import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import type z from "zod";
import type { User } from "../../database/models/user.model.js";
import { monsterStorage } from "../../services/monsters/transferRules.js";
import { infernoStartBuildingData } from "../../services/inferno/infernoYard.js";
import { planInfernoTransfer } from "../../services/inferno/transfer.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { runYardAction, type YardAction, type YardAnswer } from "../yard/yardAction.js";
import { infernoTransferAction } from "./transfer.js";

/**
 * The Inferno monster transfer (`docs/design/inferno.md` §2.7, WP 2.5):
 * Inferno monsters only, from the Compound, limited by the main yard's
 * Housing, free, one way. The database is in-memory rows, as in
 * `controllers/yard/yardAction.infernoMonsters.test.ts`.
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
    // A refusal rolls back: nothing read is written.
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

const POOL = { r1: 1_000_000, r2: 1_000_000, r3: 1_000_000, r4: 1_000_000 };
const PURSE = { r1: 60_000, r2: 60_000, r3: 60_000, r4: 60_000 };

const TOWN_HALL = { id: 0, t: 14, X: 0, Y: 0, l: 10 };
/** Main-yard Housing at level 1: 200 places. */
const HOUSING = { id: 11, t: 15, X: 400, Y: 200, l: 1 };
const BUNKER = { id: 9, t: 128, X: 400, Y: 0, l: 1 };

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
  buildingdata: { "0": TOWN_HALL, "11": HOUSING },
  buildinghealthdata: {},
  storedata: {},
  monsters: { housed: { C1: 5 } },
  lockerdata: {},
  academy: {},
  champion: [],
  mushrooms: { l: [], s: now() },
  researchdata: {},
  outposts: [],
  ...overrides,
});

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
  buildingdata: { ...infernoStartBuildingData(), "9": BUNKER },
  buildinghealthdata: {},
  storedata: {},
  monsters: { housed: { IC1: 6, IC2: 2 } },
  lockerdata: {},
  academy: {},
  champion: [],
  mushrooms: {},
  researchdata: {},
  outposts: [],
  ...overrides,
});

const call = (body: Row, action: YardAction<z.ZodType, unknown> = infernoTransferAction): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, userOf(), action, body);

const transfer = (monsters: Record<string, number>) => call({ monsters: JSON.stringify(monsters) });

const housed = (id: number) => (db.rows.get(id)!.monsters as { housed?: Record<string, number> }).housed;
const reason = (answer: YardAnswer) => (answer.body as Row).reason;

let infernoEnv: string | undefined;

beforeEach(() => {
  infernoEnv = process.env.INFERNO_ENABLED;
  process.env.INFERNO_ENABLED = "on";
  db.rows = new Map([
    [MAIN, mainRow()],
    [INFERNO, infernoRow()],
  ]);
  db.locked = [];
});

afterEach(() => {
  if (infernoEnv === undefined) delete process.env.INFERNO_ENABLED;
  else process.env.INFERNO_ENABLED = infernoEnv;
});

describe("POST /bm/inferno/transfer", () => {
  test("brings Inferno monsters up from the Compound into the main yard's Housing, free", async () => {
    const answer = await transfer({ IC1: 4, IC2: 1 });
    expect(answer.status).toBe(200);
    expect(housed(MAIN)).toEqual({ C1: 5, IC1: 4, IC2: 1 });
    expect(housed(INFERNO)).toEqual({ IC1: 2, IC2: 1 });
    // Free: neither the pool, the purse nor the Shiny moves.
    expect(db.rows.get(MAIN)!.resources).toEqual(POOL);
    expect((db.rows.get(MAIN)!.iresources as Row).r4).toBe(PURSE.r4);
    expect(db.rows.get(MAIN)!.credits).toBe(1000);
    // The answer is the main yard's state, with the plan.
    const body = answer.body as Row & { report: Row; monsters: Row };
    expect(body.monsters.housed).toEqual({ C1: 5, IC1: 4, IC2: 1 });
    expect(body.report).toMatchObject({ moved: { IC1: 4, IC2: 1 }, compound: { IC1: 2, IC2: 1 }, capacity: 200 });
  });

  test("locks the main yard first, then the Inferno yard", async () => {
    await transfer({ IC1: 1 });
    expect(db.locked).toEqual([MAIN, INFERNO]);
  });

  test("a surface monster cannot come up: 400 notInferno", async () => {
    db.rows.set(INFERNO, infernoRow({ monsters: { housed: { IC1: 6, C2: 3 } } }));
    const answer = await transfer({ C2: 1 });
    expect(answer.status).toBe(400);
    expect(reason(answer)).toBe("notInferno");
    expect(housed(INFERNO)).toEqual({ IC1: 6, C2: 3 });
    expect(housed(MAIN)).toEqual({ C1: 5 });
  });

  test("more than the Compound holds: 409 notEnough", async () => {
    const answer = await transfer({ IC2: 3 });
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ reason: "notEnough", monster: "IC2", have: 2, need: 3 });
    expect(housed(INFERNO)).toEqual({ IC1: 6, IC2: 2 });
  });

  test("more than the main yard's Housing holds: 409 noRoom, nothing moves", async () => {
    // 200 places on the main yard: more Spurtz than fit there even without the Pokeys.
    const many = Math.floor(200 / monsterStorage("IC1")) + 1;
    // A level 4 Housing Bunker (780) holds them all in the Inferno.
    db.rows.set(
      INFERNO,
      infernoRow({
        buildingdata: { ...infernoStartBuildingData(), "9": { ...BUNKER, l: 4 } },
        monsters: { housed: { IC1: many } },
      })
    );
    const answer = await transfer({ IC1: many });
    expect(answer.status).toBe(409);
    expect(reason(answer)).toBe("noRoom");
    expect(housed(INFERNO)).toEqual({ IC1: many });
    expect(housed(MAIN)).toEqual({ C1: 5 });
  });

  test("exactly filling the Housing is allowed", async () => {
    const free = 200 - 5 * monsterStorage("C1");
    const fit = Math.floor(free / monsterStorage("IC1"));
    db.rows.set(INFERNO, infernoRow({ monsters: { housed: { IC1: fit + 3 } } }));
    expect((await transfer({ IC1: fit })).status).toBe(200);
    expect((await transfer({ IC1: 1 })).status).toBe(409);
  });

  test("the Housing Expansion counts on the main yard", async () => {
    const free = Math.trunc(200 * 1.25) - 5 * monsterStorage("C1");
    const fit = Math.floor(free / monsterStorage("IC1"));
    db.rows.set(MAIN, mainRow({ storedata: { EXH: { e: now() + 3600 } } }));
    db.rows.set(INFERNO, infernoRow({ monsters: { housed: { IC1: fit } } }));
    expect((await transfer({ IC1: fit })).status).toBe(200);
  });

  test("Housing at 10 health or less houses nothing", async () => {
    db.rows.set(MAIN, mainRow({ buildinghealthdata: { "11": 10 } }));
    const answer = await transfer({ IC1: 1 });
    expect(answer.status).toBe(409);
    expect(reason(answer)).toBe("noRoom");
  });

  test("no Inferno yard yet: 409 noInfernoYard", async () => {
    db.rows.set(MAIN, mainRow({ baseid_inferno: 0 }));
    const answer = await transfer({ IC1: 1 });
    expect(answer.status).toBe(409);
    expect(reason(answer)).toBe("noInfernoYard");
  });

  test("refused while the new Inferno is off: 403 infernoOff", async () => {
    process.env.INFERNO_ENABLED = "off";
    const answer = await transfer({ IC1: 1 });
    expect(answer.status).toBe(403);
    expect(housed(MAIN)).toEqual({ C1: 5 });
  });

  test("refused while the Inferno yard is being attacked: 409 underAttack", async () => {
    db.rows.set(INFERNO, infernoRow({ attackid: 1, attacks: [{ starttime: now() }] }));
    const answer = await transfer({ IC1: 1 });
    expect(answer.status).toBe(409);
    expect(housed(INFERNO)).toEqual({ IC1: 6, IC2: 2 });
  });

  test("only from the main yard: refused on the Inferno yard", async () => {
    const answer = await call({ monsters: JSON.stringify({ IC1: 1 }), baseid: INFERNO_BASEID });
    expect(answer.status).toBe(409);
    expect(housed(INFERNO)).toEqual({ IC1: 6, IC2: 2 });
  });

  test("an empty or malformed request: 400", async () => {
    expect((await call({ monsters: "{}" })).status).toBe(400);
    expect((await call({ monsters: JSON.stringify({ IC1: -1 }) })).status).toBe(400);
    expect((await call({})).status).toBe(400);
  });
});

describe("planInfernoTransfer", () => {
  test("applies the counts as a delta, leaving every other monster where it is", () => {
    const plan = planInfernoTransfer({
      moved: { IC3: 1 },
      compound: { IC1: 2, IC3: 1 },
      housed: { C4: 2 },
      capacity: 10_000,
    });
    expect(plan.compound).toEqual({ IC1: 2 });
    expect(plan.housed).toEqual({ C4: 2, IC3: 1 });
    expect(plan.used).toBe(2 * monsterStorage("C4") + monsterStorage("IC3"));
  });

  test("an unknown Inferno id is refused like a surface one", () => {
    expect(() => planInfernoTransfer({ moved: { IC99: 1 }, compound: { IC99: 1 }, housed: {}, capacity: 1000 })).toThrow();
  });
});
