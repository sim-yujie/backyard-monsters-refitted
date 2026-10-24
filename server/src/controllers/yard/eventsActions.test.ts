import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type z from "zod";

import type { User } from "../../database/models/user.model.js";
import { KRALLEN_HUNT_GOALS, krallenHunt, type EventDefinition } from "../../game-data/events/events.js";
import { memoryProgressStore } from "../../services/events/progressStore.js";
import { eventsActions } from "./eventsActions.js";
import { yardSpeedupAction } from "./speedup.js";
import { runYardAction, type YardAction, type YardAnswer } from "./yardAction.js";

/**
 * The event claims end to end through the real yard action wrapper, with the
 * save replaced by one in-memory row written only when the transaction
 * commits (as `shinyRoutes.test.ts` does) and the progress table by the
 * in-memory store, which keeps the SQL store's rules
 * (`services/events/progressStore.ts`; the SQL itself is
 * `progressStore.db.test.ts`).
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

const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: BASESAVEID,
  userid: 2,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: Math.floor(Date.now() / 1000),
  credits: 100,
  points: "0",
  flinger: 0,
  catapult: 0,
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
  buildingdata: {
    "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 },
    "1": { id: 1, t: 20, X: 100, Y: 100, l: 1, cU: 9000 },
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

const DAY = 86_400;
/** 2030-01-01T00:00:00Z, a UTC midnight. */
const START = Date.UTC(2030, 0, 1) / 1000;

const TEST_EVENT: EventDefinition = {
  id: "test-event",
  title: "Test",
  text: "A test event.",
  kind: "test",
  startsAt: new Date(START * 1000).toISOString(),
  endsAt: new Date((START + 14 * DAY) * 1000).toISOString(),
  calendar: [
    { rewards: [{ kind: "resources", amounts: { r1: 1_000, r2: 500 } }] },
    { rewards: [{ kind: "shiny", amount: 10 }] },
    { rewards: [{ kind: "speedup", item: "SP2", count: 2 }] },
    { rewards: [{ kind: "decoration", type: 111, count: 1 }] },
    { rewards: [{ kind: "shopItem", item: "BST" }] },
  ],
  ladder: {
    label: "Things found",
    tiers: [
      { need: 3, rewards: [{ kind: "shiny", amount: 5 }] },
      { need: 10, rewards: [{ kind: "decoration", type: 110, count: 1 }] },
    ],
  },
};

let store = memoryProgressStore();
let actions = eventsActions(store, [TEST_EVENT]);

const at = (seconds: number) => setSystemTime(new Date(seconds * 1000));

const call = (action: YardAction<z.ZodType, unknown>, body: unknown, user: User = userOf()): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, action, body);
const claim = () => call(actions.calendarClaim, { event: "test-event" });

beforeEach(() => {
  store = memoryProgressStore();
  actions = eventsActions(store, [TEST_EVENT]);
  at(START + 10 * 3600);
  db.row = rowOf();
});

afterEach(() => {
  setSystemTime();
});

describe("POST /bm/yard/events/calendar/claim", () => {
  test("day 1 pays its resources and says when day 2 opens", async () => {
    const answer = await claim();

    expect(answer.status).toBe(200);
    expect(answer.body.report).toMatchObject({
      event: "test-event",
      day: 1,
      nextAt: START + DAY,
      granted: [{ kind: "resources", credited: { r1: 1_000, r2: 500, r3: 0, r4: 0 } }],
    });
    expect(db.row!.resources).toMatchObject({ r1: 1_000, r2: 500 });
  });

  test("only once per UTC day: a second claim the same day is refused and pays nothing", async () => {
    await claim();
    const before = structuredClone(db.row);
    at(START + DAY - 1);
    const again = await claim();

    expect(again).toMatchObject({ status: 409, body: { reason: "claimedToday", nextAt: START + DAY } });
    expect(db.row).toEqual(before);
  });

  test("two claims at once (a double click, two tabs) pay once", async () => {
    const answers = await Promise.all([claim(), claim()]);

    expect(answers.map((one) => one.status).sort()).toEqual([200, 409]);
    expect(db.row!.resources).toMatchObject({ r1: 1_000, r2: 500 });
    expect(store.rows.get("2:test-event")).toMatchObject({ calendarDays: 1 });
  });

  test("the next day pays the next day number, and a missed day is not lost", async () => {
    await claim();
    at(START + 3 * DAY + 5);
    const answer = await claim();

    expect(answer.body.report).toMatchObject({ day: 2, granted: [{ kind: "shiny", amount: 10 }] });
    expect(db.row!.credits).toBe(110);
  });

  test("Shiny lands on a Shiny-locked account too", async () => {
    await claim();
    at(START + DAY);
    const answer = await call(actions.calendarClaim, { event: "test-event" }, userOf({ shiny_locked: true }));

    expect(answer.status).toBe(200);
    expect(db.row!.credits).toBe(110);
  });

  test("free speed-ups, a decoration and Sharper Tools land in the yard", async () => {
    for (let day = 0; day < 5; day += 1) {
      at(START + day * DAY + 60);
      expect((await claim()).status).toBe(200);
    }
    const storedata = db.row!.storedata as Row;
    expect(storedata.FREESP2).toEqual({ q: 2 });
    expect((db.row!.researchdata as Row).b111).toBe(1);
    expect(storedata.BST).toEqual({ q: 1, s: START + 4 * DAY + 60, e: START + 4 * DAY + 60 + 7 * DAY });
  });

  test("after the last day the calendar is done", async () => {
    for (let day = 0; day < 5; day += 1) {
      at(START + day * DAY + 60);
      await claim();
    }
    at(START + 6 * DAY);
    expect(await claim()).toMatchObject({ status: 409, body: { reason: "calendarDone" } });
  });

  test("outside the event's window the claim is refused", async () => {
    at(START - 1);
    expect(await claim()).toMatchObject({ status: 409, body: { reason: "eventNotActive", startsAt: START } });
    at(START + 14 * DAY);
    expect(await claim()).toMatchObject({ status: 409, body: { reason: "eventNotActive" } });
    expect(store.rows.size).toBe(0);
  });

  test("an unknown event is a 400", async () => {
    const answer = await call(actions.calendarClaim, { event: "nope" });
    expect(answer).toMatchObject({ status: 400, body: { reason: "unknownEvent" } });
  });

  test("resources are clamped to the storage cap, and the report says so", async () => {
    db.row = rowOf({ resources: { r1: 9_500, r2: 0, r3: 0, r4: 0 } });
    const answer = await claim();

    expect(answer.body.report).toMatchObject({
      granted: [{ kind: "resources", credited: { r1: 500, r2: 500 }, overflow: { r1: 500, r2: 0 } }],
    });
    expect(db.row!.resources).toMatchObject({ r1: 10_000, r2: 500 });
  });
});

describe("POST /bm/yard/events/ladder/claim", () => {
  test("a tier is locked until the counter reaches it, then pays once", async () => {
    const tier = () => call(actions.ladderClaim, { event: "test-event", tier: 0 });
    expect(await tier()).toMatchObject({ status: 409, body: { reason: "tierLocked", have: 0, need: 3 } });

    await store.addToCounter(null as never, 2, "test-event", 3);
    expect((await tier()).body.report).toMatchObject({ tier: 0, granted: [{ kind: "shiny", amount: 5 }] });
    expect(db.row!.credits).toBe(105);
    expect(await tier()).toMatchObject({ status: 409, body: { reason: "tierClaimed" } });
  });

  test("an unknown tier is a 400", async () => {
    const answer = await call(actions.ladderClaim, { event: "test-event", tier: 5 });
    expect(answer).toMatchObject({ status: 400, body: { reason: "unknownTier" } });
  });
});

describe("POST /bm/yard/speedup with free speed-ups", () => {
  test("a kept SP2 is spent before Shiny", async () => {
    db.row = rowOf({ storedata: { FREESP2: { q: 2 } } });
    const answer = await call(yardSpeedupAction, { id: 1, item: "SP2" });

    expect(answer.body.report).toMatchObject({ item: "SP2", credits: 0, free: true, freeLeft: 1 });
    expect(db.row!.credits).toBe(100);
    expect((db.row!.storedata as Row).FREESP2).toEqual({ q: 1 });
    expect((db.row!.buildingdata as Record<string, Row>)["1"]!.cU).toBeLessThanOrEqual(9000 - 3600);
  });

  test("with none kept, SP3 costs its Shiny; a Flash-era SP3 count is not a free one", async () => {
    db.row = rowOf({ storedata: { SP3: { q: 4 } } });
    const answer = await call(yardSpeedupAction, { id: 1, item: "SP3" });

    expect(answer.body.report).toMatchObject({ item: "SP3", credits: 40 });
    expect(db.row!.credits).toBe(60);
  });
});

describe("the Krallen Hunt's reward through the ladder claim", () => {
  const JANUARY = krallenHunt(2030, 1);
  const FEBRUARY = krallenHunt(2030, 2);
  const JAN_START = Date.UTC(2030, 0, 15) / 1000;
  const JAN_END = Date.UTC(2030, 1, 1) / 1000;
  const FEB_START = Date.UTC(2030, 1, 15) / 1000;

  /** A feed time still ahead, so the yard's catch-up starves nobody. */
  const FED = JAN_START + 20 * DAY;
  const krallenOf = () => (db.row!.champion as Row[]).find((one) => one.t === 5);
  /** Loot enough for any level's goal. */
  const win = (event: EventDefinition) => store.addToCounter(em as never, 2, event.id, KRALLEN_HUNT_GOALS.at(-1)!);
  const claimHunt = (event: EventDefinition) => call(actions.ladderClaim, { event: event.id, tier: 0 });

  beforeEach(() => {
    actions = eventsActions(store, [JANUARY, FEBRUARY]);
    at(JAN_START + 3 * DAY);
  });

  test("short of the goal the claim is refused and pays nothing", async () => {
    await store.addToCounter(em as never, 2, JANUARY.id, 60_000_000 - 1);
    expect(await claimHunt(JANUARY)).toMatchObject({
      status: 409,
      body: { reason: "tierLocked", have: 60_000_000 - 1, need: 60_000_000 },
    });
    expect(krallenOf()).toBeUndefined();
  });

  test("the goal follows her level at the claim: a level 2 Krallen needs 150 million", async () => {
    const second = { t: 5, hp: 52_000, l: 2, ft: FED, fd: 0, fb: 0, pl: 0, status: 0 };
    db.row = rowOf({ champion: [second] });
    await store.addToCounter(em as never, 2, JANUARY.id, 150_000_000 - 1);
    expect(await claimHunt(JANUARY)).toMatchObject({
      status: 409,
      body: { reason: "tierLocked", have: 150_000_000 - 1, need: 150_000_000 },
    });
    expect(krallenOf()).toMatchObject({ l: 2 });

    await store.addToCounter(em as never, 2, JANUARY.id, 1);
    const answer = await claimHunt(JANUARY);
    expect(answer.body.report).toMatchObject({ granted: [{ kind: "krallen", level: 3, raised: true }] });
    expect(krallenOf()).toMatchObject({ l: 3 });
  });

  test("the first win is a level 1 Krallen beside the cage, full health and fed; a second claim is refused", async () => {
    await win(JANUARY);
    const answer = await claimHunt(JANUARY);

    expect(answer.status).toBe(200);
    expect(answer.body.report).toMatchObject({ granted: [{ kind: "krallen", level: 1, raised: true }] });
    expect(krallenOf()).toEqual({ t: 5, hp: 50_000, l: 1, ft: JAN_START + 3 * DAY + 82_800, fd: 0, fb: 0, pl: 0, status: 0 });
    expect(await claimHunt(JANUARY)).toMatchObject({ status: 409, body: { reason: "tierClaimed" } });
    expect(krallenOf()).toMatchObject({ l: 1 });
  });

  test("each later month's win is one level more", async () => {
    await win(JANUARY);
    await claimHunt(JANUARY);
    at(FEB_START + DAY);
    await win(FEBRUARY);
    const answer = await claimHunt(FEBRUARY);

    expect(answer.body.report).toMatchObject({ granted: [{ kind: "krallen", level: 2, raised: true }] });
    expect(krallenOf()).toMatchObject({ l: 2, hp: 52_000, fd: 0 });
  });

  test("at level 5 a win pays nothing more, and she stays as she is", async () => {
    const top = { t: 5, hp: 40_000, l: 5, ft: FED, fd: 4, fb: 0, pl: 2, status: 0, nm: "Kral" };
    db.row = rowOf({ champion: [top] });
    await win(JANUARY);
    const answer = await claimHunt(JANUARY);

    expect(answer.status).toBe(200);
    expect(answer.body.report).toMatchObject({ granted: [{ kind: "krallen", level: 5, raised: false }] });
    expect(krallenOf()).toEqual(top);
  });

  test("an old save's Krallen (the Flash client's string list) counts as hers and goes up a level", async () => {
    const gorgo = { t: 1, hp: 4000, l: 3, ft: FED, fd: 1, fb: 0, pl: 0, status: 0 };
    const old = { t: 5, hp: 100, l: 3, ft: FED, fd: 2, fb: 0, pl: 2, status: 0, nm: "Old" };
    db.row = rowOf({ champion: JSON.stringify([gorgo, old]) });
    await win(JANUARY);
    await claimHunt(JANUARY);

    expect(db.row!.champion).toEqual([gorgo, { ...old, l: 4, hp: 58_000, fd: 0, ft: JAN_START + 3 * DAY + 82_800 }]);
  });

  test("a frozen Krallen goes up a level and stays frozen, her feed clock stopped", async () => {
    const frozen = { t: 5, hp: 54_000, l: 3, ft: 5_000, fd: 0, fb: 0, pl: 0, status: 1 };
    db.row = rowOf({ champion: [frozen] });
    await win(JANUARY);
    await claimHunt(JANUARY);

    expect(krallenOf()).toEqual({ ...frozen, l: 4, hp: 58_000 });
  });

  test("a goal reached in time can be claimed for 7 days after the month, not after", async () => {
    await win(JANUARY);
    at(JAN_END + 7 * DAY - 1);
    expect((await claimHunt(JANUARY)).status).toBe(200);

    db.row = rowOf();
    store = memoryProgressStore();
    actions = eventsActions(store, [JANUARY, FEBRUARY]);
    await win(JANUARY);
    at(JAN_END + 7 * DAY);
    expect(await claimHunt(JANUARY)).toMatchObject({ status: 409, body: { reason: "eventNotActive" } });
    expect(krallenOf()).toBeUndefined();
  });
});
