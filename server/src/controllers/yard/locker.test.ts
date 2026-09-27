import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type z from "zod";
import type { User } from "../../database/models/user.model.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import {
  yardLockerCancelAction,
  yardLockerFinishAction,
  yardLockerInstantAction,
  yardLockerStartAction,
} from "./locker.js";
import { yardShopBuyAction } from "./shopBuy.js";
import { runYardAction, type YardAction, type YardAnswer } from "./yardAction.js";

/**
 * The Monster Locker routes and `shop/buy item=CLOD` end to end through the
 * real wrapper, the database replaced by one in-memory row written only when
 * the transaction commits (as `shinyRoutes.test.ts` does).
 */

type Row = Record<string, unknown>;

const db = { row: null as Row | null };

const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    const entity = db.row && structuredClone(db.row);
    const fork = { findOne: async () => entity, flush: async () => {} };
    const result = await cb(fork);
    db.row = entity;
    return result;
  },
};

const BASESAVEID = 7;

const userOf = (overrides: Partial<User> = {}): User =>
  ({ userid: 2, shiny_locked: false, save: { basesaveid: BASESAVEID }, ...overrides }) as unknown as User;

/** A main yard saved just now: Town Hall 5, Monster Locker 3, a silo; 1,000 Shiny, 3,000,000 putty (cap 3,850,000). */
const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: BASESAVEID,
  userid: 2,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime(),
  credits: 1000,
  points: "0",
  flinger: 0,
  catapult: 0,
  resources: { r1: 0, r2: 0, r3: 3_000_000, r4: 0 },
  buildingdata: {
    "0": { id: 0, t: 14, X: 0, Y: 0, l: 5 },
    "1": { id: 1, t: 8, X: 100, Y: 100, l: 3 },
    "2": { id: 2, t: 6, X: 200, Y: 200, l: 10 },
  },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: { C1: { t: 2 } },
  academy: { C1: { level: 1 } },
  champion: [],
  mushrooms: {},
  researchdata: {},
  outposts: [],
  ...overrides,
});

const call = (
  action: YardAction<z.ZodType, unknown>,
  body: unknown,
  user: User = userOf()
): Promise<YardAnswer> => runYardAction(em as unknown as EntityManager, user, action, body);

const putty = () => (db.row!.resources as Record<string, number>).r3;
const locker = () => db.row!.lockerdata as Record<string, Row>;

beforeEach(() => {
  db.row = rowOf();
});

describe("start then cancel", () => {
  test("is reversible: putty back in full, the entry gone", async () => {
    const started = await call(yardLockerStartAction, { monster: "C16" });

    expect(started.status).toBe(200);
    expect(started.body.report).toMatchObject({ monster: "C16", cost: { r3: 384_000 } });
    expect(putty()).toBe(3_000_000 - 384_000);
    expect(locker().C16).toMatchObject({ t: 1 });
    expect((locker().C16.e as number) - (locker().C16.s as number)).toBe(129_600);
    // The answer carries the new lockerdata for the client to merge.
    expect(started.body.lockerdata).toEqual(locker());

    const cancelled = await call(yardLockerCancelAction, {});

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.report).toEqual({ monster: "C16", refund: { r3: 384_000 } });
    expect(putty()).toBe(3_000_000);
    expect(locker()).toEqual({ C1: { t: 2 } });
    expect(db.row!.credits).toBe(1000);
  });

  test("not enough putty is the wrapper's shortfall, nothing written", async () => {
    db.row = rowOf({ resources: { r1: 0, r2: 0, r3: 1_000, r4: 0 } });
    const before = structuredClone(db.row);
    const answer = await call(yardLockerStartAction, { monster: "C5" });

    expect(answer).toMatchObject({ status: 409, body: { reason: "shortfall", shortfall: { r3: 63_000 } } });
    expect(db.row).toEqual(before);
  });

  test("a missing monster field is a 400 from the schema", async () => {
    const answer = await call(yardLockerStartAction, {});
    expect(answer).toMatchObject({ status: 400, body: { reason: "badRequest" } });
  });
});

describe("finish and instant", () => {
  test("finish charges timeCost(e − now) and unlocks with academy level 1", async () => {
    await call(yardLockerStartAction, { monster: "C2" });
    const answer = await call(yardLockerFinishAction, {});

    // C2: 3,600 s → min(20, int(sqrt(2,880)) = 53) = 20 (a second off prices the same).
    expect(answer).toMatchObject({ status: 200, body: { report: { monster: "C2", credits: 20 } } });
    expect(db.row!.credits).toBe(980);
    expect(locker().C2).toEqual({ t: 2 });
    expect((db.row!.academy as Row).C2).toEqual({ level: 1 });
    // The putty spent on the start is not returned.
    expect(putty()).toBe(3_000_000 - 8_000);
  });

  test("instant charges Shiny and no putty", async () => {
    const answer = await call(yardLockerInstantAction, { monster: "C5" });

    expect(answer).toMatchObject({ status: 200, body: { report: { monster: "C5", credits: 200 } } });
    expect(db.row!.credits).toBe(800);
    expect(putty()).toBe(3_000_000);
    expect(locker().C5).toEqual({ t: 2 });
  });

  test("a Shiny-locked account cannot finish or instant-unlock", async () => {
    const locked = userOf({ shiny_locked: true });
    expect(await call(yardLockerInstantAction, { monster: "C5" }, locked)).toMatchObject({
      status: 409,
      body: { reason: "shinyLocked" },
    });
    await call(yardLockerStartAction, { monster: "C5" });
    expect(await call(yardLockerFinishAction, {}, locked)).toMatchObject({
      status: 409,
      body: { reason: "shinyLocked" },
    });
  });

  test("not enough Shiny for instant is credits {have, need}", async () => {
    db.row = rowOf({ credits: 10 });
    expect(await call(yardLockerInstantAction, { monster: "C5" })).toMatchObject({
      status: 409,
      body: { reason: "credits", credits: { have: 10, need: 200 } },
    });
  });
});

describe("shop/buy item=CLOD", () => {
  test("refused while no unlock runs", async () => {
    expect(await call(yardShopBuyAction, { item: "CLOD" })).toMatchObject({
      status: 409,
      body: { reason: "notUnlocking" },
    });
    expect(db.row!.credits).toBe(1000);
  });

  test("60 Shiny for four hours while an unlock runs; not twice", async () => {
    await call(yardLockerStartAction, { monster: "C17" });
    const answer = await call(yardShopBuyAction, { item: "CLOD" });

    expect(answer.status).toBe(200);
    const report = answer.body.report as { credits: number; endsAt: number };
    expect(report.credits).toBe(60);
    expect(db.row!.credits).toBe(940);
    const entry = (db.row!.storedata as Record<string, Row>).CLOD;
    expect((entry.e as number) - (entry.s as number)).toBe(14_400);

    expect(await call(yardShopBuyAction, { item: "CLOD" })).toMatchObject({
      status: 409,
      body: { reason: "alreadyActive" },
    });
  });
});
