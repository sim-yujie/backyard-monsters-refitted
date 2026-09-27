import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type z from "zod";
import type { User } from "../../database/models/user.model.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import {
  yardHatcheryAddAction,
  yardHatcheryFinishAction,
  yardHatcheryRemoveAction,
} from "./hatchery.js";
import { yardShopBuyAction } from "./shopBuy.js";
import { runYardAction, type YardAction, type YardAnswer } from "./yardAction.js";

/**
 * The hatchery routes and `shop/buy item=HOD|HOD2|HOD3|EXH` end to end through
 * the real wrapper, the database replaced by one in-memory row written only
 * when the transaction commits (as `locker.test.ts` does). The stand-in counts
 * transactions and flushes, so "one request, one write" is checked, not
 * assumed.
 */

type Row = Record<string, unknown>;

const db = { row: null as Row | null, transactions: 0, flushes: 0 };

const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    db.transactions += 1;
    const entity = db.row && structuredClone(db.row);
    const fork = {
      findOne: async () => entity,
      flush: async () => {
        db.flushes += 1;
      },
    };
    const result = await cb(fork);
    db.row = entity;
    return result;
  },
};

const BASESAVEID = 7;

const userOf = (overrides: Partial<User> = {}): User =>
  ({
    userid: 2,
    shiny_locked: false,
    save: { basesaveid: BASESAVEID },
    ...overrides,
  }) as unknown as User;

/**
 * A main yard saved just now: Town Hall 5, a silo (cap 3,850,000), two level 3
 * hatcheries, one level 6 Housing (540); 1,000 Shiny, 1,000,000 goo; Pokey
 * (C1, 250 goo, 15 s, 10 space) unlocked.
 */
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
  resources: { r1: 0, r2: 0, r3: 0, r4: 1_000_000 },
  buildingdata: {
    "0": { id: 0, t: 14, X: 0, Y: 0, l: 5 },
    "1": { id: 1, t: 13, X: 100, Y: 100, l: 3 },
    "2": { id: 2, t: 13, X: 200, Y: 100, l: 3 },
    "3": { id: 3, t: 6, X: 300, Y: 300, l: 10 },
    "4": { id: 4, t: 15, X: 400, Y: 400, l: 6 },
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

const goo = () => (db.row!.resources as Record<string, number>).r4;
const monsters = () => db.row!.monsters as Row;

beforeEach(() => {
  db.row = rowOf();
  db.transactions = 0;
  db.flushes = 0;
});

describe("hatchery/add", () => {
  test("a batch of 80 is one request and one write", async () => {
    const answer = await call(yardHatcheryAddAction, { hatchery: "1", monster: "C1", count: "80" });

    expect(answer.status).toBe(200);
    expect(answer.body.report).toEqual({
      hatchery: 1,
      monster: "C1",
      added: 80,
      requested: 80,
      stoppedBy: null,
      cost: { r4: 20_000 },
    });
    expect(db.transactions).toBe(1);
    expect(db.flushes).toBe(1);
    expect(goo()).toBe(1_000_000 - 20_000);
    // The answer carries the new monsters blob for the client to merge.
    expect(answer.body.monsters).toEqual(monsters());
    expect((monsters().h as unknown[][])[0]).toEqual([
      "C1",
      15,
      [
        ["C1", 20, 1],
        ["C1", 20, 1],
        ["C1", 20, 1],
        ["C1", 19, 1],
      ],
      1,
    ]);
  });

  test("partial by design: what fits goes in, the report says why the rest did not", async () => {
    const answer = await call(yardHatcheryAddAction, { hatchery: 1, monster: "C1", count: 100 });
    expect(answer.body.report).toMatchObject({ added: 81, requested: 100, stoppedBy: "queue" });
    expect(goo()).toBe(1_000_000 - 81 * 250);
  });

  test("the body is checked: count 1..400, a hatchery id or hcc", async () => {
    for (const body of [
      { hatchery: 1, monster: "C1", count: 0 },
      { hatchery: 1, monster: "C1", count: 401 },
      { hatchery: "left", monster: "C1", count: 1 },
      { hatchery: 1, count: 1 },
    ]) {
      expect(await call(yardHatcheryAddAction, body)).toMatchObject({
        status: 400,
        body: { reason: "badRequest" },
      });
    }
    expect(db.transactions).toBe(0);
  });

  test("a refusal writes nothing", async () => {
    const before = structuredClone(db.row);
    expect(
      await call(yardHatcheryAddAction, { hatchery: "hcc", monster: "C1", count: 5 })
    ).toMatchObject({
      status: 409,
      body: { reason: "noHcc" },
    });
    expect(
      await call(yardHatcheryAddAction, { hatchery: 1, monster: "C2", count: 5 })
    ).toMatchObject({
      status: 409,
      body: { reason: "locked", monster: "C2" },
    });
    expect(db.row).toEqual(before);
  });
});

describe("add then remove", () => {
  test("is reversible: the goo comes back in full", async () => {
    await call(yardHatcheryAddAction, { hatchery: 1, monster: "C1", count: 45 });
    expect(goo()).toBe(1_000_000 - 45 * 250);

    // Stacks 1 and 2, then 3 (the one that shifted up), then the one in production.
    const first = await call(yardHatcheryRemoveAction, { hatchery: 1, slot: 1, count: "all" });
    expect(first.body.report).toEqual({
      hatchery: 1,
      slot: 1,
      monster: "C1",
      removed: 20,
      refund: { r4: 5_000 },
    });
    await call(yardHatcheryRemoveAction, { hatchery: 1, slot: 1, count: "all" });
    await call(yardHatcheryRemoveAction, { hatchery: 1, slot: 1, count: "all" });
    const last = await call(yardHatcheryRemoveAction, { hatchery: 1, slot: 0 });
    expect(last.body.report).toMatchObject({ slot: 0, removed: 1, refund: { r4: 250 } });

    expect(goo()).toBe(1_000_000);
    expect((monsters().h as unknown[][])[0]).toEqual(["", 0, []]);
    expect(db.row!.credits).toBe(1000);
  });

  test("an empty slot is 409 noSlot", async () => {
    expect(await call(yardHatcheryRemoveAction, { hatchery: 2, slot: 0, count: 1 })).toMatchObject({
      status: 409,
      body: { reason: "noSlot", slot: 0 },
    });
  });
});

describe("hatchery/finish", () => {
  test("houses the lot for timeCost(total, false) × 4 Shiny", async () => {
    await call(yardHatcheryAddAction, { hatchery: 1, monster: "C1", count: 20 });
    const answer = await call(yardHatcheryFinishAction, { hatchery: 1 });

    // 15 s on the one in production (a second may have passed) + 19 × 15 queued: 8 Shiny either way.
    expect(answer).toMatchObject({
      status: 200,
      body: { report: { hatchery: 1, housed: { C1: 20 }, credits: 8, finishedAll: true } },
    });
    expect(db.row!.credits).toBe(992);
    expect(monsters().housed).toEqual({ C1: 20 });
  });

  test("housing full is refused; a Shiny-locked account cannot finish", async () => {
    await call(yardHatcheryAddAction, { hatchery: 1, monster: "C1", count: 5 });
    expect(
      await call(yardHatcheryFinishAction, { hatchery: 1 }, userOf({ shiny_locked: true }))
    ).toMatchObject({
      status: 409,
      body: { reason: "shinyLocked" },
    });

    db.row!.monsters = { ...monsters(), housed: { C1: 54 } };
    expect(await call(yardHatcheryFinishAction, { hatchery: 1 })).toMatchObject({
      status: 409,
      body: { reason: "housingFull", free: 0 },
    });
    expect(db.row!.credits).toBe(1000);
  });
});

describe("shop/buy overdrives and Housing Expansion", () => {
  test("HOD for 30 Shiny and an hour; no second overdrive of any stage while it runs", async () => {
    const answer = await call(yardShopBuyAction, { item: "HOD" });
    expect(answer.status).toBe(200);
    expect(answer.body.report).toMatchObject({ item: "HOD", credits: 30 });
    const entry = (db.row!.storedata as Record<string, Row>).HOD;
    expect((entry.e as number) - (entry.s as number)).toBe(3_600);

    for (const item of ["HOD", "HOD2", "HOD3"]) {
      expect(await call(yardShopBuyAction, { item })).toMatchObject({
        status: 409,
        body: { reason: "alreadyActive" },
      });
    }
    expect(db.row!.credits).toBe(970);
  });

  test("HOD2 and HOD3 cost 50 and 100; EXH 375 for 24 hours", async () => {
    expect((await call(yardShopBuyAction, { item: "HOD3" })).body.report).toMatchObject({
      credits: 100,
    });
    db.row = rowOf();
    expect((await call(yardShopBuyAction, { item: "HOD2" })).body.report).toMatchObject({
      credits: 50,
    });

    const exh = await call(yardShopBuyAction, { item: "EXH" });
    expect(exh.body.report).toMatchObject({ item: "EXH", credits: 375 });
    const entry = (db.row!.storedata as Record<string, Row>).EXH;
    expect((entry.e as number) - (entry.s as number)).toBe(86_400);
  });
});
