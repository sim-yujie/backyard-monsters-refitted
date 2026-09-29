import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type z from "zod";
import type { User } from "../../database/models/user.model.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardInstantUpgradeAction } from "./instantUpgrade.js";
import { yardShopBuyAction } from "./shopBuy.js";
import { yardSpeedupAction } from "./speedup.js";
import { runYardAction, type YardAction, type YardAnswer } from "./yardAction.js";

/**
 * The three Shiny routes end to end through the real wrapper, with the
 * database replaced by one in-memory row that is written only when the
 * transaction commits (the locking itself is covered by `yardAction.test.ts`).
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

/** A main yard saved just now: Town Hall 3, a Cannon Tower at 1 upgrading with `cU` 5000, a Flinger at 1. */
const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: BASESAVEID,
  userid: 2,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime(),
  credits: 1000,
  points: "0",
  flinger: 1,
  catapult: 0,
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
  buildingdata: {
    "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 },
    "1": { id: 1, t: 20, X: 100, Y: 100, l: 1, cU: 5000 },
    "2": { id: 2, t: 5, X: 200, Y: 200, l: 1 },
    "3": { id: 3, t: 11, X: 300, Y: 300, l: 1 },
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

const call = (
  action: YardAction<z.ZodType, unknown>,
  body: unknown,
  user: User = userOf()
): Promise<YardAnswer> => runYardAction(em as unknown as EntityManager, user, action, body);

const buildings = () => db.row!.buildingdata as Record<string, Row>;

beforeEach(() => {
  db.row = rowOf();
});

describe("POST /bm/yard/speedup", () => {
  test("SP4 finishes the upgrade and takes exactly timeCost(remaining)", async () => {
    const answer = await call(yardSpeedupAction, { id: "1", item: "SP4" });

    expect(answer.status).toBe(200);
    // 5000 s: min(ceil(27.8) = 28, int(sqrt(4000)) = 63) = 28. The wrapper's
    // catch-up may have taken a second off; 4999 s prices the same.
    expect(answer.body.report).toMatchObject({ id: 1, item: "SP4", credits: 28, remaining: 0 });
    expect(answer.body.credits).toBe(972);
    expect(db.row).toMatchObject({ credits: 972, points: "6966" });
    expect(buildings()["1"]).toMatchObject({ l: 2 });
    expect(buildings()["1"].cU).toBeUndefined();
  });

  test("a Shiny-locked account is refused and nothing is written", async () => {
    const before = structuredClone(db.row);
    const answer = await call(yardSpeedupAction, { id: 1, item: "SP2" }, userOf({ shiny_locked: true }));

    expect(answer).toMatchObject({ status: 409, body: { reason: "shinyLocked" } });
    expect(db.row).toEqual(before);
  });

  test("a free SP1 still works on a Shiny-locked account (nothing is spent)", async () => {
    db.row = rowOf({ buildingdata: { ...rowOf().buildingdata as object, "1": { id: 1, t: 20, X: 0, Y: 0, l: 1, cU: 200 } } });
    const answer = await call(yardSpeedupAction, { id: 1, item: "SP1" }, userOf({ shiny_locked: true }));

    expect(answer.status).toBe(200);
    expect(db.row).toMatchObject({ credits: 1000 });
    expect(buildings()["1"]).toMatchObject({ l: 2 });
  });

  test("an unknown item is a 400 from the schema", async () => {
    const answer = await call(yardSpeedupAction, { id: 1, item: "SP9" });
    expect(answer).toMatchObject({ status: 400, body: { reason: "badRequest" } });
  });
});

describe("POST /bm/yard/upgrade/instant", () => {
  test("raises the level, charges no resources, awards points, re-derives flinger", async () => {
    // Flinger 1→2 wants Town Hall 3 and a Map Room: both present.
    const answer = await call(yardInstantUpgradeAction, { id: 2 });

    expect(answer.status).toBe(200);
    const price = (answer.body.report as { credits: number }).credits;
    expect(answer.body.report).toMatchObject({ id: 2, from: 1, to: 2 });
    expect(price).toBeGreaterThan(0);
    expect(db.row).toMatchObject({
      credits: 1000 - price,
      flinger: 2,
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    });
    // Flinger 1→2 is [64300, 64300, 32150, 0, 10800]: floor(171550 / 3).
    expect(db.row!.points).toBe("57183");
  });

  test("credits never go below 0: exactly enough is spent to 0, one short is refused", async () => {
    // Cannon 1→2: (32 + timeCost(900) = 5) × 0.95 = 35.
    db.row = rowOf({
      buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 }, "1": { id: 1, t: 20, X: 0, Y: 0, l: 1 } },
    });
    const probe = await call(yardInstantUpgradeAction, { id: 1 });
    const price = (probe.body.report as { credits: number }).credits;
    expect(price).toBe(35);

    db.row = rowOf({
      credits: price - 1,
      buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 }, "1": { id: 1, t: 20, X: 0, Y: 0, l: 1 } },
    });
    const before = structuredClone(db.row);
    const short = await call(yardInstantUpgradeAction, { id: 1 });
    expect(short).toMatchObject({
      status: 409,
      body: { reason: "credits", credits: { have: price - 1, need: price } },
    });
    expect(db.row).toEqual(before);

    db.row = { ...before, credits: price };
    const exact = await call(yardInstantUpgradeAction, { id: 1 });
    expect(exact.status).toBe(200);
    expect(db.row).toMatchObject({ credits: 0 });
  });

  test("a Shiny-locked account is refused", async () => {
    const answer = await call(yardInstantUpgradeAction, { id: 2 }, userOf({ shiny_locked: true }));
    expect(answer).toMatchObject({ status: 409, body: { reason: "shinyLocked" } });
    expect(buildings()["2"]).toMatchObject({ l: 1 });
  });

  test("the Map Room is refused", async () => {
    const answer = await call(yardInstantUpgradeAction, { id: 3 });
    expect(answer).toMatchObject({ status: 409, body: { reason: "mapRoom" } });
  });
});

describe("POST /bm/yard/shop/buy", () => {
  test("BEW climbs its tiers, adds a worker each time, and sells out after four", async () => {
    db.row = rowOf({ credits: 10000 });
    const spent: number[] = [];
    const workers: number[] = [];

    for (let i = 0; i < 4; i++) {
      const answer = await call(yardShopBuyAction, { item: "BEW" });
      expect(answer.status).toBe(200);
      spent.push((answer.body.report as { credits: number }).credits);
      workers.push((answer.body.workers as { total: number }).total);
    }

    expect(spent).toEqual([250, 500, 1000, 2000]);
    expect(workers).toEqual([2, 3, 4, 5]);
    expect(db.row).toMatchObject({ credits: 10000 - 3750, storedata: { BEW: { q: 4 } } });

    const fifth = await call(yardShopBuyAction, { item: "BEW" });
    expect(fifth).toMatchObject({ status: 409, body: { reason: "soldOut", have: 4, max: 4 } });
    expect(db.row).toMatchObject({ credits: 6250 });
  });

  test("a price the client sends is ignored", async () => {
    const answer = await call(yardShopBuyAction, { item: "BEW", price: 1, cost: 1, c: 1 });
    expect(answer.body.report).toMatchObject({ credits: 250 });
    expect(db.row).toMatchObject({ credits: 750 });
  });

  test("BST starts seven days of Sharper Tools and refuses a second buy while it runs", async () => {
    const answer = await call(yardShopBuyAction, { item: "BST" });
    const now = answer.body.currenttime as number;

    expect(answer.body.report).toEqual({ item: "BST", credits: 225, q: 1, endsAt: now + 604800 });
    expect(db.row).toMatchObject({
      credits: 775,
      storedata: { BST: { q: 1, s: now, e: now + 604800 } },
    });

    const again = await call(yardShopBuyAction, { item: "BST" });
    expect(again).toMatchObject({ status: 409, body: { reason: "alreadyActive", endsAt: now + 604800 } });
    expect(db.row).toMatchObject({ credits: 775 });
  });

  test("BST can be bought again once it has run out (the catch-up removed it)", async () => {
    db.row = rowOf({ storedata: { BST: { q: 1, s: 1, e: 2 } } });
    const answer = await call(yardShopBuyAction, { item: "BST" });

    expect(answer.status).toBe(200);
    expect(answer.body.completed).toEqual([{ kind: "storeItem", id: "BST", t: null, at: 2, detail: {} }]);
    expect((db.row!.storedata as Row).BST).toMatchObject({ q: 1 });
  });

  test("BIP climbs ten steps, each adding 10% to every storage cap, then sells out", async () => {
    db.row = rowOf({ credits: 10000 });
    const spent: number[] = [];
    const caps: number[] = [];

    for (let i = 0; i < 10; i++) {
      const answer = await call(yardShopBuyAction, { item: "BIP" });
      expect(answer.status).toBe(200);
      spent.push((answer.body.report as { credits: number }).credits);
      caps.push((answer.body.caps as { r1: number }).r1);
    }

    expect(spent).toEqual([50, 100, 150, 200, 250, 300, 350, 400, 450, 500]);
    // No silos: the 10,000 base pool, 10% more per step.
    expect(caps).toEqual([11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 20000]);
    expect(db.row).toMatchObject({ credits: 10000 - 2750, storedata: { BIP: { q: 10 } } });

    const eleventh = await call(yardShopBuyAction, { item: "BIP" });
    expect(eleventh).toMatchObject({ status: 409, body: { reason: "soldOut", have: 10, max: 10 } });
  });

  test("ENL climbs six steps and sells out; it does not expire", async () => {
    db.row = rowOf({ credits: 10000 });
    const spent: number[] = [];

    for (let i = 0; i < 6; i++) {
      const answer = await call(yardShopBuyAction, { item: "ENL" });
      expect(answer.status).toBe(200);
      expect((answer.body.report as { endsAt: number | null }).endsAt).toBeNull();
      spent.push((answer.body.report as { credits: number }).credits);
    }

    expect(spent).toEqual([50, 100, 150, 200, 250, 300]);
    expect(db.row).toMatchObject({ credits: 10000 - 1050, storedata: { ENL: { q: 6 } } });
    expect(await call(yardShopBuyAction, { item: "ENL" })).toMatchObject({
      status: 409,
      body: { reason: "soldOut", have: 6, max: 6 },
    });
  });

  test("POD starts twelve hours of Production Overdrive and refuses a second buy while it runs", async () => {
    const answer = await call(yardShopBuyAction, { item: "POD" });
    const now = answer.body.currenttime as number;

    expect(answer.body.report).toEqual({ item: "POD", credits: 200, q: 1, endsAt: now + 43200 });
    expect(db.row).toMatchObject({ credits: 800, storedata: { POD: { q: 1, s: now, e: now + 43200 } } });

    const again = await call(yardShopBuyAction, { item: "POD" });
    expect(again).toMatchObject({ status: 409, body: { reason: "alreadyActive", endsAt: now + 43200 } });
    expect(db.row).toMatchObject({ credits: 800 });
  });

  test("items off the allowlist are 400 notForSale", async () => {
    for (const item of ["HODI", "PRO1", "MUSK", "toString", "__proto__"]) {
      const answer = await call(yardShopBuyAction, { item });
      expect(answer).toMatchObject({ status: 400, body: { reason: "notForSale" } });
    }
    expect(db.row).toMatchObject({ credits: 1000 });
  });

  test("a Shiny-locked account is refused; a short balance is refused", async () => {
    expect(await call(yardShopBuyAction, { item: "BST" }, userOf({ shiny_locked: true }))).toMatchObject({
      status: 409,
      body: { reason: "shinyLocked" },
    });

    db.row = rowOf({ credits: 224 });
    expect(await call(yardShopBuyAction, { item: "BST" })).toMatchObject({
      status: 409,
      body: { reason: "credits", credits: { have: 224, need: 225 } },
    });
    expect(db.row).toMatchObject({ credits: 224, storedata: {} });
  });
});
