import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardRecycleAction } from "./recycle.js";
import { runYardAction, type YardAnswer } from "./yardAction.js";

/**
 * `POST /bm/yard/recycle` through the real wrapper, the database replaced by
 * one in-memory row written only when a transaction commits (as `bank.test.ts`).
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

/** Saved just now; a Town Hall, a level 2 Twig Snapper, a flag; 9,500 pebbles under a 10,000 cap. */
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
  resources: { r1: 0, r2: 9_500, r3: 0, r4: 0 },
  buildingdata: {
    "0": { id: 0, t: 14, x: 0, y: 0, l: 3 },
    "1": { id: 1, t: 1, x: 0, y: 0, l: 2, st: 0, pr: 0 },
    "2": { id: 2, t: 28, x: 0, y: 0 },
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

const recycle = (body: Row): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, yardRecycleAction, body);

describe("POST /bm/yard/recycle", () => {
  beforeEach(() => {
    db.row = rowOf();
  });

  test("removes the building and credits half its cost under the cap", async () => {
    const answer = await recycle({ id: "1" });
    expect(answer.status).toBe(200);
    expect(answer.body.report).toMatchObject({ id: 1, t: 1, refund: { r2: 500 }, lost: { r2: 662 } });
    expect(db.row!.resources).toMatchObject({ r2: 10_000 });
    expect((db.row!.buildingdata as Row)["1"]).toBeUndefined();
  });

  test("puts a decoration into storage", async () => {
    const answer = await recycle({ id: "2" });
    expect(answer.status).toBe(200);
    expect(db.row!.researchdata).toEqual({ b28: 1 });
    expect(db.row!.resources).toMatchObject({ r2: 9_500 });
  });

  test("refuses the Town Hall and writes nothing", async () => {
    const before = structuredClone(db.row);
    const answer = await recycle({ id: "0" });
    expect(answer.status).toBe(409);
    expect(answer.body.reason).toBe("isTownHall");
    expect(db.row).toEqual(before);
  });

  test("400s a malformed id and one not in the yard", async () => {
    expect((await recycle({})).status).toBe(400);
    expect((await recycle({ id: "-1" })).status).toBe(400);
    expect((await recycle({ id: "42" })).status).toBe(400);
  });
});
