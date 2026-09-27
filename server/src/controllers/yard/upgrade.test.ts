import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import { storageCap } from "../../services/base/economy/resourceBudget.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardCancelUpgradeAction, yardUpgradeAction } from "./upgrade.js";
import { runYardAction, type YardAnswer } from "./yardAction.js";

/**
 * `POST /bm/yard/upgrade` and `/upgrade/cancel` through the real wrapper, with
 * the database replaced by one in-memory row that is written only when a
 * transaction commits (the locking itself is `yardAction.test.ts`'s business).
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

const user = {
  userid: 2503,
  shiny_locked: false,
  save: { basesaveid: 7 },
} as unknown as User;

/** A main yard saved just now: level 3 hall, level 2 Cannon Tower, one idle worker. */
const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: 7,
  userid: 2503,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime(),
  credits: 0,
  points: "100",
  flinger: 0,
  catapult: 0,
  resources: { r1: 60000, r2: 40000, r3: 20000, r4: 0 },
  buildingdata: {
    "0": { id: 0, t: 14, x: 0, y: 0, l: 3 },
    "1": { id: 1, t: 20, x: 0, y: 0, l: 2 },
    "2": { id: 2, t: 6, x: 0, y: 0, l: 10 },
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

const upgrade = (id: unknown): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, yardUpgradeAction, { id });

const cancel = (id: unknown): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, yardCancelUpgradeAction, { id });

/** The row without the columns a request always moves. */
const settled = (row: Row | null) => {
  const { savetime: _savetime, ...rest } = row!;
  return rest;
};

beforeEach(() => {
  db.row = rowOf();
});

describe("POST /bm/yard/upgrade", () => {
  test("starts the step: countdown, charge, a worker busy, the report", async () => {
    const answer = await upgrade("1");

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      error: 0,
      resources: { r1: 10000, r2: 2500, r3: 7500, r4: 0 },
      workers: { total: 1, busy: 1 },
      report: {
        id: 1,
        from: 2,
        to: 3,
        seconds: 2700,
        cost: { r1: 50000, r2: 37500, r3: 12500, r4: 0 },
        finished: false,
      },
    });
    expect((db.row!.buildingdata as Record<string, Row>)["1"]).toMatchObject({ l: 2, cU: 2700 });
    expect(db.row!.points).toBe("100");
  });

  test("a refusal writes nothing and answers in the flat shape", async () => {
    db.row = rowOf({ resources: { r1: 100, r2: 100, r3: 100, r4: 0 } });
    const before = structuredClone(db.row);

    const answer = await upgrade(1);

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({
      reason: "shortfall",
      shortfall: { r1: 49900, r2: 37400, r3: 12400, r4: 0 },
    });
    expect(typeof answer.body.error).toBe("string");
    expect(db.row).toEqual(before);
  });

  test("a malformed id is a 400 badRequest", async () => {
    const answer = await upgrade("tower");

    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ reason: "badRequest" });
  });
});

describe("POST /bm/yard/upgrade/cancel", () => {
  test("upgrade then cancel leaves the row as it was, savetime aside", async () => {
    const before = settled(db.row);

    await upgrade(1);
    const answer = await cancel(1);

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      workers: { total: 1, busy: 0 },
      report: { id: 1, refund: { r1: 50000, r2: 37500, r3: 12500, r4: 0 } },
    });
    expect(settled(db.row)).toEqual(before);
  });

  test("the refund stops at the storage cap", async () => {
    const cap = storageCap(rowOf());
    db.row = rowOf({ resources: { r1: cap - 1000, r2: 0, r3: 0, r4: 0 } });
    (db.row.buildingdata as Record<string, Row>)["1"]!.cU = 500;

    const answer = await cancel(1);

    expect(answer.body).toMatchObject({
      report: { refund: { r1: 1000, r2: 37500, r3: 12500, r4: 0 } },
      resources: { r1: cap, r2: 37500, r3: 12500, r4: 0 },
    });
  });

  test("an upgrade that finished during the catch-up cannot be cancelled", async () => {
    db.row = rowOf({ savetime: getCurrentDateTime() - 600 });
    (db.row.buildingdata as Record<string, Row>)["1"]!.cU = 100;

    const answer = await cancel(1);

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ reason: "notUpgrading" });
  });
});
