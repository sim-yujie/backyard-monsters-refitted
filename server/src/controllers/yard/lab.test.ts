import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type z from "zod";
import type { User } from "../../database/models/user.model.js";
import { instantResearchPrice } from "../../services/yard/shiny.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import {
  yardLabCancelAction,
  yardLabFinishAction,
  yardLabInstantAction,
  yardLabStartAction,
} from "./lab.js";
import { yardStateAction } from "./state.js";
import { yardUpgradeAction } from "./upgrade.js";
import { runYardAction, type YardAction, type YardAnswer } from "./yardAction.js";

/**
 * The Monster Lab routes end to end through the real wrapper, the
 * database replaced by one in-memory row written only when the transaction
 * commits (as `locker.test.ts` does).
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

/**
 * A main yard saved just now: Town Hall 7, a level 2 Monster Lab (id 9), a
 * silo; 1,000 Shiny, 3,000,000 putty. Bolt (C3) at level 2 can take rank 1.
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
  resources: { r1: 0, r2: 0, r3: 3_000_000, r4: 0 },
  buildingdata: {
    "0": { id: 0, t: 14, X: 0, Y: 0, l: 7 },
    "2": { id: 2, t: 6, X: 200, Y: 200, l: 10 },
    "9": { id: 9, t: 116, X: 300, Y: 300, l: 2 },
  },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: { C3: { t: 2 }, C8: { t: 2 } },
  academy: { C3: { level: 2 }, C8: { level: 1 } },
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
const academy = () => db.row!.academy as Record<string, Row>;
const building = (id: number) => (db.row!.buildingdata as Record<string, Row>)[String(id)]!;

const lab = () => building(9);

beforeEach(() => {
  db.row = rowOf();
});

describe("start then cancel", () => {
  test("is reversible: putty back in full, the Lab idle again", async () => {
    const started = await call(yardLabStartAction, { monster: "C3" });

    expect(started.status).toBe(200);
    // C3 rank 1: 48,000 putty, 86,400 s.
    expect(started.body.report).toMatchObject({ monster: "C3", rank: 1, lab: 9, cost: { r3: 48_000 } });
    expect(putty()).toBe(3_000_000 - 48_000);
    expect(lab()).toMatchObject({ upg: "C3", upl: 1 });
    expect(lab().upt).toBe((started.body.report as { endsAt: number }).endsAt);
    // The answer carries the new state.
    expect((started.body.buildingdata as Record<string, Row>)["9"]).toMatchObject({ upg: "C3" });

    const cancelled = await call(yardLabCancelAction, {});

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.report).toEqual({ monster: "C3", rank: 1, refund: { r3: 48_000 } });
    expect(putty()).toBe(3_000_000);
    expect(lab()).toEqual({ id: 9, t: 116, X: 300, Y: 300, l: 2 });
    expect(academy().C3).toEqual({ level: 2 });
  });

  test("one research at a time", async () => {
    await call(yardLabStartAction, { monster: "C3" });
    db.row!.academy = { ...academy(), C8: { level: 2 } };
    const refused = await call(yardLabStartAction, { monster: "C8" });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ reason: "labBusy", id: 9, monster: "C3" });
  });

  test("the Lab cannot be upgraded while it researches", async () => {
    await call(yardLabStartAction, { monster: "C3" });
    const refused = await call(yardUpgradeAction, { id: "9" });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ reason: "busy" });
  });
});

describe("refusals write nothing", () => {
  test("shortfall", async () => {
    db.row = rowOf({ resources: { r1: 0, r2: 0, r3: 1_000, r4: 0 } });
    const before = structuredClone(db.row);
    const refused = await call(yardLabStartAction, { monster: "C3" });

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ reason: "shortfall" });
    expect(db.row!.buildingdata).toEqual(before.buildingdata);
  });

  test("the monster's level gate", async () => {
    const refused = await call(yardLabStartAction, { monster: "C8" });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ reason: "monsterLevel", monster: "C8", have: 1, need: 2 });
  });

  test("a malformed body is a 400", async () => {
    expect((await call(yardLabStartAction, {})).status).toBe(400);
    expect((await call(yardLabStartAction, { monster: "C1" })).status).toBe(400);
  });

  test("cancel and finish with nothing researching", async () => {
    expect((await call(yardLabCancelAction, {})).body).toMatchObject({ reason: "notResearching" });
    expect((await call(yardLabFinishAction, {})).body).toMatchObject({ reason: "notResearching" });
  });
});

describe("Shiny", () => {
  test("finish charges timeCost(upt − now) and sets the rank", async () => {
    await call(yardLabStartAction, { monster: "C3" });
    const finished = await call(yardLabFinishAction, {});

    expect(finished.status).toBe(200);
    // 86,400 s left: min(ceil(86400 × 20 / 3600), int(sqrt(86400 × 0.8))) = 262.
    expect(finished.body.report).toEqual({ monster: "C3", rank: 1, credits: 262 });
    expect(db.row!.credits).toBe(1000 - 262);
    expect(academy().C3).toEqual({ level: 2, powerup: 1 });
    expect(lab()).not.toHaveProperty("upg");
  });

  test("instant charges the IPU price, no putty", async () => {
    const done = await call(yardLabInstantAction, { monster: "C3" });

    expect(done.status).toBe(200);
    const price = instantResearchPrice(86_400, 48_000);
    expect(done.body.report).toEqual({ monster: "C3", rank: 1, credits: price });
    expect(db.row!.credits).toBe(1000 - price);
    expect(putty()).toBe(3_000_000);
    expect(academy().C3).toEqual({ level: 2, powerup: 1 });
  });

  test("a Shiny-locked account is refused", async () => {
    const refused = await call(yardLabInstantAction, { monster: "C3" }, userOf({ shiny_locked: true }));
    expect(refused.body).toMatchObject({ reason: "shinyLocked" });
    expect(academy().C3).toEqual({ level: 2 });
  });
});

describe("catch-up", () => {
  test("a research that ended finishes on the next request and is reported", async () => {
    const now = getCurrentDateTime();
    db.row = rowOf({
      buildingdata: {
        ...(rowOf().buildingdata as Row),
        "9": { id: 9, t: 116, X: 300, Y: 300, l: 2, upg: "C3", upt: now - 5, upl: 1 },
      },
    });
    const answer = await call(yardStateAction, {});

    expect(answer.body.completed).toEqual([
      { kind: "research", id: "C3", t: null, at: now - 5, detail: { rank: 1, lab: 9 } },
    ]);
    expect(academy().C3).toEqual({ level: 2, powerup: 1 });
    expect(lab()).not.toHaveProperty("upg");

    // …so a cancel after it is refused rather than refunding a finished research.
    const refused = await call(yardLabCancelAction, {});
    expect(refused.body).toMatchObject({ reason: "notResearching" });
  });
});
