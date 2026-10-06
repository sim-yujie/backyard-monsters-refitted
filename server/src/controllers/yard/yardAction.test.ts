import { beforeEach, describe, expect, test } from "bun:test";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import z from "zod";
import type { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { COSTS } from "../../game-data/buildingCosts.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { BuildingIdField } from "../../schemas/YardSchemas.js";
import { yardRefusedErr } from "../../services/yard/yardErrors.js";
import { updateOnboarding } from "../../services/onboarding/state.js";
import { calculateBaseLevel } from "../../services/base/calculateBaseLevel.js";
import { yardStateAction } from "./state.js";
import {
  applyOutcome,
  catchUpLockedYard,
  defineYardAction,
  runYardAction,
  type YardAction,
  type YardAnswer,
} from "./yardAction.js";

/**
 * The wrapper end to end, with the database replaced by one in-memory row.
 *
 * `runYardAction` takes its entity manager as an argument, so the stand-in is
 * passed straight in and no module has to be mocked. Its `transactional`
 * behaves like Postgres where it matters here: a read with
 * `PESSIMISTIC_WRITE` waits for the previous holder of the row to commit or
 * roll back, reads the committed row, and writes land only on commit.
 */

type Row = Record<string, unknown>;

const db = {
  row: null as Row | null,
  reads: 0,
  readOptions: [] as unknown[],
  /** Awaited after a locked read, while the lock is held. */
  afterLockedRead: null as (() => Promise<void>) | null,
  /** Makes the next commit fail after the callback returned (a lost connection, say). */
  failCommit: false,
  tail: Promise.resolve() as Promise<void>,
};

/** Takes the row lock; resolves with its release once every earlier holder let go. */
const acquire = (): Promise<() => void> => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const previous = db.tail;
  db.tail = previous.then(() => held);
  return previous.then(() => release);
};

const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    let entity: Row | null = null;
    let pending: Row | null = null;

    const fork = {
      async findOne(_entity: unknown, _where: unknown, options?: { lockMode?: LockMode }) {
        db.readOptions.push(options);
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) release = await acquire();
        db.reads++;
        entity = db.row && structuredClone(db.row);
        if (release && db.afterLockedRead) {
          const hook = db.afterLockedRead;
          db.afterLockedRead = null;
          await hook();
        }
        return entity;
      },
      async flush() {
        if (entity) pending = structuredClone(entity);
      },
    };

    try {
      const result = await cb(fork);
      await fork.flush();
      if (db.failCommit) throw new Error("commit failed");
      if (pending) db.row = pending;
      return result;
    } finally {
      release?.();
    }
  },
};



const BASESAVEID = 7;

const userOf = (overrides: Partial<User> = {}): User =>
  ({
    userid: 2503,
    shiny_locked: false,
    save: { basesaveid: BASESAVEID },
    ...overrides,
  }) as unknown as User;

/** A main yard saved 1000 s ago with a Cannon Tower upgrade 100 s from done. */
const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: BASESAVEID,
  userid: 2503,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime() - 1000,
  credits: 100,
  points: "0",
  flinger: 0,
  catapult: 0,
  resources: { r1: 5000, r2: 5000, r3: 5000, r4: 5000 },
  buildingdata: {
    "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 },
    "1": { id: 1, t: 20, X: 100, Y: 100, l: 1, cU: 100 },
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

/** Runs an action as the route would and hands back the answer. */
const call = (
  action: YardAction<z.ZodType, unknown>,
  body: unknown = {},
  user: User = userOf()
): Promise<YardAnswer> => runYardAction(em as unknown as EntityManager, user, action, body);

const state = yardStateAction;

beforeEach(() => {
  db.row = rowOf();
  db.reads = 0;
  db.readOptions = [];
  db.afterLockedRead = null;
  db.failCommit = false;
  db.tail = Promise.resolve();
});

describe("POST /bm/yard/state", () => {
  test("catches the yard up, writes it, and answers with the frozen payload", async () => {
    const ctx = await call(state);

    expect(ctx.status).toBe(200);
    expect(Object.keys(ctx.body!)).toEqual([
      "error",
      "savetime",
      "currenttime",
      "resources",
      "credits",
      "caps",
      "workers",
      "protected",
      "buildingdata",
      "buildinghealthdata",
      "storedata",
      "monsters",
      "lockerdata",
      "academy",
      "champion",
      "mushrooms",
      "researchdata",
      "onboarding",
      "completed",
      "report",
      "playerlevel",
    ]);
    expect(ctx.body).toMatchObject({
      error: 0,
      report: null,
      workers: { total: 1, busy: 0 },
      completed: [{ kind: "upgrade", id: 1, t: 20, detail: { from: 1, level: 2, points: 6966 } }],
      // Level 7 (15,000 to 19,999): the 6,966 points this answer's catch-up
      // awarded (#192) plus the yard's worth after it, 11,930 (#209).
      playerlevel: 7,
    });
    expect(ctx.body!.savetime).toBe(ctx.body!.currenttime);

    // Written: level, points, base value and savetime all landed on the row.
    expect(db.row).toMatchObject({ points: "6966", basevalue: "11930", savetime: ctx.body!.savetime });
    expect((db.row!.buildingdata as Record<string, Row>)["1"]).toMatchObject({ l: 2 });
  });

  test("reads the row with a pessimistic write lock, refreshed", async () => {
    await call(state);

    expect(db.readOptions).toEqual([{ lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }]);
  });

  test("two concurrent calls run one after the other: one savetime, points once", async () => {
    let releaseFirst!: () => void;
    const firstHolds = new Promise<void>((resolve) => (releaseFirst = resolve));
    db.afterLockedRead = () => firstHolds;

    const first = call(state);
    const second = call(state);

    // The first holds the lock; the second has not been allowed to read.
    await Bun.sleep(5);
    expect(db.reads).toBe(1);

    releaseFirst();
    const [a, b] = await Promise.all([first, second]);

    expect(db.reads).toBe(2);
    expect((a.body!.completed as unknown[]).length).toBe(1);
    // The second read what the first committed, so it finished nothing again.
    expect(b.body!.completed).toEqual([]);
    expect(db.row!.points).toBe("6966");
    expect(db.row!.savetime).toBe(b.body!.savetime);
    expect(b.body!.savetime as number).toBeGreaterThanOrEqual(a.body!.savetime as number);
  });
});

describe("catchUpLockedYard (the owner's build-mode /base/load)", () => {
  const catchUp = () =>
    catchUpLockedYard(em as unknown as EntityManager, { basesaveid: BASESAVEID } as Save);

  test("writes the catch-up and hands back what finished, for the away notice (#135)", async () => {
    const { save, completed } = await catchUp();

    expect(completed).toMatchObject([
      { kind: "upgrade", id: 1, t: 20, detail: { from: 1, level: 2, points: 6966 } },
    ]);
    expect(db.readOptions).toEqual([{ lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }]);
    expect(db.row).toMatchObject({ points: "6966", savetime: save.savetime });
    expect((db.row!.buildingdata as Record<string, Row>)["1"]).toMatchObject({ l: 2 });
  });

  test("heals a base value nothing wrote, from the yard as the catch-up left it (#209)", async () => {
    db.row = rowOf({ basevalue: "0" });

    await catchUp();

    expect(db.row!.basevalue).toBe("11930");
  });

  test("a second load finds nothing new", async () => {
    await catchUp();

    expect((await catchUp()).completed).toEqual([]);
  });

  test("a yard under attack is left alone: nothing written, nothing completed", async () => {
    db.row = rowOf({ attackid: 42, attacks: [{ starttime: getCurrentDateTime() - 30 }] });
    const before = structuredClone(db.row);

    const { completed } = await catchUp();

    expect(completed).toEqual([]);
    expect(db.row).toEqual(before);
  });

  // The load's raid session count (`countRaidSession`, #226), stood in for
  // here: this file loads no Redis.
  const countSession = (locked: Save, now: number) => {
    locked.aiattacks = { counted: now };
  };

  test("more to write on the row rides on the same lock and the same write", async () => {
    const { save } = await catchUpLockedYard(em as unknown as EntityManager, { basesaveid: BASESAVEID } as Save, countSession);

    expect(db.readOptions).toEqual([{ lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }]);
    expect(db.row).toMatchObject({ points: "6966", aiattacks: { counted: save.savetime } });
  });

  test("under attack, that is still written, and nothing else", async () => {
    db.row = rowOf({ attackid: 42, attacks: [{ starttime: getCurrentDateTime() - 30 }] });
    const before = structuredClone(db.row);

    const { completed } = await catchUpLockedYard(em as unknown as EntityManager, { basesaveid: BASESAVEID } as Save, countSession);

    expect(completed).toEqual([]);
    expect(db.row).toEqual({ ...before, aiattacks: { counted: expect.any(Number) } });
  });
});

describe("runYardAction refusals", () => {
  test("a caller with no save yet is refused notMainYard", async () => {
    const ctx = await call(state, {}, userOf({ save: null }));

    expect(ctx.status).toBe(409);
    expect(ctx.body).toMatchObject({ reason: "notMainYard" });
    expect(typeof ctx.body!.error).toBe("string");
  });

  test("a save that is not a main yard is refused notMainYard, and nothing is written", async () => {
    db.row = rowOf({ type: "outpost" });
    const before = structuredClone(db.row);

    const ctx = await call(state);

    expect(ctx.status).toBe(409);
    expect(ctx.body!.reason).toBe("notMainYard");
    expect(db.row).toEqual(before);
  });

  test("somebody else's save is refused notMainYard", async () => {
    db.row = rowOf({ userid: 1 });

    expect((await call(state)).body!.reason).toBe("notMainYard");
  });

  test("a yard under attack is refused underAttack, and nothing is written", async () => {
    db.row = rowOf({ attackid: 42, attacks: [{ starttime: getCurrentDateTime() - 30 }] });
    const before = structuredClone(db.row);

    const ctx = await call(state);

    expect(ctx.status).toBe(409);
    expect(ctx.body!.reason).toBe("underAttack");
    expect(db.row).toEqual(before);
  });

  test("a yard a wild monster raid is being fought on is refused raidInProgress, and nothing is written", async () => {
    db.row = rowOf({ aiattacks: { v: 2, fight: { id: "r_one", until: getCurrentDateTime() + 60 } } });
    const before = structuredClone(db.row);

    const ctx = await call(state);

    expect(ctx.status).toBe(409);
    expect(ctx.body!.reason).toBe("raidInProgress");
    // The sentence the web yard shows the player (#309).
    expect(ctx.body!.error).toBe("Wild monsters are raiding your yard right now. Try again when the raid is over.");
    expect(db.row).toEqual(before);
  });

  test("a raid lock past its end does not block", async () => {
    db.row = rowOf({ aiattacks: { v: 2, fight: { id: "r_one", until: getCurrentDateTime() - 1 } } });

    expect((await call(state)).status).toBe(200);
  });

  test("a stale attackid (attack long over) does not block", async () => {
    db.row = rowOf({ attackid: 42, attacks: [{ starttime: getCurrentDateTime() - 3600 }] });

    expect((await call(state)).status).toBe(200);
  });

  test("a malformed body is a 400 badRequest naming the field", async () => {
    const route = (
      defineYardAction({
        schema: z.object({ id: BuildingIdField }),
        run: () => ({ report: null }),
      })
    );

    const ctx = await call(route, { id: "abc" });

    expect(ctx.status).toBe(400);
    expect(ctx.body).toMatchObject({ reason: "badRequest", issues: [{ path: "id" }] });
    expect(db.reads).toBe(0);
  });

  test("a ClientSafeError from the action answers flat, and rolls the catch-up back", async () => {
    const before = structuredClone(db.row);
    const route = (
      defineYardAction({
        schema: z.object({}),
        run: () => {
          throw yardRefusedErr("busy", "That building is busy.", { id: 1 });
        },
      })
    );

    const ctx = await call(route);

    expect(ctx.status).toBe(409);
    expect(ctx.body).toEqual({ error: "That building is busy.", reason: "busy", id: 1 });
    expect(db.row).toEqual(before);
  });

  test("any other error is left to the global interceptor", async () => {
    const route = (
      defineYardAction({
        schema: z.object({}),
        run: () => {
          throw new Error("boom");
        },
      })
    );

    await expect(call(route)).rejects.toThrow("boom");
  });

  test("the action sees the caught-up save, the parsed body and the completed list", async () => {
    let seen: unknown;
    const route = (
      defineYardAction({
        schema: z.object({ id: BuildingIdField }),
        run: ({ save, body, completed, now }) => {
          seen = {
            level: save.buildingdata!["1"]!.l,
            id: body.id,
            completed: completed.length,
            savetime: save.savetime === now,
          };
          return { report: { ok: true } };
        },
      })
    );

    const ctx = await call(route, { id: "1" });

    expect(seen).toEqual({ level: 2, id: 1, completed: 1, savetime: true });
    expect(ctx.body!.report).toEqual({ ok: true });
  });

  test("an onboarding slice is written, the answer carries its summary, and run gets the transaction", async () => {
    db.row = rowOf({ onboarding: { v: 1, guide: { state: "active", step: "raid" }, tips: { mail: 5 } } });
    let gotEm = false;
    const route = defineYardAction({
      schema: z.object({}),
      run: ({ save, em: tx }) => {
        gotEm = typeof (tx as unknown as { flush?: unknown }).flush === "function";
        return {
          report: null,
          slices: {
            onboarding: updateOnboarding(save, (onboarding) => {
              onboarding.raidSeen = 123;
              onboarding.guide.step = "build-housing";
            }),
          },
        };
      },
    });

    const ctx = await call(route);

    expect(gotEm).toBe(true);
    expect(db.row!.onboarding).toMatchObject({ raidSeen: 123, guide: { state: "active", step: "build-housing" }, tips: { mail: 5 } });
    expect(ctx.body!.onboarding).toEqual({
      guide: { state: "active", step: "build-housing" },
      camp: "none",
      // The count is the Goals package's (`services/goals/goalRules.ts`); this row meets several.
      goalsReady: expect.any(Number),
      tips: { mail: 5 },
    });
  });

  test("a save with no onboarding answers as legacy", async () => {
    const ctx = await call(state);

    expect(ctx.body!.onboarding).toEqual({ guide: { state: "legacy" }, camp: "none", goalsReady: 0, tips: {} });
  });
});

describe("applyOutcome", () => {
  const saveOf = (overrides: Row = {}) => rowOf(overrides) as unknown as Save;

  test("debits, adds points and replaces slices", () => {
    const save = saveOf();
    applyOutcome(save, userOf(), {
      report: null,
      debit: { r1: 1000, r2: 500 },
      points: 12,
      slices: { lockerdata: { C2: { t: 1 } } },
    });

    expect(save.resources).toEqual({ r1: 4000, r2: 4500, r3: 5000, r4: 5000 });
    expect(save.points).toBe("12");
    expect(save.lockerdata).toEqual({ C2: { t: 1 } });
  });

  test("a credit is clamped to the storage cap; a pool already over it is not reduced", () => {
    // No silos, no outposts: the cap is the base 10,000.
    const save = saveOf({ resources: { r1: 9000, r2: 20000, r3: 0, r4: 0 } });
    applyOutcome(save, userOf(), { report: null, credit: { r1: 5000, r2: 5000, r3: 300 } });

    expect(save.resources).toEqual({ r1: 10000, r2: 20000, r3: 300, r4: 0 });
  });

  test("a debit the yard cannot cover is refused shortfall, before anything changes", () => {
    const save = saveOf();
    const before = structuredClone(save);

    expect(() =>
      applyOutcome(save, userOf(), {
        report: null,
        debit: { r1: 6000 },
        slices: { lockerdata: { C2: { t: 1 } } },
      })
    ).toThrow(expect.objectContaining({ status: 409, data: { reason: "shortfall", shortfall: { r1: 1000, r2: 0, r3: 0, r4: 0 } } }));
    expect(save).toEqual(before);
  });

  test("Shiny is taken; a locked account is refused shinyLocked; a short one credits", () => {
    const save = saveOf();
    applyOutcome(save, userOf(), { report: null, shiny: 40 });
    expect(save.credits).toBe(60);

    expect(() =>
      applyOutcome(save, userOf({ shiny_locked: true }), { report: null, shiny: 1 })
    ).toThrow(expect.objectContaining({ data: { reason: "shinyLocked" } }));

    expect(() => applyOutcome(save, userOf(), { report: null, shiny: 61 })).toThrow(
      expect.objectContaining({ data: { reason: "credits", credits: { have: 60, need: 61 } } })
    );
    expect(save.credits).toBe(60);
  });

  test("re-derives flinger and catapult after the slices land", () => {
    const save = saveOf();
    applyOutcome(save, userOf(), {
      report: null,
      slices: { buildingdata: { "9": { id: 9, t: 5, x: 0, y: 0, l: 4 } } },
    });

    expect(save.flinger).toBe(4);
  });
});

/**
 * `basevalue` (#209): a tenth of the time and resources of every finished
 * building's current step (`client/scripts/BASE.as:4830-4861`), kept as a
 * high-water mark on the main yard.
 */
describe("basevalue (#209)", () => {
  /** `time + r1 + r2 + r3 + r4` of `type`'s step that left `level - 1`. */
  const worth = (type: number, level: number): number => {
    const [r1, r2, r3, r4, time] = COSTS[type]!.costs[level - 1]!;
    return time + r1 + r2 + r3 + r4;
  };

  /** Replaces the yard's buildings with whatever `buildingdata` it is handed. */
  const rebuild = defineYardAction({
    schema: z.object({}).passthrough(),
    run: ({ body }) => ({ report: null, slices: { buildingdata: body.buildingdata as Save["buildingdata"] } }),
  });

  test("the fixture's yard is worth what Flash's sum says: Town Hall 3 and Cannon Tower 2", async () => {
    await call(state);

    // 42,000 + 42,000 + 14,400 s for the hall, 10,000 + 7,500 + 2,500 + 900 s for the tower.
    expect(worth(14, 3) + worth(20, 2)).toBe(119300);
    expect(db.row!.basevalue).toBe(String(Math.ceil(0.1 * 119300)));
  });

  test("a building the action changes counts in the same answer's level", async () => {
    const buildingdata = {
      "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 },
      "1": { id: 1, t: 20, X: 100, Y: 100, l: 3 },
    };

    const answer = await call(rebuild as YardAction<z.ZodType, unknown>, { buildingdata });

    const value = Math.ceil(0.1 * (worth(14, 3) + worth(20, 3)));
    expect(db.row!.basevalue).toBe(String(value));
    // 6,966 points from the catch-up's upgrade, plus the value.
    expect(answer.body.playerlevel).toBe(calculateBaseLevel("6966", String(value)));
  });

  test("never lowered: removing a building keeps the high-water mark", async () => {
    await call(state);
    expect(db.row!.basevalue).toBe("11930");

    await call(rebuild as YardAction<z.ZodType, unknown>, {
      buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 } },
    });

    expect(db.row!.basevalue).toBe("11930");
  });

  test("a stored value above the yard's worth is kept as it is", async () => {
    db.row = rowOf({ basevalue: "500000" });

    await call(state);

    expect(db.row!.basevalue).toBe("500000");
  });

  test("a refused action writes no base value either", async () => {
    db.row = rowOf({ basevalue: "0" });
    const refuse = defineYardAction({
      schema: z.object({}),
      run: () => {
        throw yardRefusedErr("nope", "No.");
      },
    });

    expect((await call(refuse as YardAction<z.ZodType, unknown>)).status).toBe(409);
    expect(db.row!.basevalue).toBe("0");
  });
});

/**
 * The chat display name push (issue #232): `runYardAction` reports the
 * account's level after every write, successful or not touching level at
 * all, and leaves it to `notifyLevelChange` to decide whether that is new
 * (`chatIdentity.test.ts`) — it never tracks a before/after itself.
 */
describe("chat display name on level change (#232)", () => {
  type Call = [userId: number, username: string, level: number];
  let calls: Call[];

  beforeEach(async () => {
    calls = [];
    const { onLevelChange } = await import("../../chat/levelChangeBus.js");
    onLevelChange((userId, username, level) => calls.push([userId, username, level]));
  });

  test("reports the account's level once, after the write", async () => {
    const answer = await call(state, {}, userOf({ username: "agenttester" }));

    expect(answer.body.playerlevel).toBe(7);
    expect(calls).toEqual([[2503, "agenttester", 7]]);
  });

  test("reports it only once the write has committed", async () => {
    const before = db.row!.savetime;
    let rowAtReport: unknown;
    const { onLevelChange } = await import("../../chat/levelChangeBus.js");
    onLevelChange(() => (rowAtReport = db.row!.savetime));

    await call(state, {}, userOf({ username: "agenttester" }));

    expect(rowAtReport).not.toBe(before);
    expect(rowAtReport).toBe(db.row!.savetime);
  });

  test("a commit that fails reports nothing", async () => {
    db.failCommit = true;

    await expect(call(state, {}, userOf({ username: "agenttester" }))).rejects.toThrow(
      "commit failed"
    );
    expect(calls).toEqual([]);
  });

  // The outpost case (the level reported is always the main yard's, not the
  // outpost's) is covered in `yardAction.outpost.test.ts`, whose fixture
  // actually has two distinct rows.

  test("still reports it when the level does not move, as plain duplicates", async () => {
    await call(state, {}, userOf({ username: "agenttester" }));
    await call(state, {}, userOf({ username: "agenttester" }));

    // The second catch-up has nothing left to award, so the level is the
    // same both times; `runYardAction` reports it either way; it is
    // `notifyLevelChange`'s job (not this wrapper's) to drop the repeat.
    expect(calls).toEqual([
      [2503, "agenttester", 7],
      [2503, "agenttester", 7],
    ]);
  });
});
