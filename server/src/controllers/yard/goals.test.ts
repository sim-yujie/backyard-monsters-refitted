import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type z from "zod";
import type { User } from "../../database/models/user.model.js";
import { readOnboarding } from "../../services/onboarding/state.js";
import { BASE_STORAGE } from "../../services/base/economy/resourceBudget.js";
import type { BaiterTicket, BaiterTokenStore } from "../../services/goals/baiterRun.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { goalsActions } from "./goalsActions.js";
import { runYardAction, type YardAnswer, type YardAction } from "./yardAction.js";

/**
 * The Goals routes (issue #227) through the real yard action wrapper, with the
 * database replaced by one in-memory row written only when a transaction
 * commits (as in `mushrooms.test.ts`), and the Baiter tokens in memory.
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

/** A new account's yard, guide running: a Town Hall, a Sniper Tower and Housing, all finished. */
const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: 7,
  baseid: "77",
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
  buildingdata: {
    "0": { id: 0, t: 14, x: 0, y: 0, X: 0, Y: 0, l: 1 },
    "1": { id: 1, t: 21, x: 0, y: 0, X: 200, Y: 0, l: 1 },
    "2": { id: 2, t: 15, x: 0, y: 0, X: -200, Y: 0, l: 1 },
  },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: {},
  academy: {},
  champion: [],
  mushrooms: { l: [], s: getCurrentDateTime() },
  researchdata: {},
  outposts: [],
  mapversion: 1,
  onboarding: { v: 1, guide: { state: "active", step: "home-goals" }, raidSeen: 100 },
  ...overrides,
});

/** Tokens in memory, with the same take-once rule as the Redis store. */
const memoryTokens = (): BaiterTokenStore & { tickets: Map<number, BaiterTicket> } => {
  const tickets = new Map<number, BaiterTicket>();
  return {
    tickets,
    async issue(userid, ticket) {
      tickets.set(userid, ticket);
    },
    async take(userid) {
      const ticket = tickets.get(userid) ?? null;
      tickets.delete(userid);
      return ticket;
    },
  };
};

let tokens = memoryTokens();
let actions = goalsActions(tokens);

const call = <Schema extends z.ZodType, Report>(
  action: YardAction<Schema, Report>,
  body: Row = {}
): Promise<YardAnswer> => runYardAction(em as unknown as EntityManager, user, action, body);

const stored = () => readOnboarding({ onboarding: db.row?.onboarding });

beforeEach(() => {
  db.row = rowOf();
  tokens = memoryTokens();
  actions = goalsActions(tokens);
});

describe("goals/state", () => {
  test("lists shown goals with status, and writes sticky done", async () => {
    const answer = await call(actions.state);
    expect(answer.status).toBe(200);
    const goals = (answer.body.report as { goals: { id: string; status: string; progress?: unknown }[] }).goals;
    const byId = new Map(goals.map((goal) => [goal.id, goal]));
    expect(byId.get("T1")?.status).toBe("ready");
    expect(byId.get("CR3")?.status).toBe("ready");
    expect(byId.get("D1")?.status).toBe("ready");
    expect(byId.get("T2")?.status).toBe("open");
    expect(byId.get("M1")).toMatchObject({ status: "open", progress: { have: 0, need: 5 } });
    // Prereq not claimed: hidden.
    expect(byId.has("S2")).toBe(false);
    expect(byId.has("CR1")).toBe(false);
    expect(stored().goals.T1?.done).toBeNumber();
    // The answer's badge counts them.
    expect(answer.body.onboarding).toMatchObject({ goalsReady: 3 });
  });

  test("a legacy save gets the baseline on first read: met goals claimed, no reward", async () => {
    db.row = rowOf({ onboarding: null });
    const answer = await call(actions.state);
    expect(answer.status).toBe(200);
    const record = stored();
    expect(record.goalsBaseline).toBeNumber();
    expect(record.goals.T1?.claimed).toBe("baseline");
    expect(record.goals.CR3?.claimed).toBe("baseline");
    expect(db.row?.resources).toEqual({ r1: 1000, r2: 1000, r3: 1000, r4: 0 });
    expect(answer.body.onboarding).toMatchObject({ goalsReady: 0 });
    // A baseline goal cannot be claimed afterwards.
    const claim = await call(actions.claim, { id: "T1" });
    expect(claim).toMatchObject({ status: 409, body: { reason: "alreadyClaimed" } });
  });

  test("no outpost policy: the wrapper refuses them on an outpost (notInOutpost)", () => {
    expect(actions.state.outposts).toBeUndefined();
    expect(actions.claim.outposts).toBeUndefined();
  });
});

describe("goals/claim", () => {
  test("pays the reward and points once, under the lock; a second claim is refused", async () => {
    const answer = await call(actions.claim, { id: "T1" });
    expect(answer.status).toBe(200);
    expect(answer.body.report).toMatchObject({
      id: "T1",
      credited: { r1: 2000, r2: 2000, r3: 0, r4: 0 },
      overflow: { r1: 0, r2: 0, r3: 0, r4: 0 },
      points: 80,
    });
    expect(db.row?.resources).toMatchObject({ r1: 3000, r2: 3000 });
    expect(db.row?.points).toBe("180");
    expect(stored().goals.T1?.claimed).toBeNumber();

    const again = await call(actions.claim, { id: "T1" });
    expect(again).toMatchObject({ status: 409, body: { reason: "alreadyClaimed" } });
    expect(db.row?.resources).toMatchObject({ r1: 3000, r2: 3000 });
  });

  test("capped at storage: the excess is lost and the report says so (Q2)", async () => {
    db.row = rowOf({ resources: { r1: BASE_STORAGE - 500, r2: BASE_STORAGE, r3: 0, r4: 0 } });
    const answer = await call(actions.claim, { id: "T1" });
    expect(answer.body.report).toMatchObject({
      credited: { r1: 500, r2: 0 },
      overflow: { r1: 1500, r2: 2000 },
    });
    expect(db.row?.resources).toMatchObject({ r1: BASE_STORAGE, r2: BASE_STORAGE });
  });

  test("refusals: unknown, not met, hidden; nothing written", async () => {
    const before = structuredClone(db.row);
    expect(await call(actions.claim, { id: "NOPE" })).toMatchObject({
      status: 400,
      body: { reason: "unknownGoal" },
    });
    expect(await call(actions.claim, { id: "T2" })).toMatchObject({ status: 409, body: { reason: "notMet" } });
    expect(await call(actions.claim, { id: "CR1" })).toMatchObject({
      status: 409,
      body: { reason: "goalHidden" },
    });
    expect(db.row).toEqual(before);
  });

  test("a claimed prereq opens the next goal", async () => {
    db.row = rowOf({
      buildingdata: { ...(rowOf().buildingdata as Row), "3": { id: 3, t: 6, X: 0, Y: 300, l: 2 } },
    });
    expect(await call(actions.claim, { id: "S2" })).toMatchObject({ body: { reason: "goalHidden" } });
    expect((await call(actions.claim, { id: "S1" })).status).toBe(200);
    expect((await call(actions.claim, { id: "S2" })).status).toBe(200);
  });

  test("monster rewards house every monster, or wait for room (Q10)", async () => {
    const unlocked = {
      lockerdata: { C2: { t: 2 } },
      onboarding: {
        v: 1,
        guide: { state: "done" },
        goals: { CR1: { claimed: 1 } },
      },
    };
    db.row = rowOf({ ...unlocked, monsters: { housed: { C1: 100_000 } } });
    const refused = await call(actions.claim, { id: "UC2" });
    expect(refused).toMatchObject({ status: 409, body: { reason: "housing", monster: "C2", count: 10 } });

    db.row = rowOf(unlocked);
    const answer = await call(actions.claim, { id: "UC2" });
    expect(answer.status).toBe(200);
    expect(answer.body.report).toMatchObject({ monsters: { id: "C2", count: 10 }, points: 100 });
    expect((db.row?.monsters as { housed: Record<string, number> }).housed.C2).toBe(10);
  });

  test("the badge drops as goals are claimed", async () => {
    await call(actions.claim, { id: "T1" });
    const answer = await call(actions.claim, { id: "CR3" });
    expect(answer.body.onboarding).toMatchObject({ goalsReady: 1 });
  });
});

describe("goals/baiter-start and goals/baiter-run (N1)", () => {
  const withBaiter = () =>
    rowOf({
      buildingdata: { ...(rowOf().buildingdata as Row), "5": { id: 5, t: 19, X: 300, Y: 300, l: 1 } },
    });

  /** Starts a run and moves its ticket `seconds` into the past. */
  const start = async (seconds: number): Promise<string> => {
    const answer = await call(actions.baiterStart);
    expect(answer.status).toBe(200);
    const token = (answer.body.report as { token: string }).token;
    const ticket = tokens.tickets.get(2505)!;
    tokens.tickets.set(2505, { ...ticket, at: ticket.at - seconds });
    return token;
  };

  beforeEach(() => {
    db.row = withBaiter();
  });

  test("a run from an issued token, long enough, counts once", async () => {
    const token = await start(30);
    const answer = await call(actions.baiterRun, { token });
    expect(answer).toMatchObject({ status: 200, body: { report: { baiterRuns: 1 } } });
    expect(stored().counters.baiterRuns).toBe(1);
    // Spent: the same token again counts nothing.
    expect(await call(actions.baiterRun, { token })).toMatchObject({ status: 409, body: { reason: "noRun" } });
    expect(stored().counters.baiterRuns).toBe(1);
  });

  test("an invented token, or none issued, counts nothing", async () => {
    expect(await call(actions.baiterRun, { token: "made-up" })).toMatchObject({ body: { reason: "noRun" } });
    await start(30);
    expect(await call(actions.baiterRun, { token: "made-up" })).toMatchObject({ body: { reason: "noRun" } });
    expect(stored().counters.baiterRuns).toBe(0);
  });

  test("a run that ends straight away counts nothing", async () => {
    const token = await start(1);
    expect(await call(actions.baiterRun, { token })).toMatchObject({ body: { reason: "tooSoon" } });
    expect(stored().counters.baiterRuns).toBe(0);
  });

  test("no finished Baiter: no token, and no count", async () => {
    db.row = rowOf();
    expect(await call(actions.baiterStart)).toMatchObject({ status: 409, body: { reason: "noBaiter" } });
    db.row = rowOf({
      buildingdata: { ...(rowOf().buildingdata as Row), "5": { id: 5, t: 19, X: 300, Y: 300, l: 1, cB: 60 } },
    });
    expect(await call(actions.baiterStart)).toMatchObject({ body: { reason: "noBaiter" } });
  });
});
