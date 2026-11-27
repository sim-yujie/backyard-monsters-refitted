import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import { InfernoProgress } from "../../../database/models/infernoprogress.model.js";
import type { User } from "../../../database/models/user.model.js";
import { experiencePoints } from "../../../game-data/stats/experiencePoints.js";
import { memoryRedis } from "../../../testing/memoryRedis.js";

/**
 * A wave event's wave end to end on the server (beta 10, Wild Monster
 * Invasion): "Next wave" fights it in the real replay worker and opens it,
 * `/raid/finish` lands it through the raid's own settle (`raidFlow.ts`) with
 * the wave's branch (`waveLanding.ts`), and a surrender lands only the
 * damage up to its tick. The database and Redis stand-ins are
 * `raidFlow.test.ts`'s.
 */

const strings = new Map<string, string>();
const redis = memoryRedis(strings);

mock.module("../../../server.js", () => ({
  postgres: { em: {} },
  redis,
}));

const { finishRaid } = await import("../../raids/raidFlow.js");
const { readSchedule } = await import("../../raids/raidSchedule.js");
const { readOpenRaid, recordRaidScreen } = await import("../../raids/raidStore.js");
const { lastActionKey, lastSeenKey } = await import("../../user/online.js");
const { memoryCoinStore, useCoinStore } = await import("../eventCoins.js");
const { startNextWave, surrenderWave, readWaveStatus } = await import("./waveFight.js");
const { memoryWaveProgressStore, useWaveProgressStore } = await import("./waveProgress.js");
const { setWaveRuns, runId } = await import("./waveRuns.js");

type Row = Record<string, unknown>;

const db = {
  row: null as Row | null,
  /** The player's `inferno_progress` row, or none. */
  inferno: null as Row | null,
  tail: Promise.resolve() as Promise<void>,
  /** Unlocked reads of the whole row (no `fields`), and locked reads. */
  fullReads: 0,
  locks: 0,
  /** The next this many flushes fail, as a lost database connection would: the transaction writes nothing. */
  failFlushes: 0,
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
  async findOne(entity: unknown, _where: unknown, options?: { fields?: unknown }) {
    // The Inferno emergence's progress row (`emergenceHoldsRaids`).
    if (entity === InfernoProgress) return db.inferno;
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
        if (db.failFlushes > 0) {
          db.failFlushes--;
          throw new Error("the database went away");
        }
        if (entity) pending = structuredClone(entity);
      },
      transactional: (inner: (fork: unknown) => Promise<unknown>) => inner(fork),
      // Moloch's landing marks its stage played (`clearEmergencePending`), in this transaction.
      async execute(sql: string, params: unknown[]) {
        // Params: the landing time (unix seconds), the user, the stage.
        if (/SET emergence_pending = NULL/.test(sql) && db.inferno?.emergence_pending === params[2]) {
          db.inferno = { ...db.inferno, emergence_pending: null, emergence_last_at: params[0] };
        }
        return [];
      },
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
  readFileSync(fileURLToPath(new URL("../../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url)), "utf8")
) as { buildingdata: Row; resources: Row };

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
  tutorialstage: 205,
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


const RUN = { event: "wmi1", startsAt: NOW - 60, endsAt: NOW + 7 * DAY };
const FIGHT_TIMEOUT_MS = 60_000;
let coins: ReturnType<typeof memoryCoinStore>;
let progress: ReturnType<typeof memoryWaveProgressStore>;
let undo: (() => void)[] = [];

beforeEach(async () => {
  strings.clear();
  db.row = rowOf();
  db.inferno = null;
  coins = memoryCoinStore();
  progress = memoryWaveProgressStore();
  const before = [useCoinStore(coins), useWaveProgressStore(progress)] as const;
  undo = [() => useCoinStore(before[0]), () => useWaveProgressStore(before[1])];
  setWaveRuns([RUN]);
  at(NOW);
  await present(NOW);
});

afterEach(() => {
  undo.forEach((one) => one());
  setWaveRuns([]);
  setSystemTime();
});

describe("a wave through the raid machinery", () => {
  test(
    "Next wave fights wave 1 and opens it; the finish lands it with no theft, counts it and pays its Glimmers and totem once",
    async () => {
      const resources = structuredClone(db.row!.resources);
      const start = await startNextWave(em, user, NOW);
      expect(start.raid).toMatchObject({ phase: "fighting", tribe: "wave", monsters: { C2: 5 } });
      expect(start.wave).toMatchObject({ next: 1, beaten: 0 });
      const finishFrom = start.raid.finishFrom!;
      at(finishFrom);
      await present(finishFrom);
      const result = await finishRaid(em, user, start.raid.id, finishFrom);
      expect(result.stolen).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
      expect(result.shiny).toBe(0);
      expect(db.row!.resources).toEqual(resources);
      expect(result.wave).toMatchObject({ event: "wmi1", run: runId(RUN), wave: 1, beaten: true, next: 2, glimmers: 20, totem: { type: 121, level: 1 } });
      expect(coins.balances.get(USER)).toBe(20);
      expect((db.row!.researchdata as Record<string, unknown>)["bl121"]).toBe(1);
      expect(readSchedule(db.row!.aiattacks).fight).toBeUndefined();
      expect(await readOpenRaid(USER)).toBeNull();
      expect((await readWaveStatus(em, USER, finishFrom))?.next).toBe(2);
    },
    FIGHT_TIMEOUT_MS
  );

  test("refused with no wave event on, or with a raid already open", async () => {
    setWaveRuns([]);
    await expect(startNextWave(em, user, NOW)).rejects.toMatchObject({ data: { reason: "noEvent" } });
    setWaveRuns([RUN]);
    await startNextWave(em, user, NOW);
    await expect(startNextWave(em, user, NOW)).rejects.toMatchObject({ data: { reason: "raidOpen" } });
  }, FIGHT_TIMEOUT_MS);

  test(
    "a surrender lands the wave lost, with only the damage done up to its tick",
    async () => {
      progress.rows.set(`${USER}:${runId(RUN)}`, { beaten: 17, lost: 0 });
      const start = await startNextWave(em, user, NOW);
      const later = NOW + 4;
      at(later);
      await present(later);
      const result = await surrenderWave(em, user, start.raid.id, 4 * 80, later);
      expect(result.wave).toMatchObject({ wave: 18, beaten: false, surrendered: true, next: 18, glimmers: 0 });
      expect((await progress.read(em, USER, runId(RUN))).lost).toBe(1);
      expect(await readOpenRaid(USER)).toBeNull();
    },
    FIGHT_TIMEOUT_MS
  );
});
