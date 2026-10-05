import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import { achievementConfig } from "../../config/AchievementConfig.js";
import {
  KOZU_CAMP_WMID,
  kozuHallFell,
  recordAchievementEvents,
  recordAttackAchievements,
  type DefenderLike,
} from "./events.js";
import { readAchievements } from "./state.js";

/**
 * Map and attack achievement events (issue #204, WP3,
 * `docs/design/achievements.md` §7.2): which landed attacks bring down a
 * Kozu Town Hall, and the short locked transaction that records one, over an
 * in-memory row and a list of bell rows.
 */

type Row = Record<string, unknown>;

/** A record already worked out, so a test sees only its own events. */
const BACKFILLED = { v: 1, s: { thlevel: 3 }, c: { "1": { at: 1, shiny: 5, seen: 1 } }, backfilledAt: 1 };

const db = { row: null as Row | null, bell: [] as Row[], lock: null as unknown, transactions: 0 };

const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    db.transactions += 1;
    let entity: Row | null = null;
    const bell: Row[] = [];
    const fork = {
      async findOne(_entity: unknown, _where: unknown, options: unknown) {
        db.lock = options;
        entity = db.row && structuredClone(db.row);
        return entity;
      },
      async insertMany(_entity: unknown, rows: Row[]) {
        bell.push(...rows);
      },
      async nativeDelete() {},
      getConnection: () => ({ execute: async () => [] }),
      async flush() {},
    };
    const result = await cb(fork);
    if (entity) db.row = structuredClone(entity);
    db.bell.push(...bell);
    return result;
  },
} as unknown as EntityManager;

/** A Kozu camp whose Town Hall is building 0 (`game-data/tribes/v2/kozu.ts`). */
const kozuCamp = (overrides: Row = {}): DefenderLike => ({
  type: "tribe",
  wmid: KOZU_CAMP_WMID,
  buildingdata: {
    "0": { id: 0, t: 14, X: -65, Y: -65, l: 5 },
    "1": { id: 1, t: 6, X: 100, Y: 100, l: 3 },
  } as unknown as DefenderLike["buildingdata"],
  ...overrides,
});

const startingRewards = achievementConfig.rewards;

beforeEach(() => {
  db.row = { basesaveid: 7, userid: 2503, type: "main", credits: 100, outposts: [], achievements: structuredClone(BACKFILLED) };
  db.bell = [];
  db.lock = null;
  db.transactions = 0;
  achievementConfig.rewards = false;
});

afterEach(() => {
  achievementConfig.rewards = startingRewards;
});

describe("kozuHallFell", () => {
  test("Kozu's Map Room 2 camps are wmid 11", () => {
    expect(KOZU_CAMP_WMID).toBe(11);
  });

  test("a Kozu camp's Town Hall standing when the attack began and at 0 after", () => {
    expect(kozuHallFell(kozuCamp(), {}, { "0": 0 })).toBe(true);
    expect(kozuHallFell(kozuCamp(), { "0": 1200 }, { "0": 0, "1": 50 })).toBe(true);
  });

  test("a Town Hall still standing, or a building that is not one, gives nothing", () => {
    expect(kozuHallFell(kozuCamp(), {}, { "0": 1 })).toBe(false);
    expect(kozuHallFell(kozuCamp(), {}, {})).toBe(false);
    expect(kozuHallFell(kozuCamp(), {}, { "1": 0 })).toBe(false);
  });

  test("a Town Hall someone else already flattened gives nothing", () => {
    expect(kozuHallFell(kozuCamp(), { "0": 0 }, { "0": 0 })).toBe(false);
  });

  test("only a Kozu camp: other tribes, outposts and main yards give nothing", () => {
    for (const wmid of [1, 21, 31, 0]) expect(kozuHallFell(kozuCamp({ wmid }), {}, { "0": 0 })).toBe(false);
    expect(kozuHallFell(kozuCamp({ type: "outpost" }), {}, { "0": 0 })).toBe(false);
    expect(kozuHallFell(kozuCamp({ type: "main" }), {}, { "0": 0 })).toBe(false);
  });

  test("an entry with no id is known by its key, as the engine knows it", () => {
    const camp = kozuCamp({ buildingdata: { "4": { t: 14, X: 0, Y: 0, l: 5 } } });
    expect(kozuHallFell(camp, null, { "4": 0 })).toBe(true);
  });
});

describe("recordAchievementEvents", () => {
  test("adds the events on the main row read under a row lock; owed while rewards are off", async () => {
    const recorded = await recordAchievementEvents(em, 7, { wm2hall: 1 }, 1_800_000_000);

    expect(db.lock).toMatchObject({ lockMode: expect.anything(), refresh: true });
    expect(recorded?.unlocked).toEqual([{ id: 10, name: "Kozu Crusher", shiny: 10 }]);
    expect(recorded?.paid).toEqual([]);
    expect(readAchievements(db.row!).s.wm2hall).toBe(1);
    expect(readAchievements(db.row!).c["10"]).toEqual({ at: 1_800_000_000, shiny: 10, unpaid: 1 });
    expect(db.row!.credits).toBe(100);
    expect(db.bell).toEqual([]);
  });

  test("with rewards on it pays once: Shiny and one bell row", async () => {
    achievementConfig.rewards = true;
    await recordAchievementEvents(em, 7, { wm2hall: 1 });
    expect(db.row!.credits).toBe(110);
    expect(db.bell).toHaveLength(1);
    expect(db.bell[0]).toMatchObject({ userid: 2503, baseid: null, kind: "achievement" });

    await recordAchievementEvents(em, 7, { wm2hall: 1 });
    expect(db.row!.credits).toBe(110);
    expect(db.bell).toHaveLength(1);
  });

  test("a row that is gone records nothing", async () => {
    db.row = null;
    expect(await recordAchievementEvents(em, 7, { wm2hall: 1 })).toBeNull();
  });
});

describe("recordAttackAchievements", () => {
  const landed = (defender: DefenderLike, after: Row = { "0": 0 }) => ({ attackerBasesaveid: 7, defender, before: {}, after });

  test("a Kozu Town Hall brought down unlocks Kozu Crusher on the attacker's main row", async () => {
    expect(await recordAttackAchievements(em, landed(kozuCamp()))).toBe(true);
    expect(readAchievements(db.row!).c["10"]).toMatchObject({ shiny: 10 });
  });

  test("any other landing opens no transaction at all", async () => {
    expect(await recordAttackAchievements(em, landed(kozuCamp({ wmid: 1 })))).toBe(false);
    expect(await recordAttackAchievements(em, landed(kozuCamp(), { "0": 300 }))).toBe(false);
    expect(db.transactions).toBe(0);
    expect(readAchievements(db.row!).s.wm2hall).toBe(0);
  });

  test("a failure is logged, never thrown: the attack has landed", async () => {
    const failing = {
      transactional: async () => {
        throw new Error("lock timeout");
      },
    } as unknown as EntityManager;
    expect(await recordAttackAchievements(failing, landed(kozuCamp()))).toBe(false);
  });
});
