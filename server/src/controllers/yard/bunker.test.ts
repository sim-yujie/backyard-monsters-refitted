import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import { bunkerCapacity, bunkerPutty, readBunker } from "../../services/yard/bunker.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { readOnboarding } from "../../services/onboarding/state.js";
import { yardBunkerFillAction, yardBunkerRemoveAction } from "./bunker.js";
import { runYardAction, type YardAnswer } from "./yardAction.js";

/**
 * `POST /bm/yard/bunker/fill` and `/bunker/remove` through the real wrapper,
 * the database replaced by one in-memory row written only when a transaction
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

const user = { userid: 2505, shiny_locked: false, save: { basesaveid: 7 } } as unknown as User;

/** Town Hall and two level 1 Housing (400 space); no silos, so every cap is 10,000. */
const BASE_BUILDINGS: Row = {
  "0": { id: 0, t: 14, x: 0, y: 0, l: 3 },
  "1": { id: 1, t: 15, x: 0, y: 200, l: 1 },
  "2": { id: 2, t: 15, x: 200, y: 200, l: 1 },
};

const bunkerAt = (building: Row = {}, others: Row = {}): Row => ({
  buildingdata: { ...BASE_BUILDINGS, "8": { id: 8, t: 22, x: 400, y: 0, l: 1, ...building }, ...others },
});

const JUICER: Row = { "5": { id: 5, t: 9, x: 100, y: 0, l: 1 } };

/** Saved just now: an empty level 1 bunker (380 room), 30 Pokey and 5 Octo-ooze housed, Octo-ooze unlocked. */
const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: 7,
  userid: 2505,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime(),
  credits: 100,
  points: "100",
  tutorialstage: 0,
  flinger: 0,
  catapult: 0,
  resources: { r1: 0, r2: 0, r3: 10_000, r4: 1_000 },
  ...bunkerAt(),
  buildinghealthdata: {},
  storedata: {},
  monsters: { housed: { C1: 30, C2: 5 }, saved: getCurrentDateTime() },
  lockerdata: { C1: { t: 2 }, C2: { t: 2 } },
  academy: {},
  champion: [],
  mushrooms: {},
  researchdata: {},
  outposts: [],
  ...overrides,
});

const fill = (monsters: Record<string, number>, source = "housing", bunker = 8): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, yardBunkerFillAction, {
    bunker: String(bunker),
    monsters: JSON.stringify(monsters),
    source,
  });

const remove = (monster: string, count: number | "all" = 1, bunker = 8): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, yardBunkerRemoveAction, {
    bunker: String(bunker),
    monster,
    count: String(count),
  });

const contentsOf = (row: Row, id = "8") => (row.buildingdata as Record<string, Row>)[id]!.m;

describe("bunker rules", () => {
  test("room by level is the Map Room 2 table; nothing while being built", () => {
    expect([0, 1, 2, 3, 4, 5].map(bunkerCapacity)).toEqual([0, 380, 450, 540, 660, 800]);
  });

  test("putty from housing is half the hatch cost, rounded down per type", () => {
    // Pokey 250 at level 1; Octo-ooze 500; Pokey 675 at level 3.
    expect(bunkerPutty("C1", 3, {})).toBe(375);
    expect(bunkerPutty("C2", 5, {})).toBe(1_250);
    expect(bunkerPutty("C1", 1, { C1: 3 })).toBe(337);
  });

  test("contents read whole counts, merge the legacy id, and count per-creep arrays", () => {
    expect(readBunker({ id: 1, t: 22, m: { C1: 3, C100: 2, C12: 1, C2: 0, junk: 4 } } as never)).toEqual({
      C1: 3,
      C12: 3,
    });
    expect(readBunker({ id: 1, t: 22, m: { C3: [{}, {}] } } as never)).toEqual({ C3: 2 });
    expect(readBunker(undefined)).toEqual({});
  });
});

describe("POST /bm/yard/bunker/fill", () => {
  beforeEach(() => {
    db.row = rowOf();
  });

  test("from housing: the monsters move in, for half their hatch cost in putty", async () => {
    const answer = await fill({ C1: 10, C2: 5 });
    expect(answer.status).toBe(200);
    expect(answer.body.report).toEqual({
      bunker: 8,
      source: "housing",
      added: { C1: 10, C2: 5 },
      cost: { r3: 2_500 },
      credits: 0,
      used: 150,
      capacity: 380,
    });
    const row = db.row!;
    expect(contentsOf(row)).toEqual({ C1: 10, C2: 5 });
    expect((row.monsters as Row).housed).toEqual({ C1: 20 });
    expect(row.resources).toMatchObject({ r3: 7_500 });
    expect(row.credits).toBe(100);
  });

  test("adds to what the bunker already holds", async () => {
    db.row = rowOf(bunkerAt({ m: { C1: 20 } }));
    const answer = await fill({ C1: 5 });
    expect(answer.status).toBe(200);
    expect(contentsOf(db.row!)).toEqual({ C1: 25 });
    expect(answer.body.report).toMatchObject({ used: 250 });
  });

  test("bought: Shiny at the original's prices, housing untouched", async () => {
    const answer = await fill({ C2: 3 }, "buy");
    expect(answer.status).toBe(200);
    expect(answer.body.report).toMatchObject({ added: { C2: 3 }, cost: { r3: 0 }, credits: 6 });
    const row = db.row!;
    expect(row.credits).toBe(94);
    expect(contentsOf(row)).toEqual({ C2: 3 });
    expect((row.monsters as Row).housed).toEqual({ C1: 30, C2: 5 });
    expect(row.resources).toMatchObject({ r3: 10_000 });
  });

  test("room counts what is inside plus the whole selection; an upgrading bunker holds at its old level", async () => {
    db.row = rowOf(bunkerAt({ m: { C1: 35 } }));
    const full = await fill({ C2: 5 });
    expect(full.status).toBe(409);
    expect(full.body).toMatchObject({ reason: "bunkerFull", capacity: 380, used: 350, need: 50 });

    db.row = rowOf(bunkerAt({ l: 2, m: { C1: 35 } }));
    expect((await fill({ C2: 5 })).status).toBe(200);

    db.row = rowOf(bunkerAt({ l: 1, cU: 600, m: { C1: 35 } }));
    expect((await fill({ C2: 5 })).body.reason).toBe("bunkerFull");
  });

  test("refusals, in order, and nothing is written", async () => {
    const cases: [Row, Record<string, number>, string, number, string, number?][] = [
      [{}, { C1: 1 }, "housing", 409, "noBunker", 99],
      [bunkerAt({ l: 0, cB: 600 }), { C1: 1 }, "housing", 409, "busy"],
      [{}, { G1: 1 }, "housing", 400, "badRequest"],
      [{}, { C14: 1 }, "housing", 409, "notBunkerable"],
      [{}, { C1: 1 }, "buy", 409, "notBuyable"],
      [{}, { C5: 1 }, "buy", 409, "locked"],
      [{}, { C2: 6 }, "housing", 409, "notEnough"],
      [{ resources: { r1: 0, r2: 0, r3: 100, r4: 0 } }, { C1: 1 }, "housing", 409, "shortfall"],
      [{ credits: 1 }, { C2: 1 }, "buy", 409, "credits"],
      [{ monsters: { C1: [{ id: 1 }] } }, { C1: 1 }, "housing", 409, "mapRoom3"],
    ];
    for (const [overrides, monsters, source, status, reason, bunker] of cases) {
      db.row = rowOf(overrides);
      const before = structuredClone(db.row);
      const answer = await fill(monsters, source, bunker);
      expect([reason, answer.status]).toEqual([reason, status]);
      expect(answer.body.reason).toBe(reason);
      expect(db.row).toEqual(before);
    }
  });

  test("a locked account cannot buy", async () => {
    const locked = { ...user, shiny_locked: true } as unknown as User;
    const answer = await runYardAction(em as unknown as EntityManager, locked, yardBunkerFillAction, {
      bunker: "8",
      monsters: JSON.stringify({ C2: 1 }),
      source: "buy",
    });
    expect(answer.status).toBe(409);
    expect(answer.body.reason).toBe("shinyLocked");
  });

  test("the body needs a bunker id, counts and a source", async () => {
    for (const body of [
      { bunker: "8", monsters: "{}", source: "housing" },
      { bunker: "8", monsters: '{"C1":1}', source: "store" },
      { bunker: "x", monsters: '{"C1":1}', source: "housing" },
      { monsters: '{"C1":1}', source: "housing" },
    ]) {
      const answer = await runYardAction(em as unknown as EntityManager, user, yardBunkerFillAction, body);
      expect(answer.status).toBe(400);
      expect(answer.body.reason).toBe("badRequest");
    }
  });
});

describe("POST /bm/yard/bunker/remove", () => {
  beforeEach(() => {
    db.row = rowOf(bunkerAt({ m: { C1: 10, C2: 4 } }, JUICER));
  });

  test("with a working Juicer the monsters are juiced for goo", async () => {
    const answer = await remove("C1", 3);
    expect(answer.status).toBe(200);
    // ceil(250 × 0.6) = 150 each.
    expect(answer.body.report).toEqual({ bunker: 8, monster: "C1", removed: 3, juiced: true, goo: 450, lost: 0 });
    expect(contentsOf(db.row!)).toEqual({ C1: 7, C2: 4 });
    expect(db.row!.resources).toMatchObject({ r4: 1_450 });
    // Never back to housing (D11).
    expect((db.row!.monsters as Row).housed).toEqual({ C1: 30, C2: 5 });
    // Goals BL1-BL4 (#227): Flash counted a bunker's juiced monsters too.
    expect(readOnboarding({ onboarding: db.row!.onboarding }).counters.juiced).toBe(3);
  });

  test("all takes the whole stack; more than the bunker holds takes what it holds", async () => {
    expect((await remove("C2", "all")).body.report).toMatchObject({ removed: 4 });
    expect(contentsOf(db.row!)).toEqual({ C1: 10 });
    expect((await remove("C1", 50)).body.report).toMatchObject({ removed: 10 });
    expect(contentsOf(db.row!)).toEqual({});
  });

  test("without a working Juicer they are deleted: no goo", async () => {
    for (const overrides of [
      bunkerAt({ m: { C1: 10 } }),
      bunkerAt({ m: { C1: 10 } }, { "5": { id: 5, t: 9, x: 100, y: 0, l: 1, cU: 60 } }),
      { ...bunkerAt({ m: { C1: 10 } }, JUICER), buildinghealthdata: { "5": 8_000 } },
    ]) {
      db.row = rowOf(overrides);
      const answer = await remove("C1", 2);
      expect(answer.status).toBe(200);
      expect(answer.body.report).toMatchObject({ removed: 2, juiced: false, goo: 0, lost: 0 });
      expect(contentsOf(db.row!)).toEqual({ C1: 8 });
      expect(db.row!.resources).toMatchObject({ r4: 1_000 });
      // Deleted, not juiced: Goals count nothing.
      expect(readOnboarding({ onboarding: db.row!.onboarding }).counters.juiced).toBe(0);
    }
  });

  test("the goo cap swallows what does not fit", async () => {
    db.row = rowOf({
      ...bunkerAt({ m: { C1: 10 } }, JUICER),
      resources: { r1: 0, r2: 0, r3: 0, r4: 9_900 },
    });
    const answer = await remove("C1", "all");
    expect(answer.body.report).toMatchObject({ removed: 10, goo: 100, lost: 1_400 });
    expect(db.row!.resources).toMatchObject({ r4: 10_000 });
  });

  test("refusals: no such bunker, not a monster, none of it inside", async () => {
    const before = structuredClone(db.row);
    expect((await remove("C1", 1, 99)).body.reason).toBe("noBunker");
    expect((await remove("G1")).status).toBe(400);
    const none = await remove("C3");
    expect(none.status).toBe(409);
    expect(none.body).toMatchObject({ reason: "notInBunker", monster: "C3" });
    expect(db.row).toEqual(before);
  });
});
