import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import { storageCap } from "../../services/base/economy/resourceBudget.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardBuildAction, yardCancelBuildAction, yardInstantBuildAction } from "./build.js";
import { yardStateAction } from "./state.js";
import { runYardAction, type YardAnswer } from "./yardAction.js";

/**
 * `POST /bm/yard/build`, `/build/cancel` and `/build/instant` through the real
 * wrapper, with the database replaced by one in-memory row that is written
 * only when a transaction commits (as `upgrade.test.ts` does).
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

/** A main yard saved just now: level 3 hall, a level 10 silo, one idle worker, 100 Shiny. */
const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: 7,
  userid: 2503,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime(),
  credits: 100,
  points: "100",
  flinger: 0,
  catapult: 0,
  resources: { r1: 60000, r2: 40000, r3: 20000, r4: 0 },
  buildingdata: {
    "1": { id: 1, t: 14, X: -65, Y: -65, l: 3 },
    "2": { id: 2, t: 6, X: -400, Y: 200, l: 10 },
  },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  // Every save has the Pokey unlocked (#218); the first catch-up would add it.
  lockerdata: { C1: { t: 2 } },
  academy: {},
  champion: [],
  mushrooms: { l: [], s: getCurrentDateTime() },
  researchdata: {},
  outposts: [],
  ...overrides,
});

const call = (action: Parameters<typeof runYardAction>[2], body: Row): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, action, body);

const build = (type: unknown, x: unknown, y: unknown) => call(yardBuildAction, { type, x, y });
const cancel = (id: unknown) => call(yardCancelBuildAction, { id });
const instant = (type: unknown, x: unknown, y: unknown) =>
  call(yardInstantBuildAction, { type, x, y });

/** The row without the columns a request always moves (as in `upgrade.test.ts`). */
const settled = (row: Row | null) => {
  const { savetime: _savetime, monsters: _monsters, ...rest } = row!;
  return rest;
};

const buildings = () => db.row!.buildingdata as Record<string, Row>;

beforeEach(() => {
  db.row = rowOf();
});

describe("POST /bm/yard/build", () => {
  test("places a tower under construction: charged, a worker busy, the report", async () => {
    const answer = await build("20", "300", "-300");

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      error: 0,
      resources: { r1: 58000, r2: 38500, r3: 19500, r4: 0 },
      workers: { total: 1, busy: 1 },
      report: { id: 3, t: 20, x: 300, y: -300, seconds: 30, finished: false },
    });
    expect(buildings()["3"]).toEqual({ id: 3, t: 20, X: 300, Y: -300, cB: 30, cL: 30 });
    expect(db.row!.points).toBe("100");
  });

  test("the catch-up finishes it at level 1 with the build's points", async () => {
    await build(20, 300, -300);
    db.row!.savetime = Number(db.row!.savetime) - 60;

    const answer = await call(yardStateAction, {});

    expect(answer.body).toMatchObject({
      completed: [{ kind: "build", id: 3, t: 20, detail: { from: 0, level: 1, points: 415 } }],
      workers: { busy: 0 },
    });
    expect(buildings()["3"]).toEqual({ id: 3, t: 20, X: 300, Y: -300 });
    expect(db.row!.points).toBe("515");
  });

  test("a wall is finished at once with its points, no worker", async () => {
    const answer = await build(17, 0, 200);

    expect(answer.body).toMatchObject({
      workers: { total: 1, busy: 0 },
      report: { id: 3, finished: true, points: 102 },
      resources: { r1: 59000 },
    });
    expect(buildings()["3"]).toEqual({ id: 3, t: 17, X: 0, Y: 200 });
    expect(db.row!.points).toBe("202");
  });

  test("a refusal writes nothing and answers in the flat shape", async () => {
    const before = structuredClone(db.row);
    const answer = await build(20, 0, 0); // on the hall

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ reason: "placement", placement: "overlap", with: 1 });
    expect(typeof answer.body.error).toBe("string");
    expect(db.row).toEqual(before);
  });

  test("a malformed body is a 400 badRequest", async () => {
    expect((await build("tower", 0, 0)).body).toMatchObject({ reason: "badRequest" });
    expect((await build(20, 1.5, 0)).status).toBe(400);
  });
});

describe("POST /bm/yard/build/cancel", () => {
  test("build then cancel leaves the row as it was, savetime aside", async () => {
    const before = settled(db.row);

    await build(20, 300, -300);
    const answer = await cancel(3);

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      workers: { total: 1, busy: 0 },
      report: { id: 3, t: 20, refund: { r1: 2000, r2: 1500, r3: 500, r4: 0 } },
    });
    expect(settled(db.row)).toEqual(before);
  });

  test("the refund stops at the storage cap", async () => {
    const cap = storageCap(rowOf());
    db.row = rowOf({ resources: { r1: cap - 1000, r2: 0, r3: 0, r4: 0 } });
    buildings()["3"] = { id: 3, t: 20, X: 300, Y: -300, cB: 20, cL: 30 };

    const answer = await cancel(3);

    expect(answer.body).toMatchObject({
      report: { refund: { r1: 1000, r2: 1500, r3: 500, r4: 0 } },
      resources: { r1: cap, r2: 1500, r3: 500, r4: 0 },
    });
  });

  test("a build that finished during the catch-up cannot be cancelled", async () => {
    db.row = rowOf({ savetime: getCurrentDateTime() - 600 });
    buildings()["3"] = { id: 3, t: 20, X: 300, Y: -300, cB: 20, cL: 30 };

    const answer = await cancel(3);

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ reason: "notBuilding" });
    expect(buildings()["3"]).toBeDefined();
  });
});

describe("POST /bm/yard/build/instant", () => {
  test("finished now for Shiny: no resources, points awarded", async () => {
    const answer = await instant(20, 300, -300);

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      credits: 83,
      resources: { r1: 60000, r2: 40000, r3: 20000, r4: 0 },
      workers: { busy: 0 },
      report: { id: 3, credits: 17, points: 415 },
    });
    expect(buildings()["3"]).toEqual({ id: 3, t: 20, X: 300, Y: -300 });
    expect(db.row!.points).toBe("515");
  });

  test("refused for a Shiny-locked account and for a short balance, writing nothing", async () => {
    const before = structuredClone(db.row);
    const locked = { ...user, shiny_locked: true } as unknown as User;
    const lockedAnswer = await runYardAction(
      em as unknown as EntityManager,
      locked,
      yardInstantBuildAction,
      { type: 20, x: 300, y: -300 }
    );
    expect(lockedAnswer.body).toMatchObject({ reason: "shinyLocked" });
    expect(db.row).toEqual(before);

    db.row = rowOf({ credits: 5 });
    const poor = structuredClone(db.row);
    const shortAnswer = await instant(20, 300, -300);
    expect(shortAnswer.body).toMatchObject({ reason: "credits", credits: { have: 5, need: 17 } });
    expect(db.row).toEqual(poor);
  });
});
