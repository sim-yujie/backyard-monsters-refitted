import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import { experiencePoints } from "../../game-data/stats/experiencePoints.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * A wild monster raid end to end on the server (#226 WP3,
 * `docs/design/wild-raids.md` §4.2): the presence ping opens the warning,
 * "Prepare defences" and "Engage now", the fight run once at the start with
 * the yard locked, and the finish that lands it once — or cancels it when
 * the game was closed. Then the frequency choice.
 *
 * The database is one in-memory row behind a stand-in entity manager whose
 * locked reads queue as Postgres's do (as `yardAction.test.ts`'s); Redis is
 * the in-memory one. The fight runs in the real replay worker.
 */

const strings = new Map<string, string>();
const redis = memoryRedis(strings);

mock.module("../../server.js", () => ({
  postgres: { em: {} },
  redis,
}));

// The real replay runner, with stand-ins a test can put in for the slot and
// the fight (as `autoAttack.test.ts` does).
const REAL_RUNNER = "../base/combat/replayRunner.ts?real";
const runner = (await import(REAL_RUNNER)) as typeof import("../base/combat/replayRunner.js");
const standIn = {
  slot: null as null | (() => Promise<(() => void) | null>),
  fight: null as null | ((input: unknown) => Promise<never>),
};
mock.module("../base/combat/replayRunner.js", () => ({
  ...runner,
  reserveReplaySlot: (...args: Parameters<typeof runner.reserveReplaySlot>) =>
    standIn.slot ? standIn.slot() : runner.reserveReplaySlot(...args),
  fightRaidInWorker: (...args: Parameters<typeof runner.fightRaidInWorker>) =>
    standIn.fight ? standIn.fight(args[0]) : runner.fightRaidInWorker(...args),
}));

const { START_LOCK_SECONDS, engageRaid, finishRaid, prepareRaid, raidOnPing, setRaidPreference, startRaid } = await import(
  "./raidFlow.js"
);
const { fightRaid } = await import("./raidFight.js");
const { raidFighting } = await import("./raidLock.js");
const { RAID_PREFERENCES, countRaidSession, readSchedule } = await import("./raidSchedule.js");
const { planRaid } = await import("./raidPlan.js");
const { WARNING_SECONDS, readOpenRaid, recordRaidScreen, updateOpenRaid } = await import("./raidStore.js");
const { challengeKey, lastActionKey, lastSeenKey } = await import("../user/online.js");
const { damagedBuildings } = await import("../yard/repair.js");

type Row = Record<string, unknown>;

const db = {
  row: null as Row | null,
  tail: Promise.resolve() as Promise<void>,
  /** Unlocked reads of the whole row (no `fields`), and locked reads. */
  fullReads: 0,
  locks: 0,
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
  async findOne(_entity: unknown, _where: unknown, options?: { fields?: unknown }) {
    if (!options?.fields) db.fullReads++;
    return db.row && structuredClone(db.row);
  },
  // The bell's notices for what a catch-up finished: not under test here.
  insertMany: async () => [],
  nativeDelete: async () => 0,
  getConnection: () => ({ execute: async () => [] }),
  count: async () => 0,
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    let entity: Row | null = null;
    let pending: Row | null = null;
    const fork = {
      async findOne(_entity: unknown, _where: unknown, options?: { lockMode?: LockMode }) {
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE && !release) {
          db.locks++;
          release = await acquire();
        }
        entity = db.row && structuredClone(db.row);
        return entity;
      },
      async flush() {
        if (entity) pending = structuredClone(entity);
      },
      transactional: (inner: (fork: unknown) => Promise<unknown>) => inner(fork),
    };
    try {
      const result = await cb(fork);
      if (pending) db.row = pending;
      return result;
    } finally {
      release?.();
    }
  },
} as unknown as EntityManager;

const USER = 2505;
const BASESAVEID = 7;
const NOW = 1_900_000_000;
const DAY = 24 * 60 * 60;
const YARD = { where: "yard", planner: false } as const;
const user = { userid: USER, save: { basesaveid: BASESAVEID } } as unknown as User;

const SANDBOX = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url)), "utf8")
) as { buildingdata: Row; resources: Row };

/** A small yard with nothing to defend it: a Town Hall, four harvesters holding their fill, a silo. */
const OPEN_YARD: Row = {
  "0": { id: 0, t: 14, X: 0, Y: 0, l: 1 },
  "1": { id: 1, t: 1, X: 120, Y: 0, l: 1, st: 400 },
  "2": { id: 2, t: 2, X: -120, Y: 0, l: 1, st: 400 },
  "3": { id: 3, t: 3, X: 0, Y: 120, l: 1, st: 400 },
  "4": { id: 4, t: 4, X: 0, Y: -120, l: 1, st: 400 },
  "5": { id: 5, t: 6, X: 120, Y: 120, l: 1 },
};

/** A level 9 main yard whose raid is due: 4 sessions, its time come, nothing damaged. */
const rowOf = (extra: Row = {}): Row => ({
  basesaveid: BASESAVEID,
  userid: USER,
  type: "main",
  mapversion: 2,
  mr2upgraded: true,
  wmid: 0,
  points: String(experiencePoints[8]),
  basevalue: "0",
  attackid: 0,
  attacks: [],
  protected: 0,
  savetime: NOW,
  credits: 100,
  damage: 0,
  aiattacks: { v: 2, lastattack: NOW - 3 * DAY, nextAttack: NOW - 10, sessionsSinceLastAttack: 4, attackPreference: 0, recent: [] },
  buildingdata: structuredClone(SANDBOX.buildingdata),
  buildinghealthdata: {},
  resources: { r1: 100_000, r2: 100_000, r3: 100_000, r4: 100_000 },
  firedtraps: [],
  storedata: {},
  monsters: {},
  lockerdata: {},
  academy: {},
  champion: [],
  mushrooms: {},
  researchdata: {},
  outposts: [],
  ...extra,
});

const at = (seconds: number) => setSystemTime(new Date(seconds * 1000));

/** The game open on the yard with the Planner closed, as the ping and the real-action tracker leave it. */
const present = async (now: number) => {
  await redis.set(lastSeenKey(USER), String(now));
  await redis.set(lastActionKey(USER), String(now));
  await recordRaidScreen(USER, YARD);
};

/** The reason a raid call was refused with. */
const refusal = async (call: Promise<unknown>): Promise<Record<string, unknown>> => {
  try {
    await call;
  } catch (err) {
    return (err as { data: Record<string, unknown> }).data;
  }
  throw new Error("the call was not refused");
};

/** Raid seeds whose fights are known: Abunakki holds the sandbox to 99.6%, Kozu flattens the open yard. */
const SANDBOX_HOLDS = 3;
const OPEN_YARD_FALLS = 2;

/**
 * Ping, "Engage now", start: the raid in its fight. The warning's random
 * plan is swapped for the plan of a fixed seed, so the fight is the same on
 * every run.
 */
const toStart = async (seed = SANDBOX_HOLDS) => {
  await present(NOW);
  const warning = (await raidOnPing(em, user, YARD, NOW))!;
  const open = (await readOpenRaid(USER))!;
  const plan = planRaid({
    buildingdata: db.row!.buildingdata as never,
    resources: db.row!.resources as never,
    level: 9,
    preference: 0,
    seed,
  })!;
  await updateOpenRaid(USER, { ...open, plan, seed, tribe: plan.tribe }, NOW);
  await engageRaid(USER, warning.id, NOW);
  return warning.id;
};

const toFight = async (seed = SANDBOX_HOLDS) => {
  const id = await toStart(seed);
  const start = await startRaid(em, user, id, NOW);
  return { id, start, finishFrom: start.raid.finishFrom! };
};

/** Resolves once `check` holds, looking every millisecond. */
const until = async (check: () => boolean) => {
  for (let tries = 0; !check(); tries++) {
    if (tries > 5_000) throw new Error("never happened");
    await Bun.sleep(1);
  }
};

/** The yard's fight lock as stored. */
const fightLock = () => readSchedule(db.row!.aiattacks).fight;

/** The finish, on time and with the game still open. */
const finishOnTime = async (id: string, finishFrom: number) => {
  at(finishFrom);
  await present(finishFrom);
  return finishRaid(em, user, id, finishFrom);
};

beforeEach(() => {
  redis.clear();
  db.row = rowOf();
  db.fullReads = 0;
  db.locks = 0;
  standIn.slot = null;
  standIn.fight = null;
  at(NOW);
});

afterEach(() => setSystemTime());

const FIGHT_TIMEOUT_MS = 60_000;

describe("the warning", () => {
  test("a ping that is not 'yard, Planner closed' opens nothing", async () => {
    await present(NOW);
    expect(await raidOnPing(em, user, null, NOW)).toBeUndefined();
    expect(await raidOnPing(em, user, { where: "yard", planner: true }, NOW)).toBeUndefined();
    expect(await raidOnPing(em, user, { where: "other", planner: false }, NOW)).toBeUndefined();
    expect(await readOpenRaid(USER)).toBeNull();
  });

  test("a raid not due yet opens nothing", async () => {
    db.row = rowOf({ aiattacks: { v: 2, lastattack: NOW - DAY, nextAttack: NOW + 100, sessionsSinceLastAttack: 4, attackPreference: 0, recent: [] } });
    await present(NOW);
    expect(await raidOnPing(em, user, YARD, NOW)).toBeUndefined();
  });

  test("a player who is not online gets no raid", async () => {
    await recordRaidScreen(USER, YARD);
    expect(await raidOnPing(em, user, YARD, NOW)).toBeUndefined();
  });

  /** The ping read the yard whole or caught it up. */
  const touchedYard = () => db.fullReads + db.locks > 0;

  test("an idle player (no real action in 10 minutes) is not raided, and the yard is not read whole or caught up", async () => {
    await present(NOW);
    await redis.set(lastActionKey(USER), String(NOW - 11 * 60));
    const before = structuredClone(db.row);

    expect(await raidOnPing(em, user, YARD, NOW)).toBeUndefined();
    expect(touchedYard()).toBe(false);
    expect(db.row).toEqual(before);
  });

  test("nor is a player with an in-game check pending", async () => {
    await present(NOW);
    await redis.set(challengeKey(USER), "1");

    expect(await raidOnPing(em, user, YARD, NOW)).toBeUndefined();
    expect(touchedYard()).toBe(false);
  });

  test("nor a yard under attack", async () => {
    db.row = rowOf({ attackid: 42, attacks: [{ starttime: NOW - 30 }] });
    await present(NOW);

    expect(await raidOnPing(em, user, YARD, NOW)).toBeUndefined();
    expect(touchedYard()).toBe(false);
  });

  test("a repair not done yet is left to finish; once it is, the ping catches it up and warns", async () => {
    // A level 1 Silo at 1 of 750 health heals 25 a second: whole after 30 s.
    const repairing = (savetime: number) =>
      rowOf({
        savetime,
        buildingdata: { ...structuredClone(OPEN_YARD), "5": { id: 5, t: 6, X: 120, Y: 120, l: 1, hp: 1, rE: 1 } },
        buildinghealthdata: { "5": 1 },
      });
    await present(NOW);

    db.row = repairing(NOW - 29);
    const before = structuredClone(db.row);
    expect(await raidOnPing(em, user, YARD, NOW)).toBeUndefined();
    expect(db.locks).toBe(0);
    expect(db.row).toEqual(before);

    db.row = repairing(NOW - 30);
    expect(await raidOnPing(em, user, YARD, NOW)).toMatchObject({ phase: "warning" });
    expect(db.locks).toBe(1);
    expect(damagedBuildings(db.row as never)).toEqual([]);
  });

  test("a due player on the yard is warned, and the next ping shows the same raid", async () => {
    await present(NOW);
    const view = (await raidOnPing(em, user, YARD, NOW))!;
    expect(view).toMatchObject({ phase: "warning", attackAt: NOW + WARNING_SECONDS, warned: 0 });
    expect(Object.values(view.monsters).reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
    expect("outcome" in view).toBe(false);
    expect((await raidOnPing(em, user, null, NOW + 30))!.id).toBe(view.id);
  });

  test("'Prepare defences' starts the countdown; the fight is refused until it runs out", async () => {
    await present(NOW);
    const view = (await raidOnPing(em, user, YARD, NOW))!;
    expect(await prepareRaid(USER, view.id, NOW)).toMatchObject({ warned: 1, attackAt: NOW + WARNING_SECONDS });
    expect(await refusal(startRaid(em, user, view.id, NOW + 10))).toEqual({ reason: "notYet", attackAt: NOW + WARNING_SECONDS });
  });

  test("'Engage now' makes it due now; a wrong id or none is refused", async () => {
    await present(NOW);
    const view = (await raidOnPing(em, user, YARD, NOW))!;
    expect((await engageRaid(USER, view.id, NOW + 20)).attackAt).toBe(NOW + 20);
    expect(await refusal(engageRaid(USER, "r_other", NOW))).toEqual({ reason: "noRaid" });
    expect(await refusal(engageRaid(USER, 5, NOW))).toEqual({ reason: "badRequest" });
  });
});

describe("the fight", () => {
  test(
    "is fought once at the start on the yard as it stood, and locks the yard",
    async () => {
      const { id, start } = await toFight();

      expect(start.raid).toMatchObject({ id, phase: "fighting", startedAt: NOW });
      expect(JSON.stringify(start)).not.toContain("digest");
      const open = (await readOpenRaid(USER))!;
      expect(open.phase).toBe("fighting");

      // The client replays what it was handed; the server's outcome is that very fight.
      const fresh = fightRaid({
        buildingdata: start.fight.yard.buildingdata as never,
        buildinghealthdata: start.fight.yard.buildinghealthdata,
        resources: start.fight.yard.resources as never,
        log: { v: 1, seed: start.fight.seed, events: start.fight.events },
        hitLimit: start.fight.hitLimit,
        defence: start.fight.defence,
      });
      expect((open.outcome as { digest: string }).digest).toBe(fresh.digest);
      expect(start.fight.tick).toBe(fresh.ticks);

      expect(raidFighting(db.row!, NOW)).toBe(true);
      expect(readSchedule(db.row!.aiattacks).fight?.id).toBe(id);

      expect(await refusal(startRaid(em, user, id, NOW))).toEqual({ reason: "notWarning" });
    },
    FIGHT_TIMEOUT_MS
  );

  test(
    "runs outside any transaction: the yard's row is free meanwhile, held by a provisional fight lock",
    async () => {
      const id = await toStart();
      let started = false;
      const starting = startRaid(em, user, id, NOW).then((start) => {
        started = true;
        return start;
      });

      // The first transaction has committed: the yard is held, the row is not.
      await until(() => fightLock() !== undefined);
      expect(fightLock()).toEqual({ id, until: NOW + START_LOCK_SECONDS });
      expect(raidFighting(db.row!, NOW)).toBe(true);
      await setRaidPreference(em, user, 1);
      expect(started).toBe(false);

      const start = await starting;
      // The second transaction re-read the row: the preference written meanwhile stands.
      expect(readSchedule(db.row!.aiattacks).attackPreference).toBe(1);
      expect(fightLock()?.until).toBe(NOW + Math.ceil(start.fight.seconds) + 120);
      expect((await readOpenRaid(USER))?.phase).toBe("fighting");
    },
    FIGHT_TIMEOUT_MS
  );

  test(
    "two starts at once: one fight, and the second is refused",
    async () => {
      const id = await toStart();

      const [one, two] = await Promise.allSettled([startRaid(em, user, id, NOW), startRaid(em, user, id, NOW)]);

      const won = [one, two].filter((settled) => settled.status === "fulfilled");
      const lost = [one, two].filter((settled) => settled.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0] as PromiseRejectedResult).reason.data).toEqual({ reason: "notWarning" });
      const open = (await readOpenRaid(USER))!;
      expect(open.phase).toBe("fighting");
      expect(open.fightSeconds).toBe((won[0] as PromiseFulfilledResult<{ fight: { seconds: number } }>).value.fight.seconds);
      expect(fightLock()?.id).toBe(id);
    },
    FIGHT_TIMEOUT_MS
  );

  test(
    "a yard load during the fight lifts its lock: the second transaction finds it gone, and the raid is called off",
    async () => {
      const id = await toStart();
      const starting = startRaid(em, user, id, NOW);

      await until(() => fightLock() !== undefined);
      // The load's session count, under the row lock, as `catchUpOwnerYard` does it.
      await em.transactional(async (tx) => {
        const locked = (await tx.findOne(Object, {}, { lockMode: LockMode.PESSIMISTIC_WRITE })) as never;
        countRaidSession(locked, NOW);
        await tx.flush();
      });

      expect(await refusal(starting)).toEqual({ reason: "noRaid" });
      expect(fightLock()).toBeUndefined();
      expect(raidFighting(db.row!, NOW)).toBe(false);
      expect(await readOpenRaid(USER)).toBeNull();
      // Still due: nothing landed, and the load counted its session.
      expect(readSchedule(db.row!.aiattacks)).toMatchObject({ nextAttack: NOW - 10, sessionsSinceLastAttack: 5, recent: [] });
    },
    FIGHT_TIMEOUT_MS
  );

  test("no replay slot free is busy, before the yard is touched; the raid stays in its warning", async () => {
    const id = await toStart();
    standIn.slot = async () => null;
    db.locks = 0;

    expect(await refusal(startRaid(em, user, id, NOW))).toEqual({ reason: "busy" });
    expect(db.locks).toBe(0);
    expect((await readOpenRaid(USER))?.phase).toBe("warning");
  });

  test("a fight the worker could not finish in time is busy: the yard is unlocked and the slot given back", async () => {
    const id = await toStart();
    let released = 0;
    standIn.slot = async () => () => released++;
    standIn.fight = async () => {
      throw new runner.ReplayTimeoutError(1);
    };

    expect(await refusal(startRaid(em, user, id, NOW))).toEqual({ reason: "busy" });
    expect(fightLock()).toBeUndefined();
    expect(released).toBe(1);
    expect((await readOpenRaid(USER))?.phase).toBe("warning");
  });

  test(
    "a provisional lock that lapsed before the fight came back is busy, and lifted",
    async () => {
      const id = await toStart();
      let fought!: () => void;
      const fightBegan = new Promise<void>((resolve) => (fought = resolve));
      standIn.fight = async (input) => {
        fought();
        // The fight outlasts the lock.
        at(NOW + START_LOCK_SECONDS);
        return runner.fightRaidInWorker(input as never) as never;
      };
      const starting = startRaid(em, user, id, NOW);
      await fightBegan;

      expect(await refusal(starting)).toEqual({ reason: "busy" });
      expect(fightLock()).toBeUndefined();
      expect((await readOpenRaid(USER))?.phase).toBe("warning");
    },
    FIGHT_TIMEOUT_MS
  );
});

describe("the finish", () => {
  test(
    "too early is refused with when it may come, and the raid stays open",
    async () => {
      const { id, finishFrom } = await toFight();
      expect(await refusal(finishRaid(em, user, id, NOW))).toEqual({ reason: "tooEarly", readyAt: finishFrom });
      expect((await readOpenRaid(USER))?.id).toBe(id);
    },
    FIGHT_TIMEOUT_MS
  );

  test(
    "with the game closed during the fight cancels it: nothing lands, the yard is unlocked, the raid still due",
    async () => {
      const { id, finishFrom } = await toFight();
      const before = structuredClone(db.row!);
      at(finishFrom);
      await redis.del(lastSeenKey(USER));

      expect(await refusal(finishRaid(em, user, id, finishFrom))).toEqual({ reason: "cancelled" });

      const schedule = readSchedule(db.row!.aiattacks);
      expect(schedule.fight).toBeUndefined();
      expect(schedule.nextAttack).toBe(NOW - 10);
      expect(schedule.recent).toEqual([]);
      expect(db.row!.resources).toEqual(before.resources);
      expect(db.row!.credits).toBe(100);
      expect(raidFighting(db.row!, finishFrom)).toBe(false);
      expect(await readOpenRaid(USER)).toBeNull();
    },
    FIGHT_TIMEOUT_MS
  );

  test(
    "a good defence lands once: 10 Shiny, the schedule starts again, a second finish applies nothing",
    async () => {
      const { id, finishFrom } = await toFight();
      const result = await finishOnTime(id, finishFrom);

      expect(result).toMatchObject({ id, defended: true, shiny: 10 });
      expect(result.health).toBeGreaterThanOrEqual(0.9);
      expect(db.row!.credits).toBe(110);
      const schedule = readSchedule(db.row!.aiattacks);
      expect(schedule.fight).toBeUndefined();
      expect(schedule).toMatchObject({ lastattack: NOW, nextAttack: NOW + RAID_PREFERENCES[0].waitSeconds, sessionsSinceLastAttack: 0, lastRaidId: id });
      expect(schedule.recent.map((raid) => raid.id)).toEqual([id]);
      expect(await readOpenRaid(USER)).toBeNull();

      const landed = structuredClone(db.row!);
      const again = await finishRaid(em, user, id, finishFrom + 5);
      expect(again).toMatchObject({ id, defended: true, shiny: 10, health: result.health, stolen: result.stolen });
      expect(db.row!.credits).toBe(110);
      expect(db.row!.resources).toEqual(landed.resources);
      expect(readSchedule(db.row!.aiattacks).recent).toHaveLength(1);
    },
    FIGHT_TIMEOUT_MS
  );

  test(
    "a poor defence pays nothing, steals no more than was there, and leaves every damaged building repairing",
    async () => {
      db.row = rowOf({ buildingdata: structuredClone(OPEN_YARD), resources: { r1: 500, r2: 500, r3: 500, r4: 500 } });
      const { id, finishFrom } = await toFight(OPEN_YARD_FALLS);
      const result = await finishOnTime(id, finishFrom);

      expect(result.defended).toBe(false);
      expect(result.shiny).toBe(0);
      expect(db.row!.credits).toBe(100);

      const bank = db.row!.resources as Record<string, number>;
      const buildings = db.row!.buildingdata as Record<string, { st?: number }>;
      for (const key of ["r1", "r2", "r3", "r4"]) expect(bank[key]).toBeGreaterThanOrEqual(0);
      for (const building of Object.values(buildings)) expect(building.st ?? 0).toBeGreaterThanOrEqual(0);
      expect(Object.values(result.stolen).reduce((sum, n) => sum + n, 0)).toBeGreaterThan(0);

      const damaged = damagedBuildings(db.row as never);
      expect(damaged.length).toBeGreaterThan(0);
      expect(damaged.every((damage) => damage.repairing)).toBe(true);
      expect(result.damaged).toEqual(damaged.map((damage) => damage.id));
    },
    FIGHT_TIMEOUT_MS
  );
});

describe("the frequency choice", () => {
  test("sets the preference and times the next raid from the last", async () => {
    expect(await setRaidPreference(em, user, 1)).toEqual({ preference: 1, nextAttack: NOW - 3 * DAY + RAID_PREFERENCES[1].waitSeconds });
    expect(readSchedule(db.row!.aiattacks).attackPreference).toBe(1);
  });
});
