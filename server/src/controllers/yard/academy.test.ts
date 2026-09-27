import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type z from "zod";
import type { User } from "../../database/models/user.model.js";
import { instantTrainPrice } from "../../services/yard/shiny.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import {
  yardAcademyCancelAction,
  yardAcademyFinishAction,
  yardAcademyInstantAction,
  yardAcademyTrainAction,
} from "./academy.js";
import { yardStateAction } from "./state.js";
import { runYardAction, type YardAction, type YardAnswer } from "./yardAction.js";

/**
 * The Monster Academy routes end to end through the real wrapper, the
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

/** A main yard saved just now: Town Hall 5, two academies (level 3 and 1), a silo; 1,000 Shiny, 3,000,000 putty. */
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
    "2": { id: 2, t: 6, X: 200, Y: 200, l: 10 },
    "5": { id: 5, t: 26, X: 300, Y: 300, l: 3 },
    "6": { id: 6, t: 26, X: 400, Y: 400, l: 1 },
  },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: { C1: { t: 2 }, C2: { t: 2 } },
  academy: { C1: { level: 1 }, C2: { level: 3 } },
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

beforeEach(() => {
  db.row = rowOf();
});

describe("train then cancel", () => {
  test("is reversible: putty back in full, the academy idle again", async () => {
    const trained = await call(yardAcademyTrainAction, { monster: "C2" });

    expect(trained.status).toBe(200);
    // C2 3 → 4: 24,000 putty, 36,000 s.
    expect(trained.body.report).toMatchObject({ monster: "C2", academy: 5, to: 4, cost: { r3: 24_000 } });
    expect(putty()).toBe(3_000_000 - 24_000);
    expect(academy().C2).toMatchObject({ level: 3, duration: 36_000 });
    expect(building(5).upg).toBe("C2");
    // The answer carries the new state.
    expect((trained.body.academy as Record<string, Row>).C2).toMatchObject({ duration: 36_000 });

    const cancelled = await call(yardAcademyCancelAction, { monster: "C2" });

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.report).toEqual({ monster: "C2", refund: { r3: 24_000 } });
    expect(putty()).toBe(3_000_000);
    expect(academy().C2).toEqual({ level: 3 });
    expect(building(5)).not.toHaveProperty("upg");
  });

  test("the academy form field picks the slot", async () => {
    const trained = await call(yardAcademyTrainAction, { monster: "C1", academy: "6" });
    expect(trained.body.report).toMatchObject({ academy: 6 });
    expect(building(6).upg).toBe("C1");
  });

  test("a second monster takes the second academy; a third finds both busy", async () => {
    expect((await call(yardAcademyTrainAction, { monster: "C2" })).body.report).toMatchObject({ academy: 5 });
    expect((await call(yardAcademyTrainAction, { monster: "C1" })).body.report).toMatchObject({ academy: 6 });

    db.row!.lockerdata = { ...(db.row!.lockerdata as Row), C3: { t: 2 } };
    const refused = await call(yardAcademyTrainAction, { monster: "C3" });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ reason: "academyBusy", id: 5, monster: "C2" });
  });
});

describe("refusals write nothing", () => {
  test("shortfall", async () => {
    db.row = rowOf({ resources: { r1: 0, r2: 0, r3: 1_000, r4: 0 } });
    const before = structuredClone(db.row);
    const refused = await call(yardAcademyTrainAction, { monster: "C2" });

    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ reason: "shortfall" });
    expect(db.row!.academy).toEqual(before.academy);
    expect(db.row!.buildingdata).toEqual(before.buildingdata);
  });

  test("a malformed body is a 400", async () => {
    expect((await call(yardAcademyTrainAction, {})).status).toBe(400);
    expect((await call(yardAcademyTrainAction, { monster: "C1", academy: "x" })).status).toBe(400);
  });

  test("cancel with nothing training", async () => {
    const refused = await call(yardAcademyCancelAction, { monster: "C1" });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ reason: "notTraining", monster: "C1" });
  });
});

describe("Shiny", () => {
  test("finish charges timeCost(time − now) and raises the level", async () => {
    await call(yardAcademyTrainAction, { monster: "C2" });
    const finished = await call(yardAcademyFinishAction, { monster: "C2" });

    expect(finished.status).toBe(200);
    const credits = (finished.body.report as { credits: number }).credits;
    // 36,000 s left: min(ceil(36000 × 20 / 3600), int(sqrt(36000 × 0.8))) = 169.
    expect(credits).toBe(169);
    expect(db.row!.credits).toBe(1000 - 169);
    expect(academy().C2).toEqual({ level: 4 });
    expect(building(5)).not.toHaveProperty("upg");
  });

  test("instant charges the ITR price, no putty", async () => {
    const done = await call(yardAcademyInstantAction, { monster: "C2" });

    expect(done.status).toBe(200);
    const price = instantTrainPrice(36_000, 24_000);
    expect(done.body.report).toEqual({ monster: "C2", level: 4, credits: price });
    expect(db.row!.credits).toBe(1000 - price);
    expect(putty()).toBe(3_000_000);
    expect(academy().C2).toEqual({ level: 4 });
  });

  test("a Shiny-locked account is refused", async () => {
    const refused = await call(yardAcademyInstantAction, { monster: "C2" }, userOf({ shiny_locked: true }));
    expect(refused.body).toMatchObject({ reason: "shinyLocked" });
    expect(academy().C2).toEqual({ level: 3 });
  });
});

describe("catch-up", () => {
  test("a training that ended finishes on the next request and is reported", async () => {
    const now = getCurrentDateTime();
    db.row = rowOf({
      academy: { C1: { level: 1 }, C2: { level: 3, time: now - 5, duration: 36_000 } },
      buildingdata: { ...(rowOf().buildingdata as Row), "5": { id: 5, t: 26, X: 0, Y: 0, l: 3, upg: "C2" } },
    });
    const answer = await call(yardStateAction, {});

    expect(answer.body.completed).toEqual([
      { kind: "train", id: "C2", t: null, at: now - 5, detail: { level: 4, academy: 5 } },
    ]);
    expect(academy().C2).toEqual({ level: 4 });
    expect(building(5)).not.toHaveProperty("upg");

    // …so a cancel after it is refused rather than refunding a finished training.
    const refused = await call(yardAcademyCancelAction, { monster: "C2" });
    expect(refused.body).toMatchObject({ reason: "notTraining" });
  });
});
