import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import { achievementConfig } from "../../config/AchievementConfig.js";
import type { User } from "../../database/models/user.model.js";
import { readAchievements } from "../../services/achievements/state.js";
import type { AchievementsState } from "../../services/achievements/view.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardAchievementsSeenAction, yardAchievementsStateAction } from "./achievementsActions.js";
import { runYardAction, type YardAnswer } from "./yardAction.js";

/**
 * The player's own achievements routes (issue #204, WP4,
 * `docs/design/achievements.md` §9.1) through the yard action wrapper, with
 * the database replaced by one in-memory row and a list of bell rows, as in
 * `yardAction.achievements.test.ts`.
 */

type Row = Record<string, unknown>;

const db = { row: null as Row | null, bell: [] as Row[] };

const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    let entity: Row | null = null;
    const bell: Row[] = [];
    const fork = {
      async findOne() {
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
};

const user = { userid: 2503, shiny_locked: false, save: { basesaveid: 7 } } as unknown as User;

/** A main yard: Town Hall level 3, which earns "Moving Up" (5 Shiny). */
const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: 7,
  userid: 2503,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime(),
  credits: 100,
  points: "100",
  flinger: 0,
  catapult: 0,
  resources: { r1: 60000, r2: 40000, r3: 20000, r4: 0 },
  buildingdata: {
    "1": { id: 1, t: 14, X: -65, Y: -65, l: 3 },
    "2": { id: 2, t: 6, X: -400, Y: 200, l: 10 },
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
  ...overrides,
});

const call = (action: Parameters<typeof runYardAction>[2], body: Row = {}): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, action, body);

const stateOf = (answer: YardAnswer) => answer.body.report as AchievementsState;
const entry = (answer: YardAnswer, id: number) => stateOf(answer).achievements.find((view) => view.id === id)!;
const record = () => readAchievements(db.row!);
const startingRewards = achievementConfig.rewards;

beforeEach(() => {
  db.row = rowOf();
  db.bell = [];
  achievementConfig.rewards = false;
});

afterEach(() => {
  achievementConfig.rewards = startingRewards;
});

describe("achievements/state", () => {
  test("both work on an outpost", () => {
    expect(yardAchievementsStateAction.outposts).toBe("allow");
    expect(yardAchievementsSeenAction.outposts).toBe("allow");
  });

  test("with rewards on, a record never worked out answers with this request's backfill, paid", async () => {
    achievementConfig.rewards = true;

    const answer = await call(yardAchievementsStateAction);

    expect(answer.status).toBe(200);
    const state = stateOf(answer);
    expect(state.total).toBe(16);
    expect(state.earned).toBe(1);
    expect(state.shinyEarned).toBe(5);
    expect(entry(answer, 1)).toMatchObject({ status: "earned", shiny: 5, progress: { value: 2, target: 2 } });
    expect(entry(answer, 1).at).toBeGreaterThan(0);
    expect(state.fresh).toEqual([{ id: 1, name: "Moving Up", shiny: 5, backfill: true }]);
    expect(db.row!.credits).toBe(105);
    expect(record().backfilledAt).toBeGreaterThan(0);
  });

  test("with rewards off, an owed unlock reads locked and earns nothing, though the record is worked out", async () => {
    const answer = await call(yardAchievementsStateAction);

    const state = stateOf(answer);
    expect(state.earned).toBe(0);
    expect(state.shinyEarned).toBe(0);
    expect(state.fresh).toEqual([]);
    expect(entry(answer, 1).status).toBe("locked");
    expect(entry(answer, 1).at).toBeUndefined();
    expect(record().c["1"]).toMatchObject({ unpaid: 1 });
    expect(db.row!.credits).toBe(100);
  });

  test("progress reads the record's stats, capped at the target, one part per champion", async () => {
    db.row = rowOf({
      achievements: {
        v: 1,
        s: { thlevel: 3, blocksbuilt: 140, upgrade_champ2: 1 },
        c: { "1": { at: 1, shiny: 5, seen: 1 } },
        backfilledAt: 1,
      },
    });
    achievementConfig.rewards = true;

    const answer = await call(yardAchievementsStateAction);

    expect(entry(answer, 2).progress).toEqual({ value: 3, target: 5 });
    expect(entry(answer, 12).progress).toEqual({ value: 140, target: 200 });
    expect(entry(answer, 4)).toMatchObject({ status: "earned", progress: { value: 1, target: 1 } });
    expect(entry(answer, 5)).toMatchObject({ status: "locked" });
    expect(entry(answer, 5).progress).toEqual({
      value: 1,
      target: 3,
      parts: [
        { label: "Gorgo", value: 0, target: 1 },
        { label: "Drull", value: 1, target: 1 },
        { label: "Fomor", value: 0, target: 1 },
      ],
    });
  });

  test("lists only the available entries, in Flash's order", async () => {
    const ids = stateOf(await call(yardAchievementsStateAction)).achievements.map((view) => view.id);

    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 15, 16, 17, 22]);
  });
});

describe("achievements/seen", () => {
  test("marks paid unlocks seen; the answer stops carrying them", async () => {
    achievementConfig.rewards = true;
    const first = await call(yardAchievementsStateAction);
    expect(first.body.achievements).toEqual([{ id: 1, name: "Moving Up", shiny: 5, backfill: true }]);

    const answer = await call(yardAchievementsSeenAction, { ids: "[1]" });

    expect(answer.status).toBe(200);
    expect(answer.body.report).toEqual({ seen: [1] });
    expect(answer.body.achievements).toBeUndefined();
    expect(record().c["1"]!.seen).toBe(1);
    expect(stateOf(await call(yardAchievementsStateAction)).fresh).toEqual([]);
  });

  test("ignores ids not earned, already seen, or still owed", async () => {
    db.row = rowOf({
      achievements: {
        v: 1,
        s: { thlevel: 3 },
        c: { "1": { at: 1, shiny: 5, unpaid: 1 }, "6": { at: 1, shiny: 10, seen: 1 } },
        backfilledAt: 1,
      },
    });

    const answer = await call(yardAchievementsSeenAction, { ids: "[1, 6, 9, 22, 22]" });

    expect(answer.body.report).toEqual({ seen: [] });
    expect(record().c["1"]).toEqual({ at: 1, shiny: 5, unpaid: 1 });
    expect(record().c["9"]).toBeUndefined();
  });

  test("refuses a body that is not a list of achievement numbers", async () => {
    for (const ids of [undefined, "1", "not json", "[0]", "[\"1\"]"]) {
      const answer = await call(yardAchievementsSeenAction, ids === undefined ? {} : { ids });
      expect(answer.status).toBe(400);
    }
  });
});
