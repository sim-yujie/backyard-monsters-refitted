import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import { achievementConfig } from "../../config/AchievementConfig.js";
import { Maproom } from "../../database/models/maproom.model.js";
import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { playerAchievementsAnswer } from "./player.js";

/**
 * Another player's achievements (issue #204, WP4,
 * `docs/design/achievements.md` §9.2), with the database replaced by an
 * entity manager that can only read: any write would throw.
 */

type Row = Record<string, unknown>;

const NOW = 1_791_200_000;

const db = {
  user: null as Row | null,
  outposts: [] as Row[],
  maproom: null as Row | null,
  reads: [] as string[],
};

const em = {
  async findOne(entity: unknown, where: Row) {
    if (entity === User) {
      db.reads.push(`user ${String(where.userid)}`);
      return db.user && Number(db.user.userid) === where.userid ? db.user : null;
    }
    if (entity === Maproom) {
      db.reads.push("maproom");
      return db.maproom;
    }
    throw new Error("unexpected findOne");
  },
  async find(entity: unknown) {
    if (entity !== Save) throw new Error("unexpected find");
    db.reads.push("outposts");
    return db.outposts;
  },
};

/** A Town Hall 5 yard with two Blocks; Map Room level 2. */
const saveOf = (overrides: Row = {}): Row => ({
  userid: 3001,
  type: "main",
  credits: 100,
  buildingdata: {
    "1": { id: 1, t: 14, X: 0, Y: 0, l: 5 },
    "2": { id: 2, t: 11, X: 100, Y: 0, l: 2 },
    "3": { id: 3, t: 17, X: 200, Y: 0, l: 1 },
    "4": { id: 4, t: 17, X: 240, Y: 0, l: 1 },
  },
  champion: [],
  lockerdata: {},
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
  outposts: [],
  achievements: null,
  ...overrides,
});

const userOf = (overrides: Row = {}): Row => ({
  userid: 3001,
  username: "Bot Bertie",
  banned: false,
  save: saveOf(),
  ...overrides,
});

const ask = (params: unknown = { userid: "3001" }) =>
  playerAchievementsAnswer(em as unknown as EntityManager, params, NOW);

const startingRewards = achievementConfig.rewards;

beforeEach(() => {
  db.user = userOf();
  db.outposts = [];
  db.maproom = null;
  db.reads = [];
  achievementConfig.rewards = true;
});

afterEach(() => {
  achievementConfig.rewards = startingRewards;
});

describe("GET bm/achievements/player/:userid", () => {
  test("a record never worked out gets the backfill on the fly, and nothing is stored", async () => {
    const answer = await ask();

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ error: 0, userid: 3001, name: "Bot Bertie", earned: 3, total: 16 });
    const earned = (answer.body.achievements as Row[]).filter((view) => view.status === "earned");
    expect(earned).toEqual([
      { id: 1, name: "Moving Up", description: expect.any(String), status: "earned", at: NOW },
      { id: 2, name: expect.any(String), description: expect.any(String), status: "earned", at: NOW },
      { id: 6, name: expect.any(String), description: expect.any(String), status: "earned", at: NOW },
    ]);
    expect((db.user!.save as Row).achievements).toBeNull();
    expect((db.user!.save as Row).credits).toBe(100);
  });

  test("never sends progress or Shiny", async () => {
    const answer = await ask();

    for (const view of answer.body.achievements as Row[]) {
      expect(Object.keys(view).sort()).toEqual(
        view.status === "earned" ? ["at", "description", "id", "name", "status"] : ["description", "id", "name", "status"]
      );
    }
    expect(answer.body).not.toHaveProperty("shinyEarned");
  });

  test("with rewards off, nothing reads as earned: the backfill's unlocks would be owed", async () => {
    achievementConfig.rewards = false;

    const answer = await ask();

    expect(answer.body.earned).toBe(0);
    expect((answer.body.achievements as Row[]).every((view) => view.status === "locked")).toBe(true);
  });

  test("a record already worked out is taken as stored, owed unlocks locked while rewards are off", async () => {
    achievementConfig.rewards = false;
    db.user = userOf({
      save: saveOf({
        achievements: {
          v: 1,
          s: { thlevel: 5 },
          c: { "1": { at: 1000, shiny: 5, seen: 1 }, "2": { at: 2000, shiny: 10, unpaid: 1 } },
          backfilledAt: 1000,
        },
      }),
    });

    const answer = await ask();

    expect(answer.body.earned).toBe(1);
    const byId = new Map((answer.body.achievements as Row[]).map((view) => [view.id, view]));
    expect(byId.get(1)).toMatchObject({ status: "earned", at: 1000 });
    expect(byId.get(2)).toMatchObject({ status: "locked" });
    // Map Room 2 is not folded in: only a record never worked out is evaluated.
    expect(byId.get(6)).toMatchObject({ status: "locked" });
    expect(db.reads).toEqual(["user 3001"]);
  });

  test("the backfill counts Blocks standing in the player's outposts too", async () => {
    db.user = userOf({ save: saveOf({ outposts: [[10, 20, 9001]] }) });
    db.outposts = [
      { buildingdata: Object.fromEntries(Array.from({ length: 198 }, (_, i) => [String(i), { id: i, t: 17, l: 1 }])) },
    ];

    const answer = await ask();

    const byId = new Map((answer.body.achievements as Row[]).map((view) => [view.id, view]));
    expect(byId.get(12)).toMatchObject({ status: "earned" });
    expect(byId.get(7)).toMatchObject({ status: "earned" });
    expect(db.reads).toContain("outposts");
  });

  test("an unknown, banned or yardless player, or a bad id, is 404", async () => {
    const cases: [Row | null, unknown][] = [
      [null, { userid: "3001" }],
      [userOf({ banned: true }), { userid: "3001" }],
      [userOf({ save: null }), { userid: "3001" }],
      [userOf(), { userid: "abc" }],
      [userOf(), { userid: "-4" }],
      [userOf(), {}],
    ];
    for (const [user, params] of cases) {
      db.user = user;
      const answer = await ask(params);
      expect(answer.status).toBe(404);
      expect(answer.body).toEqual({ error: "That player could not be found.", reason: "notFound" });
    }
  });
});
