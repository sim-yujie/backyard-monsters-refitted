import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import { MUSHROOM_TYPE } from "../../game-data/buildingFootprints.js";
import { overlaps, rectOf } from "../../services/yardplanner/layoutGeometry.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { memoryCoinStore, useCoinStore, type EventCoinStore } from "../../services/events/eventCoins.js";
import { yardBuyDecorationAction, yardPlaceDecorationAction } from "./decor.js";
import { yardRecycleAction } from "./recycle.js";
import { runYardAction, type YardAnswer } from "./yardAction.js";

/**
 * `POST /bm/yard/decor/place` (§8.3, #128) through the real wrapper, the
 * database one in-memory row written only when a transaction commits (as
 * `recycle.test.ts`). Expansion 0: a 1000 x 800 plot, x in [-500, 500).
 * Type 28 is the American Flag, 121 a Wild Monster totem.
 */

type Row = Record<string, unknown>;

const db = { row: null as Row | null };

const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    let entity: Row | null = null;
    const fork = {
      async findOne() {
        entity = db.row && structuredClone(db.row);
        return entity;
      },
      async flush() {},
    };
    const result = await cb(fork);
    if (entity) db.row = structuredClone(entity);
    return result;
  },
};

const user = { userid: 2505, shiny_locked: false, save: { basesaveid: 7 } } as unknown as User;
const lockedUser = { userid: 2505, shiny_locked: true, save: { basesaveid: 7 } } as unknown as User;

const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: 7,
  userid: 2505,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime(),
  credits: 0,
  points: "100",
  tutorialstage: 205,
  flinger: 0,
  catapult: 0,
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
  buildingdata: {
    "0": { id: 0, t: 14, X: -100, Y: -100, l: 3 },
    "4": { id: 4, t: 28, X: 900, Y: 0 },
  },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: {},
  academy: {},
  champion: [],
  // Spawned just now, so the catch-up grows none where a test places.
  mushrooms: { l: [], s: getCurrentDateTime() },
  researchdata: { b28: 2, b121: 1, bl121: 3, other: 1 },
  outposts: [],
  ...overrides,
});

const place = (body: Row): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, yardPlaceDecorationAction, body);

const buildings = () => db.row!.buildingdata as Record<string, Row>;

describe("POST /bm/yard/decor/place", () => {
  beforeEach(() => {
    db.row = rowOf();
  });

  test("takes one out of storage and puts it down finished, for nothing", async () => {
    const answer = await place({ type: 28, x: 200, y: 200 });

    expect(answer.status).toBe(200);
    expect(answer.body.report).toEqual({ id: 5, t: 28, x: 200, y: 200, level: 1, left: 1 });
    expect(buildings()["5"]).toEqual({ id: 5, t: 28, X: 200, Y: 200 });
    expect(db.row).toMatchObject({
      researchdata: { b28: 1, b121: 1, bl121: 3, other: 1 },
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
      credits: 0,
      points: "100",
    });
    expect((answer.body.workers as { busy: number }).busy).toBe(0);
  });

  test("the last one out takes its storage key with it", async () => {
    db.row = rowOf({ researchdata: { b28: 1 } });
    await place({ type: 28, x: 200, y: 200 });
    expect(db.row!.researchdata).toEqual({});
  });

  test("a totem comes back at its stored level, and the level goes with the last one", async () => {
    const answer = await place({ type: 121, x: 200, y: 200 });

    expect(answer.body.report).toMatchObject({ t: 121, level: 3, left: 0 });
    expect(buildings()["5"]).toMatchObject({ t: 121, l: 3 });
    expect(db.row!.researchdata).toEqual({ b28: 2, other: 1 });
  });

  test("recycle then place is a round trip", async () => {
    db.row = rowOf({ researchdata: {} });
    await runYardAction(em as unknown as EntityManager, user, yardRecycleAction, { id: 4 });
    expect(db.row!.researchdata).toEqual({ b28: 1 });

    const answer = await place({ type: 28, x: 0, y: 200 });
    expect(answer.status).toBe(200);
    expect(db.row!.researchdata).toEqual({});
  });

  test("refusals: not a decoration, none in storage, outside the plot, on a building", async () => {
    expect(await place({ type: 20, x: 200, y: 200 })).toMatchObject({
      status: 400,
      body: { reason: "notDecoration" },
    });
    expect(await place({ type: 29, x: 200, y: 200 })).toMatchObject({
      status: 409,
      body: { reason: "notInStorage", type: 29 },
    });
    expect(await place({ type: 28, x: 600, y: 0 })).toMatchObject({
      status: 409,
      body: { reason: "placement", placement: "outOfBounds" },
    });
    expect(await place({ type: 28, x: -100, y: -100 })).toMatchObject({
      status: 409,
      body: { reason: "placement", placement: "overlap", with: 0 },
    });
    expect(db.row).toMatchObject({ researchdata: { b28: 2 } });
    expect(Object.keys(buildings())).toEqual(["0", "4"]);
  });

  test("a mushroom in the way does not block it: the mushroom pops up elsewhere (#263)", async () => {
    db.row = rowOf({ mushrooms: { l: [[3, 200, 200]], s: getCurrentDateTime() } });
    const answer = await place({ type: 28, x: 200, y: 200 });
    expect(answer.status).toBe(200);

    const saved = (db.row!.mushrooms as { l: [number, number, number][] }).l;
    expect(saved).toHaveLength(1);
    const [frame, x, y] = saved[0]!;
    expect(frame).toBe(3);
    expect(overlaps(rectOf(MUSHROOM_TYPE, x, y), rectOf(28, 200, 200))).toBe(false);
    // The answer shows it where the save has it.
    expect((answer.body.mushrooms as { l: unknown[] }).l).toEqual(saved);
  });
});

const buy = (body: Row, who: User = user): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, who, yardBuyDecorationAction, body);

/**
 * `POST /bm/yard/decor/buy` (owner decisions 2026-11-04 and 6 Nov): Flash's
 * decorations at Flash's Shiny price as EVENT COINS
 * (`game-data/store/decorationsForSale.ts`, `services/events/eventCoins.ts`),
 * charged when one is placed. 29 is the British Flag (150), 55 the Acorn (5),
 * 99 the Statue of Liberty (500); 70 the Sun Dial is `block`ed in Flash and
 * 120 the Big Gulp priced 0, so neither is sold. The coins come from an
 * in-memory store; Shiny is never touched.
 */
describe("POST /bm/yard/decor/buy", () => {
  let coins: ReturnType<typeof memoryCoinStore>;
  let previous: EventCoinStore;
  const balance = () => coins.balances.get(2505) ?? 0;

  beforeEach(() => {
    db.row = rowOf({ credits: 1_000, researchdata: {} });
    coins = memoryCoinStore();
    coins.balances.set(2505, 1_000);
    previous = useCoinStore(coins);
  });

  afterEach(() => {
    useCoinStore(previous);
  });

  test("charges the store price in coins and puts it down finished: no worker, no points, no Shiny", async () => {
    const answer = await buy({ type: 29, x: 200, y: 200 });

    expect(answer.status).toBe(200);
    expect(answer.body.report).toEqual({ id: 5, t: 29, x: 200, y: 200, level: 1, left: 0, coins: 150 });
    expect(answer.body.eventcoins).toBe(850);
    expect(answer.body.coinsGained).toBeUndefined();
    expect(buildings()["5"]).toEqual({ id: 5, t: 29, X: 200, Y: 200 });
    expect(balance()).toBe(850);
    expect(db.row).toMatchObject({
      credits: 1_000,
      points: "100",
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
      researchdata: {},
    });
    expect((answer.body.workers as { busy: number }).busy).toBe(0);
    expect(coins.log.at(-1)).toEqual({ userid: 2505, amount: -150, reason: "decor-29", awardKey: null });

    await buy({ type: 55, x: 0, y: 200 });
    await buy({ type: 99, x: -300, y: 200 });
    expect(balance()).toBe(850 - 5 - 500);
  });

  test("any price the client sends is ignored", async () => {
    await buy({ type: 29, x: 200, y: 200, price: 1, coins: 1, credits: 1 });
    expect(balance()).toBe(850);
  });

  test("no limit: a second of the same is sold too", async () => {
    await buy({ type: 29, x: 200, y: 200 });
    const again = await buy({ type: 29, x: 0, y: 200 });
    expect(again.status).toBe(200);
    expect(balance()).toBe(700);
  });

  test("one in storage is placed from there for nothing", async () => {
    db.row = rowOf({ credits: 1_000, researchdata: { b29: 1 } });
    const answer = await buy({ type: 29, x: 200, y: 200 });

    expect(answer.body.report).toMatchObject({ t: 29, left: 0, coins: 0 });
    expect(answer.body.eventcoins).toBeUndefined();
    expect(db.row).toMatchObject({ credits: 1_000, researchdata: {} });
    expect(balance()).toBe(1_000);
  });

  test("refuses what Flash did not sell, and charges nothing", async () => {
    for (const type of [70, 110, 120, 121, 135]) {
      expect(await buy({ type, x: 200, y: 200 })).toMatchObject({
        status: 400,
        body: { reason: "notForSale", type },
      });
    }
    expect(await buy({ type: 20, x: 200, y: 200 })).toMatchObject({
      status: 400,
      body: { reason: "notDecoration" },
    });
    expect(balance()).toBe(1_000);
    expect(Object.keys(buildings())).toEqual(["0", "4"]);
  });

  test("too few coins: 409 coins, nothing placed, Shiny not used instead", async () => {
    coins.balances.set(2505, 100);
    expect(await buy({ type: 29, x: 200, y: 200 })).toMatchObject({
      status: 409,
      body: { reason: "coins", coins: { have: 100, need: 150 } },
    });
    expect(balance()).toBe(100);
    expect(db.row!.credits).toBe(1_000);
    expect(Object.keys(buildings())).toEqual(["0", "4"]);
  });

  test("a player with no coins at all is refused", async () => {
    coins.balances.clear();
    expect(await buy({ type: 55, x: 200, y: 200 })).toMatchObject({
      status: 409,
      body: { reason: "coins", coins: { have: 0, need: 5 } },
    });
  });

  test("the Shiny lock does not stop coin spending: coins are earned, not bought", async () => {
    expect((await buy({ type: 29, x: 200, y: 200 }, lockedUser)).status).toBe(200);
    expect(balance()).toBe(850);
  });

  test("a refused spot charges nothing: outside the plot, on a building", async () => {
    expect(await buy({ type: 29, x: 600, y: 0 })).toMatchObject({
      status: 409,
      body: { reason: "placement", placement: "outOfBounds" },
    });
    expect(await buy({ type: 29, x: -100, y: -100 })).toMatchObject({
      status: 409,
      body: { reason: "placement", placement: "overlap", with: 0 },
    });
    expect(balance()).toBe(1_000);
    expect(Object.keys(buildings())).toEqual(["0", "4"]);
  });

  test("recycling a bought one puts it in storage", async () => {
    await buy({ type: 29, x: 200, y: 200 });
    await runYardAction(em as unknown as EntityManager, user, yardRecycleAction, { id: 5 });
    expect(db.row).toMatchObject({ researchdata: { b29: 1 } });
    expect(balance()).toBe(850);
    expect(buildings()["5"]).toBeUndefined();
  });

  test("the six autumn decorations (owner, 10 Nov 2026) sell at their own coin price", async () => {
    const prices: [type: number, price: number][] = [
      [201, 25],
      [202, 30],
      [203, 35],
      [204, 50],
      [205, 60],
      [206, 75],
    ];
    let left = 1_000;
    for (const [index, [type, price]] of prices.entries()) {
      const x = -300 + index * 100;
      const answer = await buy({ type, x, y: 200 });
      expect(answer.status).toBe(200);
      expect(answer.body.report).toMatchObject({ t: type, x, y: 200, level: 1, coins: price });
      left -= price;
      expect(balance()).toBe(left);
      expect(coins.log.at(-1)).toMatchObject({ amount: -price, reason: `decor-${type}` });
    }
    expect(balance()).toBe(1_000 - 275);
    expect(Object.values(buildings()).map((one) => one.t)).toEqual([14, 28, 201, 202, 203, 204, 205, 206]);
    expect(db.row!.credits).toBe(1_000);
  });

  test("an autumn decoration takes its footprint: a second one on the same spot is refused", async () => {
    expect((await buy({ type: 206, x: 200, y: 200 })).status).toBe(200);
    expect(await buy({ type: 201, x: 220, y: 220 })).toMatchObject({
      status: 409,
      body: { reason: "placement", placement: "overlap" },
    });
    expect(balance()).toBe(1_000 - 75);
  });

  test("an autumn decoration goes to storage when recycled and comes back out for nothing", async () => {
    await buy({ type: 205, x: 200, y: 200 });
    await runYardAction(em as unknown as EntityManager, user, yardRecycleAction, { id: 5 });
    expect(db.row).toMatchObject({ researchdata: { b205: 1 } });
    expect(balance()).toBe(1_000 - 60);

    const again = await buy({ type: 205, x: 0, y: 200 });
    expect(again.body.report).toMatchObject({ t: 205, left: 0, coins: 0 });
    expect(balance()).toBe(1_000 - 60);
  });
});
