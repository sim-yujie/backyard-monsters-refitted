import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardRepairAction, yardRepairInstantAction } from "./repair.js";
import { runYardAction, type YardAnswer } from "./yardAction.js";

/**
 * `POST /bm/yard/repair` and `/repair/instant` through the real wrapper, the
 * database replaced by one in-memory row written only when a transaction
 * commits (as `bank.test.ts`).
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

const userOf = (locked = false) =>
  ({ userid: 2505, shiny_locked: locked, save: { basesaveid: 7 } }) as unknown as User;

/** Saved just now; a Town Hall 10 at no health, a damaged snapper, a whole one. */
const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: 7,
  userid: 2505,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime(),
  credits: 1000,
  points: "100",
  tutorialstage: 205,
  flinger: 0,
  catapult: 0,
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
  buildingdata: {
    "0": { id: 0, t: 14, x: 0, y: 0, l: 10, hp: 0 },
    "1": { id: 1, t: 1, x: 0, y: 0, hp: 100, st: 0, pr: 0 },
    "2": { id: 2, t: 1, x: 0, y: 0, st: 0, pr: 0 },
  },
  buildinghealthdata: { "0": 0, "1": 100 },
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

const repair = (body: Row): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, userOf(), yardRepairAction, body);

const instant = (locked = false): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, userOf(locked), yardRepairInstantAction, {});

describe("POST /bm/yard/repair", () => {
  beforeEach(() => {
    db.row = rowOf();
  });

  test("all=1 sets rE on every damaged building, free, and writes it", async () => {
    const answer = await repair({ all: "1" });
    expect(answer.status).toBe(200);
    expect((answer.body.report as Row).started).toEqual([0, 1]);
    const buildings = db.row!.buildingdata as Record<string, Row>;
    expect(buildings["0"]).toMatchObject({ rE: 1 });
    expect(buildings["1"]).toMatchObject({ rE: 1 });
    expect(buildings["2"]!.rE).toBeUndefined();
    expect(db.row!.credits).toBe(1000);
    expect(db.row!.resources).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });

  test("ids starts one building", async () => {
    const answer = await repair({ ids: "[1]" });
    expect(answer.status).toBe(200);
    const buildings = db.row!.buildingdata as Record<string, Row>;
    expect(buildings["1"]).toMatchObject({ rE: 1 });
    expect(buildings["0"]!.rE).toBeUndefined();
  });

  test("nothing to repair is a 409 and writes nothing", async () => {
    const before = structuredClone(db.row);
    const answer = await repair({ ids: "[2]" });
    expect(answer.status).toBe(409);
    expect(answer.body.reason).toBe("notDamaged");
    expect(db.row).toEqual(before);
  });

  test("the body needs exactly one of ids and all", async () => {
    for (const body of [{}, { ids: "[1]", all: "1" }, { ids: "[]" }]) {
      expect((await repair(body)).status).toBe(400);
    }
  });
});

describe("POST /bm/yard/repair/instant", () => {
  beforeEach(() => {
    db.row = rowOf();
  });

  test("heals everything damaged and charges FIX's price", async () => {
    const answer = await instant();
    expect(answer.status).toBe(200);
    const report = answer.body.report as { repaired: number[]; credits: number };
    expect(report.repaired).toEqual([0, 1]);
    // The Town Hall's hour (at most) is charged; the snapper's 23 s is not.
    expect(report.credits).toBeGreaterThan(10);
    expect(db.row!.credits).toBe(1000 - report.credits);
    expect(db.row!.buildinghealthdata).toEqual({});
    const buildings = db.row!.buildingdata as Record<string, Row>;
    expect(buildings["0"]!.hp).toBeUndefined();
    expect(buildings["1"]!.hp).toBeUndefined();
  });

  test("refuses a Shiny-locked account, and one short of Shiny", async () => {
    const before = structuredClone(db.row);
    const locked = await instant(true);
    expect(locked.status).toBe(409);
    expect(locked.body.reason).toBe("shinyLocked");

    db.row = rowOf({ credits: 0 });
    const poor = await instant();
    expect(poor.status).toBe(409);
    expect(poor.body.reason).toBe("credits");
    db.row = before;
  });

  test("refuses when nothing is damaged", async () => {
    db.row = rowOf({ buildingdata: { "2": { id: 2, t: 1, x: 0, y: 0 } }, buildinghealthdata: {} });
    const answer = await instant();
    expect(answer.status).toBe(409);
    expect(answer.body.reason).toBe("notDamaged");
  });
});
