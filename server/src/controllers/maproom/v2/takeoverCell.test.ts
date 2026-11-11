import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  memoryWelcomeStore,
  MR2_WELCOME_SECONDS,
  newWelcome,
  useWelcomeStore,
  welcomeStatus,
} from "../../../services/events/mr2Welcome.js";
import { utcDay } from "../../../services/events/schedule.js";
import { quoteTakeover } from "../../../services/maproom/v2/takeoverCost.js";
import { STARTER_KITS } from "../../../game-data/starterKits.js";
import { kitBuildings } from "../../../services/yard/starterKit.js";
import type { Context } from "koa";
import { achievementConfig } from "../../../config/AchievementConfig.js";
import { devConfig } from "../../../config/GameConfig.js";
import { readAchievements } from "../../../services/achievements/state.js";
import { setMonsterMadnessRuns } from "../../../services/events/monsterMadnessRuns.js";
import { memoryProgressStore, sqlProgressStore } from "../../../services/events/progressStore.js";
import { useTakeoverStore } from "../../../services/events/takeoverEvents.js";

/**
 * `POST /worldmapv2/takeoverCell` (issue #182). The route took any cell at 90%
 * damage whatever its protection, lock or wild-camp regeneration said. These
 * drive the controller over an in-memory stand-in for the rows it reads, with
 * Redis as a map so the takeover grants (`takeoverGrant.ts`) are real.
 */

const TAKER = 2505;
const OWNER = 77;
const WORLD = "world-a";
const OUTPOST = "2000240208";
const CAMP = "2000242208";

type Row = Record<string, unknown>;

let takerSave: Row;
let ownerSave: Row;
let cells: Row[];
let flushed: number;
let sessions: Set<number>;
let inRange: boolean;
/** Rows the takeover created: the mailbox notice to the previous owner (#187). */
let created: Row[];
/** Bell rows the takeover wrote (achievements, #204). */
let bell: Row[];

const store = new Map<string, string>();
const GRANT_KEY = "takeover-grant:900";
/** A user's alliance, for `invalidateSight`'s bare-userid form (the previous owner). */
let allianceOf: Map<number, number | null>;
/** Keys dropped via Redis, in call order (issue #329, #330 WP1). */
let delCalls: string[];
let welcome: ReturnType<typeof memoryWelcomeStore>;

const now = () => Math.floor(Date.now() / 1000);

/** The grant an attack by `attackerid` leaves on the outpost, and the protection that goes with it. */
const grantTo = (attackerid: number, expiresAt = now() + 600) => {
  store.set(GRANT_KEY, JSON.stringify({ attackerid, basesaveid: 900, baseid: OUTPOST, expiresAt }));
  (cells[0]!.save as Row).protected = expiresAt + 8 * 3600;
};

const cellRow = (baseid: string, uid: number, base_type: number, save: Row): Row => ({
  baseid,
  uid,
  x: 240,
  y: 208,
  base_type,
  map_version: 2,
  world: { uuid: WORLD, name: "World" },
  save: { baseid, attackid: 0, attacks: [], protected: 0, locked: 0, wmid: 0, savetime: now() - 60, ...save },
});

const saves = () => [takerSave, ownerSave, ...cells.map((cell) => cell.save as Row)];

const txEm = {
  findOne: async (_entity: unknown, where: Row) =>
    saves().find((save) => Object.entries(where).every(([key, value]) => save[key] === value)) ?? null,
  find: async () => [],
  create: (_entity: unknown, data: Row) => {
    created.push(data);
    return data;
  },
  insertMany: async (_entity: unknown, rows: Row[]) => {
    bell.push(...rows);
  },
  nativeDelete: async () => 0,
  getConnection: () => ({ execute: async () => [] }),
  count: async () => 1,
  nativeUpdate: async () => 1,
  persist: () => {},
  flush: async () => {
    flushed += 1;
  },
};

mock.module("../../../server.js", () => ({
  postgres: {
    em: {
      populate: async (user: Row) => {
        user.save = takerSave;
      },
      findOne: async (_entity: unknown, where: Row) =>
        "baseid" in where
          ? (cells.find((cell) => cell.baseid === where.baseid && where.world === WORLD) ?? null)
          // `invalidateSight`'s `allianceIdOf`, looking up the previous owner by bare userid.
          : { userid: where.userid, alliance_id: allianceOf.get(where.userid as number) ?? null },
      // A taker (or previous owner) with an alliance makes `runningPowerups`
      // read it (`services/alliance/powerups.ts`'s `alliancePowerup`); no
      // powerup row is ever seeded, so every alliance's three come back idle.
      find: async () => [],
      create: (_entity: unknown, data: Row) => data,
      persist: () => {},
      flush: async () => {},
      transactional: async (run: (em: typeof txEm) => Promise<unknown>) => run(txEm),
    },
  },
  redis: {
    get: async (key: string) => store.get(key) ?? null,
    setex: async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return "OK";
    },
    del: async (key: string) => {
      delCalls.push(key);
      return store.delete(key) ? 1 : 0;
    },
  },
}));

mock.module("../../../services/maproom/v2/validateRange.js", () => ({
  validateRange: async () => {
    if (!inRange) throw new Error("out of range");
  },
  rangeCheckV2: async () => ({
    cell: null,
    verdict: inRange ? { ok: true, via: "main" } : { ok: false, reason: "out-of-range" },
  }),
}));

mock.module("../../../services/base/attackSessionStore.js", () => ({
  startAttackSession: async () => {},
  readAttackSession: async (basesaveid: number) =>
    sessions.has(basesaveid) ? { attackerid: OWNER, attackid: 1, startedat: 0 } : null,
  endAttackSession: async () => {},
}));

const { takeoverCell } = await import("./takeoverCell.js");

const run = async (body: Row, takerAllianceId: number | null = null) => {
  const ctx = {
    authUser: { userid: TAKER, username: "taker", alliance_id: takerAllianceId },
    request: { body },
  } as unknown as Context;
  try {
    await takeoverCell(ctx, async () => {});
    return { ok: true as const, body: ctx.body as Row, reason: undefined };
  } catch (caught) {
    return { ok: false as const, body: undefined, reason: (caught as { data?: { reason?: string } }).data?.reason };
  }
};

const outpost = () => cells[0]!.save as Row;
const camp = () => cells[1]!.save as Row;
const takerResources = () => takerSave.resources as Record<string, number>;

beforeEach(() => {
  takerSave = {
    basesaveid: 2526,
    userid: TAKER,
    saveuserid: TAKER,
    type: "main",
    name: "taker",
    homebaseid: 2000241207,
    homebase: ["100", "100"],
    worldid: WORLD,
    credits: 5000,
    resources: { r1: 100_000_000, r2: 100_000_000, r3: 100_000_000, r4: 100_000_000 },
    outposts: [],
  };
  ownerSave = {
    basesaveid: 700,
    userid: OWNER,
    saveuserid: OWNER,
    type: "main",
    outposts: [[240, 208, OUTPOST]],
    buildingresources: { [`b${OUTPOST}`]: {} },
  };
  cells = [
    cellRow(OUTPOST, OWNER, 3, {
      basesaveid: 900,
      userid: OWNER,
      saveuserid: OWNER,
      type: "outpost",
      damage: 92,
      // A Regular Starter Kit, worth 3,222,316: 10,000,000 of each
      // (outpostValue.test.ts). The stored 10,000,000 would price at
      // 28,000,000; the server never reads it.
      buildingdata: kitBuildings(STARTER_KITS[0]!, "shiny", {}).buildingdata,
      empirevalue: 10_000_000,
    }),
    cellRow(CAMP, 0, 1, { basesaveid: 901, userid: 0, saveuserid: 0, type: "tribe", damage: 95, wmid: 41 }),
  ];
  flushed = 0;
  created = [];
  bell = [];
  achievementConfig.rewards = false;
  sessions = new Set();
  inRange = true;
  store.clear();
  allianceOf = new Map();
  delCalls = [];
  // By default the taker has just destroyed the outpost and holds its grant.
  grantTo(TAKER);
  // "New to Map Room 2": no window unless a test opens one.
  welcome = memoryWelcomeStore(0);
  useWelcomeStore(welcome);
});

const startingRewards = achievementConfig.rewards;
afterEach(() => {
  achievementConfig.rewards = startingRewards;
});

describe("takeoverCell", () => {
  test("the grant holder takes the outpost: priced by the server, 12 hours protection, grant spent", async () => {
    const result = await run({ baseid: OUTPOST, resources: JSON.stringify({ r1: 1, r2: 1, r3: 1, r4: 1 }) });
    expect(result.body).toEqual({ error: 0 });
    expect(store.has(GRANT_KEY)).toBe(false);
    expect(outpost().protected as number).toBeLessThanOrEqual(now() + 12 * 3600);
    // Its Regular Kit prices it at 10,000,000 of each, not its stored empirevalue.
    expect(takerResources()).toEqual({ r1: 90_000_000, r2: 90_000_000, r3: 90_000_000, r4: 90_000_000 });
    expect(outpost()).toMatchObject({ userid: TAKER, saveuserid: TAKER, name: "taker" });
    expect(outpost().protected as number).toBeGreaterThan(now() + 11 * 3600);
    expect(cells[0]).toMatchObject({ uid: TAKER, base_type: 3 });
    expect(takerSave.outposts).toEqual([[240, 208, OUTPOST]]);
    expect(ownerSave.outposts).toEqual([]);
    expect(ownerSave.buildingresources).toEqual({});
    // The takeover's writes, and the previous owner's notice with them (#187).
    expect(flushed).toBe(2);
  });

  test("the previous owner, and only they, is told who took the outpost (#187)", async () => {
    await run({ baseid: OUTPOST, resources: "{}" });
    expect(created).toEqual([
      expect.objectContaining({
        userid: 0,
        targetid: OWNER,
        messagetype: "outposttaken",
        subject: "taker took your outpost at (240, 208)",
        targetUnread: 1,
        userUnread: 0,
        coords: [240, 208],
        baseid: OUTPOST,
      }),
    ]);
  });

  test("taking a wild camp tells nobody", async () => {
    await run({ baseid: CAMP, shiny: "1" });
    expect(created).toEqual([]);
  });

  test("a destroyed wild camp is taken for Shiny and becomes an outpost", async () => {
    const result = await run({ baseid: CAMP, shiny: "1" });
    expect(result.ok).toBe(true);
    expect(takerSave.credits as number).toBeLessThan(5000);
    expect(camp()).toMatchObject({ type: "outpost", wmid: 0, userid: TAKER });
  });

  const refused = async (body: Row, reason: string) => {
    const result = await run(body);
    expect(result.reason).toBe(reason);
    expect(flushed).toBe(0);
    expect(takerResources().r1).toBe(100_000_000);
    expect(takerSave.credits).toBe(5000);
    expect(outpost().userid).toBe(OWNER);
    expect(camp().userid).toBe(0);
  };

  test("only once: a second takeover by the same player finds the outpost already theirs", async () => {
    expect((await run({ baseid: OUTPOST })).ok).toBe(true);
    flushed = 0;
    const again = await run({ baseid: OUTPOST });
    expect(again.reason).toBe("ownYard");
    expect(flushed).toBe(0);
  });

  test("another player's grant gives this taker nothing", async () => {
    grantTo(OWNER + 1);
    await refused({ baseid: OUTPOST }, "noTakeoverChance");
    expect(store.has(GRANT_KEY)).toBe(true);
  });

  test("no grant: a destroyed outpost cannot be taken, protected or not", async () => {
    store.clear();
    await refused({ baseid: OUTPOST }, "noTakeoverChance");
    outpost().protected = 0;
    await refused({ baseid: OUTPOST }, "noTakeoverChance");
  });

  test("a grant that has run out is no chance: the protection it left stands", async () => {
    grantTo(TAKER, now() - 1);
    await refused({ baseid: OUTPOST }, "noTakeoverChance");
    expect(outpost().protected as number).toBeGreaterThan(now() + 7 * 3600);
  });

  test("an outpost locked by someone else is refused", async () => {
    outpost().locked = 1;
    await refused({ baseid: OUTPOST }, "locked");
  });

  test("an outpost under attack is refused", async () => {
    sessions.add(900);
    await refused({ baseid: OUTPOST }, "underAttack");
  });

  test("an outpost short of 90% damage is refused", async () => {
    outpost().damage = 89;
    await refused({ baseid: OUTPOST }, "notDestroyed");
  });

  test("a wild camp past its 12-hour regeneration is refused", async () => {
    camp().savetime = now() - 12 * 3600 - 10;
    await refused({ baseid: CAMP }, "regenerated");
  });

  test("the taker's own outpost is refused", async () => {
    Object.assign(outpost(), { userid: TAKER, saveuserid: TAKER });
    (cells[0] as Row).uid = TAKER;
    const result = await run({ baseid: OUTPOST });
    expect(result.reason).toBe("ownYard");
    expect(flushed).toBe(0);
  });

  test("a main yard is refused", async () => {
    Object.assign(outpost(), { type: "main" });
    (cells[0] as Row).base_type = 2;
    await refused({ baseid: OUTPOST }, "mainYard");
  });

  test("a cell outside the taker's world, or unknown, is refused", async () => {
    await refused({ baseid: "999" }, "notFound");
  });

  test("out of range is refused before anything is written", async () => {
    inRange = false;
    const result = await run({ baseid: OUTPOST });
    expect(result.ok).toBe(false);
    expect(flushed).toBe(0);
  });

  test("a zero or negative price is not honoured: the server's price is charged", async () => {
    const result = await run({ baseid: OUTPOST, shiny: "-99", resources: JSON.stringify({ r1: -1e9, r2: -1e9, r3: -1e9, r4: -1e9 }) });
    expect(result.ok).toBe(true);
    expect(takerResources().r1).toBe(90_000_000);
    expect(takerSave.credits).toBe(5000);
  });

  test("a taker who cannot pay is refused", async () => {
    takerResources().r2 = 9_999_999;
    const result = await run({ baseid: OUTPOST });
    expect(result.reason).toBe("notEnoughResources");
    expect(flushed).toBe(0);
    expect(outpost().userid).toBe(OWNER);

    takerSave.credits = 10;
    const shiny = await run({ baseid: OUTPOST, shiny: "1" });
    expect(shiny.reason).toBe("notEnoughShiny");
    expect(takerSave.credits).toBe(10);
  });
});

describe("takeoverCell achievements (#204)", () => {
  /**
   * A record already worked out, so a test sees only the takeover's unlocks:
   * "Hoarder", which the taker's 100 million of each already earns, seen.
   */
  const HOARDER = { "15": { at: 1, shiny: 25, seen: 1 } };
  const backfilled = (s: Row = {}) => ({ v: 1, s, c: { ...HOARDER }, backfilledAt: 1 });
  const record = () => readAchievements(takerSave);

  test("a wild camp counts towards Camp Crusher; owed while rewards are off, so the answer is plain", async () => {
    takerSave.achievements = backfilled();
    const result = await run({ baseid: CAMP, shiny: "1" });
    expect(result.body).toEqual({ error: 0 });
    expect(record().s.wmoutpost).toBe(1);
    expect(record().s.playeroutpost).toBe(0);
    expect(record().c["7"]).toMatchObject({ shiny: 10, unpaid: 1 });
    expect(bell).toEqual([]);
  });

  test("with rewards on the takeover pays the Shiny and its answer carries the unlock", async () => {
    achievementConfig.rewards = true;
    takerSave.achievements = backfilled();
    takerSave.credits = 10_000_000;
    const result = await run({ baseid: CAMP, shiny: "1" });
    expect(result.body).toEqual({ error: 0, achievements: [{ id: 7, name: "Camp Crusher", shiny: 10 }] });
    expect(takerSave.credits as number).toBeLessThan(10_000_000);
    expect(bell).toEqual([expect.objectContaining({ userid: TAKER, kind: "achievement" })]);
  });

  test("a player's outpost counts towards Empire Builder, one each", async () => {
    takerSave.achievements = backfilled({ playeroutpost: 3 });
    const result = await run({ baseid: OUTPOST });
    expect(result.ok).toBe(true);
    expect(record().s.playeroutpost).toBe(4);
    expect(record().s.wmoutpost).toBe(0);
    expect(record().c["8"]).toBeUndefined();
  });

  test("the fifth player outpost unlocks Empire Builder", async () => {
    achievementConfig.rewards = true;
    takerSave.achievements = backfilled({ playeroutpost: 4 });
    const result = await run({ baseid: OUTPOST });
    expect(result.body).toEqual({ error: 0, achievements: [{ id: 8, name: "Empire Builder", shiny: 20 }] });
  });

  test("a record never worked out: the takeover is a live unlock, not the backfill's", async () => {
    achievementConfig.rewards = true;
    const result = await run({ baseid: CAMP, shiny: "1" });
    // The backfill finds "Hoarder" in the taker's resources; the camp is the takeover's own.
    expect(result.body?.achievements).toEqual([
      { id: 7, name: "Camp Crusher", shiny: 10 },
      { id: 15, name: "Hoarder", shiny: 25, backfill: true },
    ]);
    expect(record().backfilledAt).toBeDefined();
  });

  test("a refused takeover counts nothing", async () => {
    takerSave.achievements = backfilled();
    camp().damage = 10;
    expect((await run({ baseid: CAMP, shiny: "1" })).ok).toBe(false);
    expect(record().s.wmoutpost).toBe(0);
  });
});

/**
 * A takeover changes `save.outposts` for both the taker and the previous
 * owner, which also feeds each one's alliance's shared union — so both drop
 * `invalidateSight`, not just `invalidatePlayerSight` (a bug fixed alongside
 * issue #329, #330 WP1's named gaps; a wild camp has no previous owner).
 */
describe("sight cache invalidation (#329, #330 WP1)", () => {
  test("the taker's own cache drops; their alliance's too, if they have one", async () => {
    expect((await run({ baseid: OUTPOST }, 42)).ok).toBe(true);

    expect(delCalls).toContain(`sight:${TAKER}`);
    expect(delCalls).toContain("sight:ally:42");
  });

  test("a taker with no alliance drops only their own cache", async () => {
    expect((await run({ baseid: OUTPOST })).ok).toBe(true);

    expect(delCalls).toContain(`sight:${TAKER}`);
    expect(delCalls.some((key) => key.startsWith("sight:ally:"))).toBe(false);
  });

  test("the previous owner's own cache drops; their alliance's too, if they have one", async () => {
    allianceOf.set(OWNER, 99);

    expect((await run({ baseid: OUTPOST })).ok).toBe(true);

    expect(delCalls).toContain(`sight:${OWNER}`);
    expect(delCalls).toContain("sight:ally:99");
  });

  test("taking an unowned wild camp drops only the taker's cache", async () => {
    expect((await run({ baseid: CAMP, shiny: "1" })).ok).toBe(true);

    expect(delCalls).toEqual([`sight:${TAKER}`]);
  });
});

describe("takeoverCell: New to Map Room 2", () => {
  const openWindow = () => welcome.rows.set(TAKER, newWelcome(now() - 60));
  const fullBase = () =>
    quoteTakeover({ cell: { x: 240, y: 208 }, isWildMonster: true, buildingdata: null, takerHomebase: null, conquestActive: false })
      .resources;

  test("a wild camp while today's takeover is ready costs 10% of its full base price, and uses it", async () => {
    openWindow();
    const result = await run({ baseid: CAMP });
    expect(result.ok).toBe(true);
    const cheap = Math.round(fullBase() * 0.1);
    expect(takerResources()).toEqual({
      r1: 100_000_000 - cheap,
      r2: 100_000_000 - cheap,
      r3: 100_000_000 - cheap,
      r4: 100_000_000 - cheap,
    });
    expect(welcome.rows.get(TAKER)!.takeoverUses).toHaveLength(1);
  });

  test("a client that posts a lower figure is still charged the server's price", async () => {
    openWindow();
    await run({ baseid: CAMP, resources: JSON.stringify({ r1: 1, r2: 1, r3: 1, r4: 1 }) });
    expect(takerResources().r1).toBe(100_000_000 - Math.round(fullBase() * 0.1));
  });

  const usualShiny = () =>
    quoteTakeover({
      cell: { x: 240, y: 208 },
      isWildMonster: true,
      buildingdata: null,
      takerHomebase: takerSave.homebase as string[],
      conquestActive: false,
    }).shiny;

  // Owner, 11 Nov: "Paying shiny should not count as it is not discounted".
  test("paid with Shiny: the usual Shiny price, and today's takeover is not used", async () => {
    openWindow();
    expect((await run({ baseid: CAMP, shiny: "1" })).ok).toBe(true);
    expect(takerSave.credits).toBe(5000 - usualShiny());
    expect(takerResources().r1).toBe(100_000_000);
    expect(welcome.rows.get(TAKER)!.takeoverUses).toHaveLength(0);
    const status = welcomeStatus(welcome.rows.get(TAKER)!, now())!;
    expect(status.takeover).toBe(true);
    expect(status.takeoverLeft).toBe(7);
    expect(status.takeoverToday).toBe(false);
  });

  test("paid with Shiny after 2 earlier sets: still 5 of 7 left and ready today", async () => {
    const twoDaysAgo = now() - 2 * 86_400;
    const before = { ...newWelcome(twoDaysAgo - 60), takeoverUses: [twoDaysAgo - 30, twoDaysAgo], takeoverDay: utcDay(twoDaysAgo) };
    welcome.rows.set(TAKER, before);
    expect((await run({ baseid: CAMP, shiny: "1" })).ok).toBe(true);
    expect(takerSave.credits).toBe(5000 - usualShiny());
    expect(welcome.rows.get(TAKER)).toEqual(before);
    const status = welcomeStatus(welcome.rows.get(TAKER)!, now())!;
    expect(status.takeover).toBe(true);
    expect(status.takeoverLeft).toBe(5);
    expect(status.takeoverToday).toBe(false);
  });

  test("a player outpost never uses it, and is charged in full", async () => {
    openWindow();
    expect((await run({ baseid: OUTPOST })).ok).toBe(true);
    expect(takerResources().r1).toBe(90_000_000);
    expect(welcome.rows.get(TAKER)!.takeoverUses).toHaveLength(0);
  });

  test("today's already used: the usual price, and nothing more is used", async () => {
    welcome.rows.set(TAKER, { ...newWelcome(now() - 60), takeoverUses: [now() - 30], takeoverDay: utcDay(now()) });
    await run({ baseid: CAMP });
    expect(takerResources().r1).toBe(100_000_000 - fullBase());
    expect(welcome.rows.get(TAKER)!.takeoverUses).toHaveLength(1);
  });

  test("used on an earlier day: today's is cheap again, the 2nd of 7", async () => {
    const twoDaysAgo = now() - 2 * 86_400;
    welcome.rows.set(TAKER, { ...newWelcome(twoDaysAgo - 60), takeoverUses: [twoDaysAgo], takeoverDay: utcDay(twoDaysAgo) });
    await run({ baseid: CAMP });
    expect(takerResources().r1).toBe(100_000_000 - Math.round(fullBase() * 0.1));
    expect(welcome.rows.get(TAKER)!.takeoverUses).toHaveLength(2);
  });

  test("all 7 used: the usual price", async () => {
    const start = now() - 8 * 86_400;
    welcome.rows.set(TAKER, { ...newWelcome(start), takeoverUses: [1, 2, 3, 4, 5, 6, 7], takeoverDay: utcDay(start) });
    await run({ baseid: CAMP });
    expect(takerResources().r1).toBe(100_000_000 - fullBase());
  });

  test("after the 10 days the price is the usual one", async () => {
    welcome.rows.set(TAKER, newWelcome(now() - MR2_WELCOME_SECONDS - 1));
    await run({ baseid: CAMP });
    expect(takerResources().r1).toBe(100_000_000 - fullBase());
  });

  test("a refused takeover does not charge the cheap price", async () => {
    openWindow();
    takerSave.resources = { r1: 10, r2: 10, r3: 10, r4: 10 };
    const result = await run({ baseid: CAMP });
    expect(result.reason).toBe("notEnoughResources");
  });
});

describe("takeoverCell: Monster Madness points", () => {
  let progress: ReturnType<typeof memoryProgressStore>;

  beforeEach(() => {
    progress = memoryProgressStore();
    useTakeoverStore(progress);
    takerSave.tutorialstage = 205;
  });

  afterEach(() => {
    setMonsterMadnessRuns([]);
    useTakeoverStore(sqlProgressStore);
  });

  const startRun = () => {
    const startsAt = now() - 60;
    setMonsterMadnessRuns([{ startsAt, endsAt: startsAt + 4 * 86_400 }]);
    return `monster-madness-${startsAt}`;
  };

  test("off (no run started): the answer carries no points", async () => {
    const result = await run({ baseid: OUTPOST });
    expect(result.body).toEqual({ error: 0 });
    expect(progress.rows.size).toBe(0);
  });

  test("a player's outpost scores its empire value, and the answer says so", async () => {
    const event = startRun();
    const result = await run({ baseid: OUTPOST });
    // The Regular Starter Kit's value (outpostValue.test.ts).
    expect(result.body).toEqual({ error: 0, eventPoints: [{ event, points: 3_222_316, total: 3_222_316 }] });
  });

  test("a wild camp scores by its level; the total grows across takeovers", async () => {
    const event = startRun();
    await run({ baseid: OUTPOST });
    const result = await run({ baseid: CAMP, shiny: "1" });
    const points = (result.body!.eventPoints as { points: number }[])[0]!.points;
    expect(points).toBeGreaterThan(0);
    expect(result.body!.eventPoints).toEqual([{ event, points, total: 3_222_316 + points }]);
  });

  test("a player still in the guided start scores nothing", async () => {
    startRun();
    takerSave.tutorialstage = 10;
    const skip = devConfig.skipTutorial;
    devConfig.skipTutorial = false;
    try {
      const result = await run({ baseid: OUTPOST });
      expect(result.body).toEqual({ error: 0 });
    } finally {
      devConfig.skipTutorial = skip;
    }
  });

  test("a refused takeover scores nothing", async () => {
    startRun();
    inRange = false;
    const result = await run({ baseid: OUTPOST });
    expect(result.ok).toBe(false);
    expect(progress.rows.size).toBe(0);
  });
});
