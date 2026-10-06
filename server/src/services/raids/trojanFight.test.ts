import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import { TROJAN_HORSE_TYPE } from "../../game-data/buildingFootprints.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * Springing the Trojan Horse end to end (#306 WP3, `docs/design/trojan-horse.md`
 * §5-§7, issue #326): every refusal, two springs at once opening one fight,
 * the fight run for real in the replay worker, and the finish that lands it
 * through the shared `raidFlow.ts` pipeline — no Shiny, the horse gone, the
 * once-per-account flag marked done, the schedule's own rule, a second finish
 * applying nothing, a too-early finish refused, and a cancel keeping the
 * horse for another spring.
 *
 * The harness is `raidFlow.test.ts`'s: an in-memory row behind a stand-in
 * entity manager whose locked reads queue as Postgres's do, and the in-memory
 * Redis. The fight runs in the real replay worker unless a test stands in for
 * it.
 */

const strings = new Map<string, string>();
const redis = memoryRedis(strings);

mock.module("../../server.js", () => ({
  postgres: { em: {} },
  redis,
}));

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

const { springTrojanHorse } = await import("./trojanFight.js");
const { finishRaid, START_LOCK_SECONDS } = await import("./raidFlow.js");
const { raidFighting } = await import("./raidLock.js");
const { readSchedule } = await import("./raidSchedule.js");
const { readOpenRaid, openRaid, newRaidId } = await import("./raidStore.js");
const { lastActionKey, lastSeenKey } = await import("../user/online.js");
const { TROJAN_LAST_SPAWN_TICK, TROJAN_MONSTER_COUNT } = await import("./trojanArmy.js");

type Row = Record<string, unknown>;

const db = {
  row: null as Row | null,
  tail: Promise.resolve() as Promise<void>,
  locks: 0,
};

const acquire = (): Promise<() => void> => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const previous = db.tail;
  db.tail = previous.then(() => held);
  return previous.then(() => release);
};

const em = {
  async findOne(_entity: unknown, _where: unknown, _options?: { fields?: unknown }) {
    return db.row && structuredClone(db.row);
  },
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
const user = { userid: USER, save: { basesaveid: BASESAVEID } } as unknown as User;

const SANDBOX = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url)), "utf8")
) as { buildingdata: Row; resources: Row };

/** The sandbox yard, with the horse placed and eligible to spring. */
const rowOf = (extra: Row = {}, scheduleExtra: Row = {}): Row => ({
  basesaveid: BASESAVEID,
  userid: USER,
  type: "main",
  mapversion: 2,
  mr2upgraded: true,
  wmid: 0,
  points: String(1_000_000),
  basevalue: "0",
  attackid: 0,
  attacks: [],
  protected: 0,
  savetime: NOW,
  credits: 100,
  damage: 0,
  aiattacks: {
    v: 2,
    lastattack: NOW - 3 * DAY,
    nextAttack: NOW - 10,
    sessionsSinceLastAttack: 4,
    attackPreference: 0,
    recent: [],
    trojan: { placedAt: NOW - 1000 },
    ...scheduleExtra,
  },
  buildingdata: {
    ...structuredClone(SANDBOX.buildingdata),
    "900": { id: 900, t: TROJAN_HORSE_TYPE, X: -70, Y: -800 },
  },
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

/** The game open on the yard, as the presence ping and the real-action tracker leave it. */
const present = async (now: number) => {
  await redis.set(lastSeenKey(USER), String(now));
  await redis.set(lastActionKey(USER), String(now));
};

const refusal = async (call: Promise<unknown>): Promise<Record<string, unknown>> => {
  try {
    await call;
  } catch (err) {
    return (err as { data: Record<string, unknown> }).data;
  }
  throw new Error("the call was not refused");
};

const until = async (check: () => boolean) => {
  for (let tries = 0; !check(); tries++) {
    if (tries > 5_000) throw new Error("never happened");
    await Bun.sleep(1);
  }
};

const fightLock = () => readSchedule(db.row!.aiattacks).fight;

beforeEach(() => {
  redis.clear();
  db.row = rowOf();
  db.locks = 0;
  standIn.slot = null;
  standIn.fight = null;
  at(NOW);
});

afterEach(() => setSystemTime());

const FIGHT_TIMEOUT_MS = 60_000;

describe("refusals", () => {
  test("not the caller's main yard", async () => {
    await present(NOW);
    await expect(springTrojanHorse(em, { userid: USER, save: undefined } as unknown as User, NOW)).rejects.toThrow();
  });

  test("no horse ever placed", async () => {
    await present(NOW);
    db.row = rowOf({}, { trojan: undefined });
    expect(await refusal(springTrojanHorse(em, user, NOW))).toEqual({ reason: "noHorse" });
  });

  test("already sprung (doneAt set)", async () => {
    await present(NOW);
    db.row = rowOf({}, { trojan: { placedAt: NOW - 1000, doneAt: NOW - 500 } });
    expect(await refusal(springTrojanHorse(em, user, NOW))).toEqual({ reason: "noHorse" });
  });

  test("the flag is set but the horse is not in buildingdata (already recycled by a forged save, say)", async () => {
    await present(NOW);
    const { "900": _horse, ...withoutHorse } = rowOf().buildingdata as Row;
    db.row = rowOf({ buildingdata: withoutHorse });
    expect(await refusal(springTrojanHorse(em, user, NOW))).toEqual({ reason: "noHorse" });
  });

  test("a raid already open (a wild raid's warning)", async () => {
    await present(NOW);
    await openRaid(USER, { id: newRaidId(), phase: "warning", tribe: "Kozu", plan: {}, seed: 1, attackAt: NOW, warned: 0 }, NOW);
    expect(await refusal(springTrojanHorse(em, user, NOW))).toEqual({ reason: "raidOpen" });
  });

  test("the yard under attack by a player", async () => {
    await present(NOW);
    db.row = rowOf({ attackid: 42, protected: 0, attacks: [{ attackID: 42, state: 0, starttime: NOW - 30 }] });
    expect(await refusal(springTrojanHorse(em, user, NOW))).toEqual({ reason: "underAttack" });
  });

  test("the player is not online on their yard", async () => {
    // No presence marks at all.
    expect(await refusal(springTrojanHorse(em, user, NOW))).toEqual({ reason: "offline" });
  });

  test("no replay slot free is busy, before the yard is touched", async () => {
    await present(NOW);
    standIn.slot = async () => null;
    db.locks = 0;
    expect(await refusal(springTrojanHorse(em, user, NOW))).toEqual({ reason: "busy" });
    expect(db.locks).toBe(0);
    expect(await readOpenRaid(USER)).toBeNull();
  });
});

describe("the spring", () => {
  test(
    "opens the fight at once: 51 events, no warning, and locks the yard",
    async () => {
      await present(NOW);
      const start = await springTrojanHorse(em, user, NOW);

      expect(start.raid).toMatchObject({ phase: "fighting", tribe: "wild", startedAt: NOW });
      expect(start.fight.events).toHaveLength(TROJAN_MONSTER_COUNT);
      expect(Math.max(...start.fight.events.map((event) => event.t))).toBe(TROJAN_LAST_SPAWN_TICK);
      expect(start.fight.tick).toBeGreaterThanOrEqual(TROJAN_LAST_SPAWN_TICK);

      const open = (await readOpenRaid(USER))!;
      expect(open.phase).toBe("fighting");
      expect(open.tribe).toBe("wild");
      expect(raidFighting(db.row!, NOW)).toBe(true);
      expect(readSchedule(db.row!.aiattacks).fight?.id).toBe(start.raid.id);
    },
    FIGHT_TIMEOUT_MS
  );

  test(
    "two springs at once: one fight, the second refused",
    async () => {
      await present(NOW);
      const [one, two] = await Promise.allSettled([springTrojanHorse(em, user, NOW), springTrojanHorse(em, user, NOW)]);

      const won = [one, two].filter((settled) => settled.status === "fulfilled");
      const lost = [one, two].filter((settled) => settled.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0] as PromiseRejectedResult).reason.data.reason).toBe("raidOpen");
      expect((await readOpenRaid(USER))?.phase).toBe("fighting");
    },
    FIGHT_TIMEOUT_MS
  );

  test(
    "runs outside any transaction: the row is free while the fight runs, held by a provisional lock",
    async () => {
      await present(NOW);
      let started = false;
      const springing = springTrojanHorse(em, user, NOW).then((start) => {
        started = true;
        return start;
      });

      await until(() => fightLock() !== undefined);
      expect(fightLock()).toMatchObject({ until: NOW + START_LOCK_SECONDS });
      expect(started).toBe(false);

      await springing;
    },
    FIGHT_TIMEOUT_MS
  );
});

describe("the finish", () => {
  const spring = async () => {
    await present(NOW);
    const start = await springTrojanHorse(em, user, NOW);
    const finishFrom = start.raid.finishFrom!;
    return { id: start.raid.id, finishFrom };
  };

  test(
    "lands once: no Shiny, the horse gone, doneAt set, the timer reset as the design says; a second finish applies nothing",
    async () => {
      const { id, finishFrom } = await spring();
      at(finishFrom);
      await present(finishFrom);

      const result = await finishRaid(em, user, id, finishFrom);
      expect(result.shiny).toBe(0);
      expect(result.tribe).toBe("wild");
      expect(db.row!.credits).toBe(100);

      const horse = Object.values(db.row!.buildingdata as Row).find(
        (building) => Number((building as Row).t) === TROJAN_HORSE_TYPE
      );
      expect(horse).toBeUndefined();

      const schedule = readSchedule(db.row!.aiattacks);
      expect(schedule.fight).toBeUndefined();
      expect(schedule.lastattack).toBe(NOW - 3 * DAY);
      expect(schedule.nextAttack).toBeUndefined();
      expect(schedule.sessionsSinceLastAttack).toBe(0);
      expect(schedule.trojan).toMatchObject({ placedAt: NOW - 1000, doneAt: finishFrom });
      expect(schedule.recent[0]).toMatchObject({ id, tribe: "wild", shiny: 0 });

      const before = structuredClone(db.row!);
      const again = await finishRaid(em, user, id, finishFrom + 5);
      expect(again).toMatchObject({ id, shiny: 0 });
      expect(db.row).toEqual(before);
    },
    FIGHT_TIMEOUT_MS
  );

  test(
    "too early (shorter than the spawn time) is refused, and the raid stays open",
    async () => {
      const { id, finishFrom } = await spring();
      expect(await refusal(finishRaid(em, user, id, NOW))).toEqual({ reason: "tooEarly", readyAt: finishFrom });
      expect((await readOpenRaid(USER))?.id).toBe(id);
    },
    FIGHT_TIMEOUT_MS
  );

  test(
    "quitting mid-fight (game closed) cancels it: the horse and flag are unchanged, so it can be sprung again",
    async () => {
      const { id, finishFrom } = await spring();
      const before = structuredClone(db.row!);
      at(finishFrom);
      await redis.del(lastSeenKey(USER));

      expect(await refusal(finishRaid(em, user, id, finishFrom))).toEqual({ reason: "cancelled" });

      expect(db.row!.buildingdata).toEqual(before.buildingdata);
      expect(readSchedule(db.row!.aiattacks).trojan).toEqual({ placedAt: NOW - 1000 });
      expect(await readOpenRaid(USER)).toBeNull();
      expect(raidFighting(db.row!, finishFrom)).toBe(false);

      // Sprung again straight away.
      await present(finishFrom);
      const second = await springTrojanHorse(em, user, finishFrom);
      expect(second.raid.phase).toBe("fighting");
    },
    FIGHT_TIMEOUT_MS
  );
});
