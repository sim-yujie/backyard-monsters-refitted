import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import type { Random } from "../../services/yard/mushrooms.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { mushroomPickAction } from "./mushrooms.js";
import { runYardAction, type YardAnswer } from "./yardAction.js";

/**
 * `POST /bm/yard/mushroom/pick` through the real wrapper, with the database
 * replaced by one in-memory row written only when a transaction commits (as in
 * `upgrade.test.ts`), and the reward roll pinned.
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

const userOf = (shinyLocked = false): User =>
  ({ userid: 2505, shiny_locked: shinyLocked, save: { basesaveid: 7 } }) as unknown as User;

/** Two mushrooms grown just now (so the catch-up grows none), a Town Hall, one idle worker. */
const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: 7,
  userid: 2505,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime(),
  credits: 10,
  points: "100",
  flinger: 0,
  catapult: 0,
  resources: { r1: 1000, r2: 1000, r3: 1000, r4: 0 },
  buildingdata: { "0": { id: 0, t: 14, x: 0, y: 0, X: 0, Y: 0, l: 3 } },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: {},
  academy: {},
  champion: [],
  mushrooms: {
    l: [
      [2, 200, 100],
      [5, -300, 40],
    ],
    s: getCurrentDateTime(),
  },
  researchdata: {},
  outposts: [],
  mr2upgraded: true,
  mapversion: 2,
  ...overrides,
});

/** Plays `values` in order, then repeats the last one. */
const sequence = (...values: number[]): Random => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
};

const pick = (body: Row, random: Random, user = userOf()): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, mushroomPickAction(random), body);

beforeEach(() => {
  db.row = rowOf();
});

describe("POST /bm/yard/mushroom/pick", () => {
  test("a golden mushroom goes and its Shiny is credited", async () => {
    const answer = await pick({ id: "1", x: "-300", y: "40" }, sequence(0.1, 0.5));

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      credits: 18,
      mushrooms: { l: [[2, 200, 100]] },
      report: { id: 1, x: -300, y: 40, golden: true, shiny: 8 },
    });
    expect(db.row).toMatchObject({ credits: 18, mushrooms: { l: [[2, 200, 100]] } });
  });

  test("an ordinary mushroom goes and gives nothing", async () => {
    const answer = await pick({ id: 0 }, sequence(0.9));

    expect(answer.body).toMatchObject({ credits: 10, report: { golden: false, shiny: 0 } });
    expect(db.row).toMatchObject({ credits: 10, mushrooms: { l: [[5, -300, 40]] } });
  });

  test("a Shiny-locked account still gets the reward", async () => {
    const answer = await pick({ id: 0 }, sequence(0.0, 0.0), userOf(true));

    expect(answer.status).toBe(200);
    expect(db.row).toMatchObject({ credits: 13 });
  });

  test("no free worker: 409 workers, nothing written", async () => {
    db.row = rowOf({
      buildingdata: {
        "0": { id: 0, t: 14, x: 0, y: 0, X: 0, Y: 0, l: 3 },
        "1": { id: 1, t: 20, x: 0, y: 0, X: 300, Y: 300, l: 1, cU: 5000 },
      },
    });
    const before = structuredClone(db.row);

    const answer = await pick({ id: 0 }, sequence(0.1));

    expect(answer).toMatchObject({
      status: 409,
      body: { reason: "workers", workers: { total: 1, busy: 1 } },
    });
    expect(db.row).toEqual(before);
  });

  test("a malformed id is 400; a stale position is 409 moved", async () => {
    expect((await pick({ id: -1 }, Math.random)).status).toBe(400);
    expect((await pick({ id: 5 }, Math.random)).body).toMatchObject({ reason: "badRequest" });
    expect((await pick({ id: 0, x: 1, y: 1 }, Math.random)).body).toMatchObject({
      reason: "moved",
    });
  });
});
