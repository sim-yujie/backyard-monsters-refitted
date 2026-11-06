import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import { capOf } from "../../services/yard/credit.js";
import { packPrice } from "../../services/yard/resourcePacks.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardShopBuyAction } from "./shopBuy.js";
import { runYardAction, type YardAnswer } from "./yardAction.js";

/**
 * Buying resources with Shiny through `shop/buy` (issue #393), end to end
 * through the real wrapper, the database replaced by one in-memory row
 * written only when the transaction commits (as `shinyRoutes.test.ts`).
 */

type Row = Record<string, unknown>;

const db = { row: null as Row | null, progress: null as Row | null };

const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    const entity = db.row && structuredClone(db.row);
    const fork = {
      findOne: async (model: { name?: string }, query: Row = {}) => {
        if (model?.name === "InfernoProgress") return db.progress;
        // The player's Inferno yard (`readUnderHall`): none here.
        if ("baseid" in query) return null;
        return entity;
      },
      flush: async () => {},
    };
    const result = await cb(fork);
    db.row = entity;
    return result;
  },
};

const BASESAVEID = 7;

const user = { userid: 2, shiny_locked: false, save: { basesaveid: BASESAVEID } } as unknown as User;

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
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
  buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 } },
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

const buy = (body: Row): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, yardShopBuyAction, body);

const resources = () => db.row!.resources as Record<string, number>;

/** The main yard's one storage cap. */
const cap = (): number => capOf(db.row as never);

beforeEach(() => {
  db.row = rowOf();
  db.progress = null;
});

describe("POST /bm/yard/shop/buy, resource packs", () => {
  test("BR11 buys 10% of the cap in Twigs at Flash's price, with 30% as points", async () => {
    const full = cap();
    const amount = full * 0.1;
    const answer = await buy({ item: "BR11" });
    expect(answer.status).toBe(200);
    const price = packPrice(amount);
    expect(answer.body.report).toMatchObject({
      item: "BR11",
      credits: price,
      resource: "r1",
      amount: Math.ceil(amount),
      points: Math.ceil(amount * 0.3),
      inferno: false,
    });
    expect(resources().r1).toBe(Math.ceil(amount));
    expect(resources().r2).toBe(0);
    expect(db.row!.credits).toBe(1000 - price);
    expect(Number(db.row!.points)).toBe(Math.ceil(amount * 0.3));
    // Nothing recorded in the store data: a pack is not an owned item.
    expect(db.row!.storedata).toEqual({});
  });

  test("BR33 fills Putty to the cap; refused once full", async () => {
    const full = cap();
    db.row = rowOf({ resources: { r1: 0, r2: 0, r3: full - 1_000, r4: 0 } });
    const answer = await buy({ item: "BR33" });
    expect(answer.status).toBe(200);
    expect(answer.body.report).toMatchObject({ amount: 1_000, credits: packPrice(1_000) });
    expect(resources().r3).toBe(full);

    const again = await buy({ item: "BR33" });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ reason: "storageFull" });
  });

  test("BR42 is refused while 50% would not fit whole (Flash's strict <)", async () => {
    const full = cap();
    db.row = rowOf({ resources: { r1: 0, r2: 0, r3: 0, r4: full / 2 } });
    const answer = await buy({ item: "BR42" });
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ reason: "storageFull" });
    expect(db.row!.credits).toBe(1000);
  });

  test("never charges more than the price the player agreed to", async () => {
    const price = packPrice(cap() * 0.5);
    const refused = await buy({ item: "BR22", price: price - 1 });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ reason: "priceChanged", price });
    expect(resources().r2).toBe(0);

    const ok = await buy({ item: "BR22", price });
    expect(ok.status).toBe(200);
    expect(db.row!.credits).toBe(1000 - price);
  });

  test("short of Shiny: refused, nothing changes", async () => {
    db.row = rowOf({ credits: 1 });
    const answer = await buy({ item: "BR13" });
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ reason: "credits" });
    expect(resources().r1).toBe(0);
  });

  test("a Shiny-locked account cannot buy", async () => {
    const locked = { ...user, shiny_locked: true } as unknown as User;
    const answer = await runYardAction(em as unknown as EntityManager, locked, yardShopBuyAction, { item: "BR11" });
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ reason: "shinyLocked" });
  });

  describe("Inferno packs on the main yard", () => {
    const saved = process.env.INFERNO_ENABLED;
    beforeEach(() => {
      process.env.INFERNO_ENABLED = "on";
    });
    afterEach(() => {
      if (saved === undefined) delete process.env.INFERNO_ENABLED;
      else process.env.INFERNO_ENABLED = saved;
    });

    const purse = { r1: 100, r2: 0, r3: 0, r4: 0, r1max: 10_000, r2max: 10_000, r3max: 10_000, r4max: 10_000 };

    test("refused before the Descent is passed", async () => {
      db.row = rowOf({ iresources: purse });
      const answer = await buy({ item: "BR11I" });
      expect(answer.status).toBe(409);
      expect(answer.body).toMatchObject({ reason: "infernoLocked" });
    });

    test("after the Descent, BR13I fills the Inferno purse to its own cap", async () => {
      db.row = rowOf({ iresources: purse });
      db.progress = { userid: 2, descent_passed_at: new Date() };
      const answer = await buy({ item: "BR13I" });
      expect(answer.status).toBe(200);
      expect(answer.body.report).toMatchObject({ amount: 9_900, inferno: true, credits: packPrice(9_900) });
      expect((db.row!.iresources as Row).r1).toBe(10_000);
      expect(resources().r1).toBe(0);
    });
  });
});
