import { beforeEach, describe, expect, test } from "bun:test";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import z from "zod";
import type { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { BuildingIdField } from "../../schemas/YardSchemas.js";
import { yardRefusedErr } from "../../services/yard/yardErrors.js";
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
      "completed",
      "report",
    ]);
    expect(ctx.body).toMatchObject({
      error: 0,
      report: null,
      workers: { total: 1, busy: 0 },
      completed: [{ kind: "upgrade", id: 1, t: 20, detail: { from: 1, level: 2, points: 6966 } }],
    });
    expect(ctx.body!.savetime).toBe(ctx.body!.currenttime);

    // Written: level, points and savetime all landed on the row.
    expect(db.row).toMatchObject({ points: "6966", savetime: ctx.body!.savetime });
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
