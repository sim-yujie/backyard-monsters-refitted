import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import z from "zod";
import { achievementConfig } from "../../config/AchievementConfig.js";
import type { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { readAchievements, updateAchievements } from "../../services/achievements/state.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardBuildAction, yardInstantBuildAction } from "./build.js";
import { yardStateAction } from "./state.js";
import { catchUpLockedYard, defineYardAction, runYardAction, type YardAnswer } from "./yardAction.js";

/**
 * Achievements in the yard action wrapper and the owner's load catch-up
 * (issue #204, WP2, `docs/design/achievements.md` §7.2, §7.3, §9.3), with the
 * database replaced by one in-memory row and a list of bell rows.
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

const userOf = (overrides: Partial<User> = {}): User =>
  ({ userid: 2503, shiny_locked: false, save: { basesaveid: 7 }, ...overrides }) as unknown as User;

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
  lockerdata: { C1: { t: 2 } },
  academy: {},
  champion: [],
  mushrooms: { l: [], s: getCurrentDateTime() },
  researchdata: {},
  outposts: [],
  ...overrides,
});

/** A record already worked out (and "Moving Up" seen), so a test sees only its own events. */
const BACKFILLED = { v: 1, s: { thlevel: 3 }, c: { "1": { at: 1, shiny: 5, seen: 1 } }, backfilledAt: 1 };

const call = (action: Parameters<typeof runYardAction>[2], body: Row = {}, user: User = userOf()): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, action, body);

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

describe("counting", () => {
  test("the first action works the record out: the backfill's unlocks are owed while rewards are off", async () => {
    const answer = await call(yardStateAction);

    expect(answer.status).toBe(200);
    expect(record().backfilledAt).toBeGreaterThan(0);
    expect(record().c["1"]).toMatchObject({ shiny: 5, backfill: 1, unpaid: 1 });
    expect(db.row!.credits).toBe(100);
    expect(answer.body.achievements).toBeUndefined();
    expect(db.bell).toEqual([]);
  });

  test("each Block placed counts as built, by Build and by Instant build; a tower does not", async () => {
    db.row = rowOf({ achievements: BACKFILLED });

    await call(yardBuildAction, { type: 17, x: 0, y: 200 });
    await call(yardBuildAction, { type: 17, x: 40, y: 200 });
    await call(yardInstantBuildAction, { type: 17, x: 80, y: 200 });
    await call(yardBuildAction, { type: 20, x: 300, y: -300 });

    expect(record().s.blocksbuilt).toBe(3);
  });

  test("a Block whose build countdown ends in the catch-up counts", async () => {
    db.row = rowOf({
      achievements: { ...BACKFILLED, s: { thlevel: 3, blocksbuilt: 5 } },
      savetime: getCurrentDateTime() - 60,
      buildingdata: {
        ...(rowOf().buildingdata as Row),
        "3": { id: 3, t: 17, X: 0, Y: 200, cB: 10, cL: 10, prefab: 1 },
      },
    });

    const answer = await call(yardStateAction);

    expect(answer.body.completed).toEqual([expect.objectContaining({ kind: "build", id: 3, t: 17 })]);
    expect(record().s.blocksbuilt).toBe(6);
  });

  test("a Block put back from the Yard Planner's storage is not a build", async () => {
    db.row = rowOf({ achievements: BACKFILLED });
    const placeStored = defineYardAction({
      schema: z.object({}),
      run: ({ save }) => ({
        report: null,
        slices: { buildingdata: { ...save.buildingdata, "3": { id: 3, t: 17, X: 0, Y: 200, l: 1 } } as unknown as Save["buildingdata"] },
      }),
    });

    await call(placeStored);

    expect((db.row!.buildingdata as Row)["3"]).toBeDefined();
    expect(record().s.blocksbuilt).toBe(0);
  });

  test("a refused action writes no record", async () => {
    const answer = await call(yardBuildAction, { type: 17, x: -65, y: -65 });

    expect(answer.status).toBe(409);
    expect(db.row!.achievements).toBeUndefined();
  });
});

describe("paying (rewards on)", () => {
  beforeEach(() => {
    achievementConfig.rewards = true;
  });

  test("an unlock credits its Shiny once, writes one bell row, and the answer lists it until seen", async () => {
    const first = await call(yardStateAction);

    expect(first.body.credits).toBe(105);
    expect(db.row!.credits).toBe(105);
    expect(first.body.achievements).toEqual([{ id: 1, name: "Moving Up", shiny: 5, backfill: true }]);
    expect(db.bell).toHaveLength(1);
    expect(db.bell[0]).toMatchObject({
      userid: 2503,
      baseid: null,
      kind: "achievement",
      jobs: [{ kind: "achievement", id: 1, detail: { name: "Moving Up", shiny: 5, backfill: true } }],
    });

    const second = await call(yardStateAction);
    expect(db.row!.credits).toBe(105);
    expect(db.bell).toHaveLength(1);
    expect(second.body.achievements).toEqual(first.body.achievements);
  });

  test("what was earned while rewards were off is paid by the first action after", async () => {
    achievementConfig.rewards = false;
    await call(yardStateAction);
    expect(db.row!.credits).toBe(100);

    achievementConfig.rewards = true;
    const answer = await call(yardStateAction);

    expect(db.row!.credits).toBe(105);
    expect(answer.body.achievements).toEqual([{ id: 1, name: "Moving Up", shiny: 5, backfill: true }]);
    expect(db.bell).toHaveLength(1);
  });

  test("a Shiny-locked account still collects", async () => {
    await call(yardStateAction, {}, userOf({ shiny_locked: true }));

    expect(db.row!.credits).toBe(105);
  });

  test("an action may write the record through its slices; the wrapper evaluates on top", async () => {
    db.row = rowOf({ achievements: { ...BACKFILLED, c: { "1": { at: 1, shiny: 5 } } } });
    const markSeen = defineYardAction({
      schema: z.object({}),
      run: ({ save }) => ({
        report: null,
        slices: {
          achievements: updateAchievements(save, (r) => {
            r.c["1"]!.seen = 1;
          }) as unknown as Save["achievements"],
        },
      }),
    });

    const answer = await call(markSeen);

    expect(answer.body.achievements).toBeUndefined();
    expect(record().c["1"]).toEqual({ at: 1, shiny: 5, seen: 1 });
  });
});

describe("the owner's load catch-up", () => {
  test("evaluates and writes the record, counting Blocks the catch-up finished", async () => {
    achievementConfig.rewards = true;
    db.row = rowOf({
      achievements: { ...BACKFILLED, s: { thlevel: 3, blocksbuilt: 199 } },
      savetime: getCurrentDateTime() - 60,
      buildingdata: {
        ...(rowOf().buildingdata as Row),
        "3": { id: 3, t: 17, X: 0, Y: 200, cB: 10, cL: 10, prefab: 1 },
      },
    });

    const { completed } = await catchUpLockedYard(em as unknown as EntityManager, db.row as unknown as Save);

    expect(completed).toEqual([expect.objectContaining({ kind: "build", t: 17 })]);
    expect(record().s.blocksbuilt).toBe(200);
    expect(record().c["12"]).toMatchObject({ shiny: 10 });
    expect(db.row!.credits).toBe(110);
    expect(db.bell).toHaveLength(1);
  });
});
