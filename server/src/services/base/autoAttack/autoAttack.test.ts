import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Auto-attack (issue #221), run for real — the plan, the checks, the
 * checkpoint, the finaliser's landing and its replay — against an in-memory
 * Redis and stand-in rows. The attack load's minting (`baseModeAttack`) and
 * the range check are stood in for: both have tests of their own.
 */

const SANDBOX = fileURLToPath(new URL("../../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url));
const sandbox = JSON.parse(readFileSync(SANDBOX, "utf8"));

const ATTACKER = 2505;
const CAMP_OWNER = 0;
const BASESAVEID = 88;
const WORLD = "w-1";
const HOME = "1000241207";
const CAMP = "1000241208";
const REPLAY_TIMEOUT_MS = 60_000;
const now = () => Math.floor(Date.now() / 1000);

/* ── Redis, in memory ───────────────────────────────────────────────────── */

const store = new Map<string, string>();
const sets = new Map<string, Set<string>>();
const fakeRedis = {
  get: async (key: string) => store.get(key) ?? null,
  setex: async (key: string, _ttl: number, value: string) => {
    store.set(key, value);
    return "OK";
  },
  set: async (key: string, value: string, ...options: string[]) => {
    if (options.includes("NX") && store.has(key)) return null;
    store.set(key, value);
    return "OK";
  },
  del: async (key: string) => (store.delete(key) ? 1 : 0),
  sadd: async (key: string, member: string) => {
    const set = sets.get(key) ?? new Set<string>();
    set.add(member);
    sets.set(key, set);
    return 1;
  },
  srem: async (key: string, member: string) => (sets.get(key)?.delete(member) ? 1 : 0),
  smembers: async (key: string) => [...(sets.get(key) ?? [])],
};

/* ── Rows ───────────────────────────────────────────────────────────────── */

const PLAN = {
  v: 1,
  tick: 20_000,
  events: [
    { kind: "fling", t: 480, x: -615, y: 115, r: 300, monsters: { C1: 150 }, champion: { t: 5, l: 3 } },
    { kind: "bomb", t: 800, x: 180, y: -480, id: "pb1" },
    { kind: "retreat", t: 16_000 },
  ],
};

let camp: Record<string, any>;
let userSave: Record<string, any>;
let planRow: Record<string, any> | null;
const flush = mock(async () => {});
const upsert = mock(async () => {});
const mint = mock(async () => {});

const reset = () => {
  store.clear();
  sets.clear();
  flush.mockClear();
  upsert.mockClear();
  mint.mockClear();
  camp = {
    basesaveid: BASESAVEID,
    baseid: CAMP,
    saveuserid: CAMP_OWNER,
    type: "tribe",
    wmid: 11,
    level: 35,
    worldid: WORLD,
    attackid: 0,
    attacks: [],
    protected: 0,
    savetime: now() - 60,
    damage: 12,
    buildingdata: structuredClone(sandbox.buildingdata),
    buildinghealthdata: {},
    resources: { r1: 5_000_000, r2: 5_000_000, r3: 5_000_000, r4: 5_000_000 },
  };
  userSave = {
    baseid: HOME,
    worldid: WORLD,
    mapversion: 2,
    catapult: 2,
    buildingdata: {},
    outposts: [],
    resources: { r1: 1_000_000, r2: 1_000_000, r3: 1_000_000, r4: 1_000_000 },
    monsters: { housed: { C1: 200 }, space: 400 },
    academy: { C1: { level: 3 } },
    champion: [{ t: 5, l: 5, hp: 62000, status: 0 }],
    siege: null,
  };
  planRow = { userid: ATTACKER, wmid: 11, level: 35, slot: "last", baseid: "1000240208", plan: PLAN, recorded_at: new Date() };
};
reset();

const user = () => ({ userid: ATTACKER, username: "agenttester", alliance_id: null, save: userSave });

mock.module("../../../server.js", () => ({
  redis: fakeRedis,
  postgres: {
    orm: { em: {} },
    em: {
      findOne: async (entity: { name: string }, where: Record<string, unknown>) => {
        if (entity.name === "User") return where.userid === ATTACKER ? user() : null;
        if (entity.name === "AttackPlanRow") {
          return planRow && where.userid === planRow.userid && where.wmid === planRow.wmid && where.level === planRow.level
            ? planRow
            : null;
        }
        return where.basesaveid === BASESAVEID || where.baseid === camp.baseid ? camp : null;
      },
      find: async () => [],
      populate: async () => {},
      persist: () => {},
      remove: () => {},
      upsert,
      flush,
    },
  },
}));

const core = await import("@mikro-orm/core");
mock.module("@mikro-orm/core", () => ({
  ...core,
  RequestContext: { ...core.RequestContext, create: (_em: unknown, next: () => unknown) => next() },
}));

mock.module("../../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

mock.module("../../alliance/powerups.js", () => ({
  runningPowerups: async () => [],
  isDeclareWarRunning: async () => false,
}));

// Bun keeps a module mock for every file that runs after this one, so each
// stand-in below hands over to the real module once this file is done.
let standIn = true;
afterAll(() => {
  standIn = false;
});

// The query makes each a real module no mock replaces; held in a constant so
// the type checker does not try to resolve it.
const REAL = {
  range: "../../maproom/v2/validateRange.ts?real",
  mapSaveData: "../mapSaveData.ts?real",
  load: "../../../controllers/base/load/modes/baseModeAttack.ts?real",
  runner: "../combat/replayRunner.ts?real",
};

// Other files leave a stand-in session store behind, so this file puts back
// one that works as the real store does, over whichever Redis `server.js`
// holds at the time (this file's, or a later file's own).
const { attackSessionKey, parseAttackSession, serialiseAttackSession } = await import("../attackSession.js");
const redisNow = async () => (await import("../../../server.js")).redis as unknown as typeof fakeRedis;
mock.module("../attackSessionStore.js", () => ({
  startAttackSession: async (basesaveid: number, session: Parameters<typeof serialiseAttackSession>[0]) => {
    await (await redisNow()).setex(attackSessionKey(basesaveid), 480, serialiseAttackSession(session));
  },
  readAttackSession: async (basesaveid: number) =>
    parseAttackSession(await (await redisNow()).get(attackSessionKey(basesaveid))),
  endAttackSession: async (basesaveid: number) => {
    await (await redisNow()).del(attackSessionKey(basesaveid));
  },
}));

const realRange = (await import(REAL.range)) as typeof import("../../maproom/v2/validateRange.js");
let inRange = true;
mock.module("../../maproom/v2/validateRange.js", () => ({
  ...realRange,
  validateRange: async (...args: Parameters<typeof realRange.validateRange>) => {
    if (!standIn) return realRange.validateRange(...args);
    if (!inRange) throw new Error("out of range");
  },
  rangeCheckV2: async (...args: Parameters<typeof realRange.rangeCheckV2>) =>
    standIn
      ? { cell: null, verdict: inRange ? { ok: true } : { ok: false, reason: "out-of-range" } }
      : realRange.rangeCheckV2(...args),
}));

const realMapSaveData = (await import(REAL.mapSaveData)) as typeof import("../mapSaveData.js");
mock.module("../mapSaveData.js", () => ({
  ...realMapSaveData,
  mapSaveData: async (...args: Parameters<typeof realMapSaveData.mapSaveData>) => {
    if (!standIn) return realMapSaveData.mapSaveData(...args);
    const save = args[0] as unknown as Record<string, unknown>;
    return {
      baseid: save.baseid,
      type: save.type,
      buildingdata: save.buildingdata,
      buildinghealthdata: save.buildinghealthdata,
    };
  },
}));

// The attack load's minting, as `baseModeAttack` does it for a camp: the
// attackid on the row, and a session recording what the player houses.
const realLoad = (await import(REAL.load)) as typeof import("../../../controllers/base/load/modes/baseModeAttack.js");
mock.module("../../../controllers/base/load/modes/baseModeAttack.js", () => ({
  ...realLoad,
  baseModeAttack: async (...args: Parameters<typeof realLoad.baseModeAttack>) => {
    if (!standIn) return realLoad.baseModeAttack(...args);
    await mint();
    camp.attackid = 4242;
    camp.attacks.push({ starttime: now() });
    store.set(
      attackSessionKey(BASESAVEID),
      JSON.stringify({
        attackerid: ATTACKER,
        attackid: 4242,
        startedat: now(),
        entryHoused: { [HOME]: { ...userSave.monsters.housed } },
        defenderResources: camp.resources,
        attackerResources: userSave.resources,
        attackerlevel: 40,
      })
    );
    return { save: camp, defenderForces: undefined } as never;
  },
}));

const runner = (await import(REAL.runner)) as typeof import("../combat/replayRunner.js");
let slotFree = true;
mock.module("../combat/replayRunner.js", () => ({
  ...runner,
  reserveReplaySlot: async (...args: Parameters<typeof runner.reserveReplaySlot>) => {
    if (!standIn) return runner.reserveReplaySlot(...args);
    return slotFree ? () => {} : null;
  },
}));

const { runAutoAttack, autoAttackPlanFor, lastAutoAttackReplay, autoAttackLockKey } = await import("./autoAttack.js");
const { attackCheckpointKey } = await import("../attackCheckpoint.js");

beforeEach(() => {
  reset();
  inRange = true;
  slotFree = true;
});

/** The refusal's reason, from a `ClientSafeError`. */
const refusal = async (run: Promise<unknown>): Promise<{ reason?: string; missing?: unknown[] } & Record<string, unknown>> => {
  try {
    await run;
  } catch (err) {
    return { ...((err as { data?: object }).data ?? {}), message: (err as Error).message };
  }
  throw new Error("expected a refusal");
};

/** Nothing written: the camp free, the army and the pool as they were. */
const nothingWritten = () => {
  expect(mint).not.toHaveBeenCalled();
  expect(flush).not.toHaveBeenCalled();
  expect(camp.attackid).toBe(0);
  expect(userSave.monsters.housed).toEqual({ C1: 200 });
  expect(userSave.resources).toEqual({ r1: 1_000_000, r2: 1_000_000, r3: 1_000_000, r4: 1_000_000 });
  expect(store.has(autoAttackLockKey(ATTACKER))).toBe(false);
};

describe("runAutoAttack lands the plan", () => {
  test("monsters spent, bomb charged, loot banked, the camp's damage kept, and the result says so", async () => {
    // Room in storage for the loot: no silos is a cap of 10,000, and twigs are empty.
    userSave.resources = { r1: 0, r2: 1_000_000, r3: 0, r4: 0 };
    const result = await runAutoAttack(user() as never, CAMP);

    // The attacker: 150 Pokeys spent, the pebble bomb's 100,000 charged, the loot banked.
    expect(userSave.monsters.housed).toEqual({ C1: 50 });
    expect(result.loot.r1).toBeGreaterThan(0);
    expect(userSave.resources.r1).toBe(result.loot.r1);
    // Pebbles stay over the cap after the bomb, so take nothing.
    expect(result.loot.r2).toBe(0);
    expect(userSave.resources.r2).toBe(900_000);
    // The camp lost at least what was banked.
    expect(5_000_000 - camp.resources.r1).toBeGreaterThanOrEqual(result.loot.r1);
    expect(result.flung).toEqual({ C1: 150 });
    expect(result.bombs).toEqual(["pb1"]);
    expect(result.champions).toEqual([{ t: 5, hp: userSave.champion[0].hp }]);

    // The camp: damage added on top of what it had, the attack over.
    expect(result.damageBefore).toBe(12);
    expect(result.damageAfter).toBe(camp.damage);
    expect(camp.damage).toBeGreaterThan(12);
    expect(result.damageAdded).toBe(camp.damage - 12);
    expect(result.conquered).toBe(camp.damage >= 90);
    expect(camp.attackid).toBe(0);
    expect(camp.resources.r1).toBeLessThan(5_000_000);
    expect(camp.attackreport).not.toContain("Left the attack");

    // Nothing left behind: no checkpoint, no session, no lock.
    expect(store.has(attackCheckpointKey(BASESAVEID))).toBe(false);
    expect(store.has(attackSessionKey(BASESAVEID))).toBe(false);
    expect(store.has(autoAttackLockKey(ATTACKER))).toBe(false);
    // An auto-attack never becomes the plan.
    expect(upsert).not.toHaveBeenCalled();

    expect(result.plan).toMatchObject({
      tribe: "Kozu",
      level: 35,
      recordedOn: { baseid: "1000240208", x: 240, y: 208 },
      monsters: { C1: 150 },
      champions: [{ t: 5, l: 5 }],
      bombs: ["pb1"],
      siege: false,
    });
  }, REPLAY_TIMEOUT_MS);

  test("keeps the battle for Watch: the plan under a fresh seed, retreat included, to the plan's tick", async () => {
    await runAutoAttack(user() as never, CAMP);
    const replay = (await lastAutoAttackReplay(ATTACKER))!;
    expect(replay.baseid).toBe(CAMP);
    expect(replay.tick).toBe(20_000);
    expect(replay.events.map((event) => (event as { kind: string }).kind)).toEqual(["fling", "bomb", "retreat"]);
    // The champion at the level it has now, not the one the plan was played at.
    expect(replay.events[0]).toMatchObject({ champion: { t: 5, l: 5 } });
    // Over the pool the attack was served, before its loot was taken.
    expect(replay.load).toMatchObject({ baseid: CAMP, resources: { r1: 5_000_000, r2: 5_000_000, r3: 5_000_000, r4: 5_000_000 } });
    expect(replay.levels).toEqual({ C1: 3 });
  }, REPLAY_TIMEOUT_MS);

  test("the repeat retreats where the hand-played attack did", async () => {
    const result = await runAutoAttack(user() as never, CAMP);
    expect(result.report).toContain("etreat");
  }, REPLAY_TIMEOUT_MS);
});

describe("runAutoAttack refuses, writing nothing", () => {
  test("a monster short", async () => {
    userSave.monsters.housed = { C1: 149 };
    const refused = await refusal(runAutoAttack(user() as never, CAMP));
    expect(refused.reason).toBe("missing");
    expect(refused.missing).toEqual([{ kind: "monster", id: "C1", need: 150, have: 149 }]);
    expect(userSave.monsters.housed).toEqual({ C1: 149 });
    userSave.monsters.housed = { C1: 200 };
    nothingWritten();
  });

  test("the champion resting or away", async () => {
    userSave.champion = [{ t: 5, l: 5, hp: 0, status: 0 }];
    expect((await refusal(runAutoAttack(user() as never, CAMP))).missing).toEqual([
      { kind: "champion", t: 5, reason: "hurt" },
    ]);
    userSave.champion = [];
    expect((await refusal(runAutoAttack(user() as never, CAMP))).missing).toEqual([
      { kind: "champion", t: 5, reason: "none" },
    ]);
    nothingWritten();
  });

  test("a bomb the pool cannot pay for", async () => {
    userSave.resources = { r1: 1_000_000, r2: 99_999, r3: 1_000_000, r4: 1_000_000 };
    expect((await refusal(runAutoAttack(user() as never, CAMP))).missing).toEqual([
      { kind: "bomb", id: "pb1", reason: "cost" },
    ]);
    userSave.resources = { r1: 1_000_000, r2: 1_000_000, r3: 1_000_000, r4: 1_000_000 };
    nothingWritten();
  });

  test("anything but a Map Room 2 wild camp on the player's world", async () => {
    for (const change of [
      { type: "main", wmid: 0 },
      { type: "outpost", wmid: 0 },
      { type: "tribe", wmid: 5 },
      { type: "inferno", wmid: 11 },
      { worldid: "another-world" },
    ]) {
      reset();
      Object.assign(camp, change);
      expect((await refusal(runAutoAttack(user() as never, CAMP))).reason).toBe("notACamp");
      nothingWritten();
    }
  });

  test("a Map Room 1 tribe", async () => {
    const { MR1_TRIBE_IDS } = await import("../../../game-data/tribes/v1/index.js");
    const tribe = String([...MR1_TRIBE_IDS][0]);
    expect((await refusal(runAutoAttack(user() as never, tribe))).reason).toBe("notACamp");
    nothingWritten();
  });

  test("a player not on Map Room 2", async () => {
    userSave.mapversion = 3;
    expect((await refusal(runAutoAttack(user() as never, CAMP))).reason).toBe("notMapRoom2");
    nothingWritten();
  });

  test("no hand-played attack on that tribe and level yet", async () => {
    planRow = null;
    expect((await refusal(runAutoAttack(user() as never, CAMP))).reason).toBe("noPlan");
    reset();
    camp.level = 36;
    expect((await refusal(runAutoAttack(user() as never, CAMP))).reason).toBe("noPlan");
    nothingWritten();
  });

  test("one already in progress", async () => {
    store.set(autoAttackLockKey(ATTACKER), "1");
    expect((await refusal(runAutoAttack(user() as never, CAMP))).reason).toBe("inFlight");
    // The lock is the other request's: it stays.
    expect(store.has(autoAttackLockKey(ATTACKER))).toBe(true);
    expect(mint).not.toHaveBeenCalled();
  });

  test("a camp someone else is attacking", async () => {
    camp.attackid = 77;
    camp.attacks = [{ starttime: now() - 10 }];
    expect((await refusal(runAutoAttack(user() as never, CAMP))).message).toContain("under attack");
    expect(mint).not.toHaveBeenCalled();
    expect(camp.attackid).toBe(77);
  });

  test("out of range", async () => {
    inRange = false;
    expect((await refusal(runAutoAttack(user() as never, CAMP))).message).toBe("out of range");
    nothingWritten();
  });

  test("no replay worker free", async () => {
    slotFree = false;
    const refused = await refusal(runAutoAttack(user() as never, CAMP));
    expect(refused.reason).toBe("busy");
    nothingWritten();
  });
});

describe("autoAttackPlanFor", () => {
  test("says what would be repeated and what is missing, writing nothing", async () => {
    userSave.monsters.housed = { C1: 100 };
    const answer = await autoAttackPlanFor(user() as never, CAMP);
    expect(answer.plan).toMatchObject({ tribe: "Kozu", level: 35, monsters: { C1: 150 }, bombs: ["pb1"] });
    expect(answer.missing).toEqual([{ kind: "monster", id: "C1", need: 150, have: 100 }]);
    expect(answer).toMatchObject({ outOfRange: false, underAttack: false, damage: 12 });
    expect(flush).not.toHaveBeenCalled();
    expect(mint).not.toHaveBeenCalled();
  });

  test("no plan for the camp's tribe and level", async () => {
    planRow = null;
    expect(await autoAttackPlanFor(user() as never, CAMP)).toMatchObject({ plan: null, missing: [] });
  });

  test("a regenerated camp reads as undamaged", async () => {
    camp.savetime = now() - 13 * 60 * 60;
    expect((await autoAttackPlanFor(user() as never, CAMP)).damage).toBe(0);
  });
});
