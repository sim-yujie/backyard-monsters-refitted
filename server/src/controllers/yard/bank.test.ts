import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardBankAction } from "./bank.js";
import { runYardAction, type YardAnswer } from "./yardAction.js";

/**
 * `POST /bm/yard/bank` through the real wrapper, the database replaced by one
 * in-memory row written only when a transaction commits (as `upgrade.test.ts`).
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

/** Saved just now; two full level 1 harvesters and a producing one; no silos (cap 10,000). */
const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: 7,
  userid: 2505,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime(),
  credits: 0,
  points: "100",
  tutorialstage: 0,
  flinger: 0,
  catapult: 0,
  resources: { r1: 9500, r2: 0, r3: 0, r4: 0 },
  buildingdata: {
    "0": { id: 0, t: 14, x: 0, y: 0, l: 3 },
    "1": { id: 1, t: 1, x: 0, y: 0, st: 720, pr: 0 },
    "2": { id: 2, t: 4, x: 0, y: 0, st: 720, pr: 0 },
    "3": { id: 3, t: 2, x: 0, y: 0, st: 30, pr: 1, cP: 600 },
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

const bank = (body: Row): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, yardBankAction, body);

describe("POST /bm/yard/bank", () => {
  beforeEach(() => {
    db.row = rowOf();
  });

  test("all=1 banks every eligible harvester, keeps the overflow, awards points", async () => {
    const answer = await bank({ all: "1" });
    expect(answer.status).toBe(200);
    const report = answer.body.report as Record<string, unknown>;
    expect(report.banked).toEqual({ r1: 500, r2: 30, r3: 0, r4: 720 });
    expect(report.leftInBuffers).toEqual({ r1: 220, r2: 0, r3: 0, r4: 0 });

    const row = db.row!;
    expect(row.resources).toMatchObject({ r1: 10000, r2: 30, r4: 720 });
    const buildings = row.buildingdata as Record<string, Row>;
    expect(buildings["1"]).toMatchObject({ st: 220, pr: 1, cP: 10 });
    expect(buildings["2"]).toMatchObject({ st: 0, pr: 1, cP: 10 });
    // Was producing already: its cycle carries on (less whatever second passed).
    expect(buildings["3"]).toMatchObject({ st: 0, pr: 1 });
    expect(Number(buildings["3"]!.cP)).toBeGreaterThan(590);
    // skipTutorial is on outside production: stage 205, half points rounded up.
    expect(row.points).toBe(String(100 + 250 + 15 + 360));
  });

  test("ids banks only the named harvester, sent as a JSON string", async () => {
    const answer = await bank({ ids: "[2]" });
    expect(answer.status).toBe(200);
    expect(db.row!.resources).toMatchObject({ r1: 9500, r4: 720 });
    expect((answer.body.report as Row).byBuilding).toEqual({ "2": { resource: "r4", amount: 720 } });
  });

  test("an unknown id is refused and nothing is written", async () => {
    const before = structuredClone(db.row);
    const answer = await bank({ ids: "[1, 42]" });
    expect(answer.status).toBe(400);
    expect(answer.body.reason).toBe("badRequest");
    expect(db.row).toEqual(before);
  });

  test("the body needs exactly one of ids and all", async () => {
    for (const body of [{}, { ids: "[1]", all: "1" }, { ids: "nope" }, { ids: "[]" }, { all: "2" }]) {
      const answer = await bank(body);
      expect(answer.status).toBe(400);
      expect(answer.body.reason).toBe("badRequest");
    }
  });
});
