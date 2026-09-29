import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardPlaceDecorationAction } from "./decor.js";
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

  test("a mushroom is in the way", async () => {
    db.row = rowOf({ mushrooms: { l: [[1, 200, 200]], s: getCurrentDateTime() } });
    expect(await place({ type: 28, x: 200, y: 200 })).toMatchObject({
      status: 409,
      body: { reason: "placement", placement: "mushroom" },
    });
  });
});
