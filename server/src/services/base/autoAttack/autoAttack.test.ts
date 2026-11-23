import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RULES_VERSION } from "../../defences/rulesVersion.js";

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
/** The attacker's outposts, as `em.find` serves them. */
let outpostRows: Record<string, any>[];
let planRow: Record<string, any> | null;
/** Transactions run (Smart Repeat attack's moves and their undo). */
let transactions = 0;
const flush = mock(async () => {});
const upsert = mock(async () => {});
const mint = mock(async () => {});
const removeRow = mock((_row: unknown) => {});

const reset = () => {
  store.clear();
  sets.clear();
  flush.mockClear();
  upsert.mockClear();
  mint.mockClear();
  removeRow.mockClear();
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
    basesaveid: 6,
    baseid: HOME,
    type: "main",
    attackid: 0,
    attacks: [],
    worldid: WORLD,
    mapversion: 2,
    // The camp's next-door cell; a level 4 Flinger reaches ten cells.
    homebase: ["241", "207"],
    flinger: 4,
    catapult: 2,
    buildingdata: {},
    outposts: [],
    resources: { r1: 1_000_000, r2: 1_000_000, r3: 5_000_000, r4: 1_000_000 },
    monsters: { housed: { C1: 200 }, space: 400 },
    academy: { C1: { level: 3 } },
    champion: [{ t: 5, l: 5, hp: 62000, status: 0 }],
    siege: null,
  };
  outpostRows = [];
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
        // The attacker's main row, locked with the camp's as the attack lands (audit P1, P2).
        if (where.basesaveid === userSave.basesaveid) return userSave;
        // An outpost, locked as Repeat attack's moves are made (Smart Repeat attack).
        const outpost = outpostRows.find((row) => row.basesaveid === where.basesaveid);
        if (outpost) return outpost;
        return where.basesaveid === BASESAVEID || where.baseid === camp.baseid ? camp : null;
      },
      find: async (_entity: unknown, where: { baseid?: { $in?: string[] } }) =>
        outpostRows.filter((row) => where?.baseid?.$in?.includes(row.baseid)),
      populate: async () => {},
      persist: () => {},
      remove: removeRow,
      upsert,
      flush,
      // The transaction an attack lands in (audit P1, P2): the stand-in rows change
      // in place, so there is nothing to commit or roll back.
      begin: async () => {},
      commit: async () => {},
      rollback: async () => {},
      getTransactionContext: () => undefined,
      // Smart Repeat attack's moves: the stand-in rows change in place, so a
      // refused transaction is rolled back by putting back a copy.
      transactional: async (cb: (em: unknown) => Promise<unknown>) => {
        const before = structuredClone({ main: userSave.monsters, outposts: outpostRows.map((row) => row.monsters) });
        const em = (await import("../../../server.js")).postgres.em;
        try {
          return await cb(em);
        } catch (err) {
          userSave.monsters = before.main;
          outpostRows.forEach((row, index) => (row.monsters = before.outposts[index]));
          throw err;
        } finally {
          transactions += 1;
        }
      },
    },
  },
}));

const core = await import("@mikro-orm/core");
mock.module("@mikro-orm/core", () => ({
  ...core,
  // Object.create, not a spread: the static getEntityManager is non-enumerable and the
  // DB tests that run later in the same process need it.
  RequestContext: Object.assign(Object.create(core.RequestContext), {
    create: (_em: unknown, next: () => unknown) => next(),
  }),
}));

mock.module("../../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
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
  layouts: "../../maproom/v2/tribeLayouts.ts?real",
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

// The camp's fresh layout, which Repeat attack's plan check (beta 9,
// `planCheck.ts`) holds the plan against: open ground unless a test says
// otherwise, since the stand-in plan's fling lands on the sandbox yard's
// walls (`planCheck.test.ts` checks the plans themselves).
const realLayouts = (await import(REAL.layouts)) as typeof import("../../maproom/v2/tribeLayouts.js");
/** The fresh layout's buildings, when a test wants one other than the camp's. */
let freshLayout: Record<string, unknown> | null = null;
mock.module("../../maproom/v2/tribeLayouts.js", () => ({
  ...realLayouts,
  tribeLayoutFor: (...args: Parameters<typeof realLayouts.tribeLayoutFor>) =>
    standIn
      ? {
          from: args[1],
          save: { buildingdata: freshLayout ?? {}, resources: camp.resources },
          saved: false,
        }
      : realLayouts.tribeLayoutFor(...args),
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
    if (mintRefuses) throw new Error("the attack load said no");
    // Someone spends putty between the checks and the commit.
    if (spendBeforeCommit) userSave.resources = { ...userSave.resources, r3: 0 };
    // Repeat attack's fee, charged at the commit as the real load does it.
    args[0].beforeCommit?.(userSave as never);
    if (mintFailsAfterCommit) throw new Error("the attack session could not be written");
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
/** The attack load refuses after the checks (Smart Repeat attack's all-or-nothing). */
let mintRefuses = false;
/** The attack load fails after its commit (the session's write). */
let mintFailsAfterCommit = false;
/** The pool's putty is spent elsewhere after the checks, before the commit. */
let spendBeforeCommit = false;
mock.module("../combat/replayRunner.js", () => ({
  ...runner,
  reserveReplaySlot: async (...args: Parameters<typeof runner.reserveReplaySlot>) => {
    if (!standIn) return runner.reserveReplaySlot(...args);
    return slotFree ? () => {} : null;
  },
}));

/** The dashboard's monster count rows written (`monsterUsage.ts`). */
const usage: Record<string, any>[] = [];
mock.module("../../stats/monsterUsageStore.js", () => ({
  insertUsageRow: async (row: Record<string, any>) => {
    usage.push(row);
  },
}));

const { runAutoAttack, autoAttackPlanFor, lastAutoAttackReplay, autoAttackLockKey } = await import("./autoAttack.js");
// The route itself (`POST /worldmapv2/autoattack`, `app.routes.ts`), over the real service and the stand-ins above.
const { autoAttack: autoAttackRoute } = await import("../../../controllers/maproom/v2/autoAttack.js");
const { attackCheckpointKey } = await import("../attackCheckpoint.js");

beforeEach(() => {
  reset();
  inRange = true;
  slotFree = true;
  mintRefuses = false;
  mintFailsAfterCommit = false;
  spendBeforeCommit = false;
  transactions = 0;
  freshLayout = null;
});

/** One of the attacker's outposts, at a cell with a Flinger level and housing. */
const addOutpost = (x: number, y: number, flinger: number, housed: Record<string, number>) => {
  const baseid = `1000${x}${y}`;
  userSave.outposts = [...userSave.outposts, [x, y, baseid]];
  outpostRows.push({
    baseid,
    basesaveid: 100 + outpostRows.length,
    saveuserid: ATTACKER,
    type: "outpost",
    worldid: WORLD,
    attackid: 0,
    attacks: [],
    flinger,
    savetime: now(),
    buildingdata: {},
    buildinghealthdata: {},
    monsters: { housed: { ...housed } },
  });
};

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
  expect(userSave.resources).toEqual({ r1: 1_000_000, r2: 1_000_000, r3: 5_000_000, r4: 1_000_000 });
  expect(store.has(autoAttackLockKey(ATTACKER))).toBe(false);
};

describe("runAutoAttack lands the plan", () => {
  test("monsters spent, bomb charged, loot banked, the camp's damage kept, and the result says so", async () => {
    // Room in storage for the loot: no silos is a cap of 10,000, and twigs are
    // empty. Putty: exactly the camp's fee (level 35, 2,000,000), burned to 0.
    userSave.resources = { r1: 0, r2: 1_000_000, r3: 2_000_000, r4: 0 };
    const result = await runAutoAttack(user() as never, CAMP);

    // The attacker: 150 Pokeys spent, the pebble bomb's 100,000 charged, the loot banked.
    expect(userSave.monsters.housed).toEqual({ C1: 50 });
    expect(result.loot.r1).toBeGreaterThan(0);
    expect(userSave.resources.r1).toBe(result.loot.r1);
    // Pebbles stay over the cap after the bomb, so take nothing.
    expect(result.loot.r2).toBe(0);
    expect(userSave.resources.r2).toBe(900_000);
    // The fee burned before the attack: what putty is left is the loot alone.
    expect(result.fee).toBe(2_000_000);
    expect(userSave.resources.r3).toBe(result.loot.r3);
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

describe("the dashboard's monster counts (owner, 23 Nov 2026)", () => {
  test("a Repeat attack is counted once, with the camps, marked as a Repeat", async () => {
    usage.length = 0;
    userSave.resources = { r1: 0, r2: 1_000_000, r3: 2_000_000, r4: 0 };
    await runAutoAttack(user() as never, CAMP);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ repeat: true, mode: "camp", arena: "mr2", attackerUserid: ATTACKER, monsters: { C1: { f: 150 } } });
  });
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
    userSave.resources = { r1: 1_000_000, r2: 99_999, r3: 5_000_000, r4: 1_000_000 };
    expect((await refusal(runAutoAttack(user() as never, CAMP))).missing).toEqual([
      { kind: "bomb", id: "pb1", reason: "cost" },
    ]);
    userSave.resources = { r1: 1_000_000, r2: 1_000_000, r3: 5_000_000, r4: 1_000_000 };
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

  test("a camp past its 12 hours that someone is attacking keeps its row", async () => {
    // A camp keeps its template's old `savetime` until an attack's save, and a
    // camp row never lists its attacks, so only the session says it is in play.
    camp.savetime = now() - 13 * 60 * 60;
    camp.attackid = 77;
    store.set(attackSessionKey(BASESAVEID), JSON.stringify({ attackerid: 999, attackid: 77, startedat: now() - 10 }));

    expect((await refusal(runAutoAttack(user() as never, CAMP))).message).toContain("under attack");
    expect(removeRow).not.toHaveBeenCalled();
    expect(mint).not.toHaveBeenCalled();
    expect(camp.attackid).toBe(77);
  });

  test("out of range: refused in words, by the hand-played attack's range rule", async () => {
    inRange = false;
    const refused = await refusal(runAutoAttack(user() as never, CAMP));
    expect(refused.reason).toBe("outOfRange");
    expect(refused.message).toBe("This camp is out of your Flingers' range.");
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

  test("monsters in an outpost whose own Flinger cannot reach the camp are not flung from there (Repeat attack, 15 Nov)", async () => {
    userSave.monsters.housed = {};
    // In the sweep box, three cells from the camp; a level 2 outpost Flinger reaches two.
    addOutpost(244, 208, 2, { C1: 200 });
    // The main yard in range has no Monster Housing, so they cannot move in either.
    const answer = await autoAttackPlanFor(user() as never, CAMP);
    expect(answer.missing).toEqual([]);
    expect(answer.moves).toEqual([]);
    // (A yard with no Monster Housing at all is not listed.)
    expect(answer.noRoom).toEqual({ need: 1_500, free: [] });

    const refused = await refusal(runAutoAttack(user() as never, CAMP));
    expect(refused.reason).toBe("noRoom");
    expect(mint).not.toHaveBeenCalled();
    expect(outpostRows[0]!.monsters.housed).toEqual({ C1: 200 });
  });

  test("monsters in an outpost that reaches the camp count", async () => {
    userSave.monsters.housed = {};
    addOutpost(242, 208, 2, { C1: 200 });
    expect((await autoAttackPlanFor(user() as never, CAMP)).missing).toEqual([]);
  });

  test("the main yard's monsters do not count when only an outpost reaches the camp", async () => {
    // A level 1 main Flinger reaches four cells; the camp is eleven away.
    userSave.homebase = ["230", "208"];
    userSave.flinger = 1;
    addOutpost(242, 208, 2, { C1: 100 });
    const answer = await autoAttackPlanFor(user() as never, CAMP);
    // The other 50 would have to move in from the main yard, and the outpost has no housing.
    expect(answer.missing).toEqual([]);
    expect(answer.noRoom).toEqual({ need: 500, free: [] });
  });

  test("a camp no Flinger reaches says so, so Repeat attack is refused", async () => {
    inRange = false;
    const answer = await autoAttackPlanFor(user() as never, CAMP);
    expect(answer.plan).not.toBeNull();
    expect(answer.outOfRange).toBe(true);
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

/* ── Whether an attack would save a Repeat plan (patch 8.3, owner's B) ───── */

describe("autoAttackPlanFor says whether the camp is fresh", () => {
  test("a camp with no damaged building is fresh, plan or no plan", async () => {
    camp.damage = 0;
    camp.buildinghealthdata = {};
    expect((await autoAttackPlanFor(user() as never, CAMP)).fresh).toBe(true);
    planRow = null;
    expect(await autoAttackPlanFor(user() as never, CAMP)).toMatchObject({ plan: null, fresh: true });
  });

  test("a damaged camp is not fresh", async () => {
    planRow = null;
    camp.damage = 12;
    camp.buildinghealthdata = { "0": 120_000, "3": 40_000 };
    expect(await autoAttackPlanFor(user() as never, CAMP)).toMatchObject({ damage: 12, fresh: false });
  });

  test("a camp scratched below 1% reads 0% but is not fresh", async () => {
    planRow = null;
    camp.damage = 0;
    camp.buildinghealthdata = { "0": 360_000 };
    expect(await autoAttackPlanFor(user() as never, CAMP)).toMatchObject({ damage: 0, fresh: false });
  });

  test("a camp past its 12 hours has regrown, so it is fresh again", async () => {
    planRow = null;
    camp.damage = 40;
    camp.buildinghealthdata = { "0": 120_000 };
    camp.savetime = now() - 13 * 60 * 60;
    expect(await autoAttackPlanFor(user() as never, CAMP)).toMatchObject({ damage: 0, fresh: true });
  });

  test("a camp nobody has attacked yet has no row, and is fresh", async () => {
    planRow = null;
    // Known by its id alone: this world's id for the camp's cell, with no row behind it.
    const { generateBaseId } = await import("../../../utils/generateBaseId.js");
    const unattacked = generateBaseId(WORLD, 241, 208);
    expect(await autoAttackPlanFor(user() as never, unattacked)).toMatchObject({ plan: null, damage: 0, fresh: true });
  });
});

/* ── Smart Repeat attack (owner, 16 Nov 2026) ──────────────────────────── */

/** Monster Housing at level 6 (540 each), so a yard can take monsters in. */
const housing = (count: number) =>
  Object.fromEntries(Array.from({ length: count }, (_, index) => [`h${index}`, { id: `h${index}`, t: 15, l: 6 }]));

describe("Smart Repeat attack: moves into the yards in range", () => {
  /** The main yard reaches the camp and has room; an outpost out of reach holds the rest. */
  const split = () => {
    userSave.buildingdata = housing(3);
    userSave.monsters.housed = { C1: 60 };
    addOutpost(244, 208, 2, { C1: 200 });
  };
  const FAR = "1000244208";

  test("the plan answer lists the moves, their key and where each yard sits", async () => {
    split();
    const answer = await autoAttackPlanFor(user() as never, CAMP);
    expect(answer.missing).toEqual([]);
    expect(answer.noRoom).toBeNull();
    expect(answer.moves).toEqual([{ from: FAR, to: HOME, monsters: { C1: 90 } }]);
    expect(answer.movesKey).toBe(`${FAR}>${HOME}:C1=90`);
    expect(answer.yards).toEqual({ [FAR]: { main: false, x: 244, y: 208 }, [HOME]: { main: true, x: 241, y: 207 } });
    expect(transactions).toBe(0);
  });

  test("yards in range that hold the army: no moves, as before", async () => {
    const answer = await autoAttackPlanFor(user() as never, CAMP);
    expect(answer).toMatchObject({ missing: [], moves: [], movesKey: null, noRoom: null });
  });

  test("Move and attack: the moves are made, then the attack spends from the yard in range", async () => {
    split();
    const result = await runAutoAttack(user() as never, CAMP, `${FAR}>${HOME}:C1=90`);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(result.moved).toEqual([{ from: FAR, to: HOME, monsters: { C1: 90 } }]);
    expect(result.yards[FAR]).toEqual({ main: false, x: 244, y: 208 });
    // The outpost gave 90; the main yard had 60 + 90 and flung 150.
    expect(outpostRows[0]!.monsters.housed).toEqual({ C1: 110 });
    expect(userSave.monsters.housed.C1 ?? 0).toBe(0);
    expect(result.flung).toEqual({ C1: 150 });
  });

  test("never moves without the player's say-so: no key, or another key, is refused and nothing moves", async () => {
    split();
    for (const key of [undefined, `${FAR}>${HOME}:C1=80`, "anything"]) {
      const refused = await refusal(runAutoAttack(user() as never, CAMP, key));
      expect(refused.reason).toBe("movesChanged");
    }
    expect(transactions).toBe(0);
    expect(mint).not.toHaveBeenCalled();
    expect(outpostRows[0]!.monsters.housed).toEqual({ C1: 200 });
    expect(userSave.monsters.housed).toEqual({ C1: 60 });
  });

  test("the yards changed since the prompt: the server's own plan wins and nothing moves", async () => {
    split();
    const key = (await autoAttackPlanFor(user() as never, CAMP)).movesKey!;
    // A monster hatched in range since: the plan now moves 89, not 90.
    userSave.monsters.housed = { C1: 61 };
    const refused = await refusal(runAutoAttack(user() as never, CAMP, key));
    expect(refused.reason).toBe("movesChanged");
    expect(outpostRows[0]!.monsters.housed).toEqual({ C1: 200 });
    expect(mint).not.toHaveBeenCalled();
  });

  test("all or nothing: the attack load refuses after the moves, and they go back", async () => {
    split();
    mintRefuses = true;
    const refused = await refusal(runAutoAttack(user() as never, CAMP, `${FAR}>${HOME}:C1=90`));
    expect(refused.message).toBe("the attack load said no");
    // The moves and their undo: two transactions, and every monster where it was.
    expect(transactions).toBe(2);
    expect(outpostRows[0]!.monsters.housed).toEqual({ C1: 200 });
    expect(userSave.monsters.housed).toEqual({ C1: 60 });
    expect(store.has(autoAttackLockKey(ATTACKER))).toBe(false);
  });

  test("no replay worker free: refused before anything moves", async () => {
    split();
    slotFree = false;
    const refused = await refusal(runAutoAttack(user() as never, CAMP, `${FAR}>${HOME}:C1=90`));
    expect(refused.reason).toBe("busy");
    expect(transactions).toBe(0);
    expect(outpostRows[0]!.monsters.housed).toEqual({ C1: 200 });
  });

  test("not gatherable from every yard: each short type, nothing moves", async () => {
    userSave.buildingdata = housing(3);
    userSave.monsters.housed = { C1: 60 };
    addOutpost(244, 208, 2, { C1: 50 });
    const answer = await autoAttackPlanFor(user() as never, CAMP);
    expect(answer.missing).toEqual([{ kind: "monster", id: "C1", need: 150, have: 110 }]);
    expect(answer.moves).toEqual([]);
    const refused = await refusal(runAutoAttack(user() as never, CAMP, "x"));
    expect(refused.reason).toBe("missing");
    expect(transactions).toBe(0);
  });

  test("not enough housing in range: its own refusal, with the room each yard has", async () => {
    userSave.buildingdata = housing(1);
    userSave.monsters.housed = { C1: 50 };
    addOutpost(244, 208, 2, { C1: 200 });
    const answer = await autoAttackPlanFor(user() as never, CAMP);
    expect(answer.missing).toEqual([]);
    // 100 Pokey take 1,000; the main yard houses 500 of its 540 already.
    expect(answer.noRoom).toEqual({ need: 1_000, free: [{ baseid: HOME, free: 40 }] });
    const refused = await refusal(runAutoAttack(user() as never, CAMP));
    expect(refused).toMatchObject({ reason: "noRoom", noRoom: answer.noRoom });
    expect(transactions).toBe(0);
  });

  test("a champion in the plan never moves; a champion not ready refuses before any move", async () => {
    split();
    expect(JSON.stringify((await autoAttackPlanFor(user() as never, CAMP)).moves)).not.toContain('"t"');
    userSave.champion = [{ t: 5, l: 5, hp: 62000, status: 1 }];
    // Refused anyway, so no moves are offered.
    expect(await autoAttackPlanFor(user() as never, CAMP)).toMatchObject({ moves: [], movesKey: null });
    const refused = await refusal(runAutoAttack(user() as never, CAMP, `${FAR}>${HOME}:C1=90`));
    expect(refused.reason).toBe("missing");
    expect(refused.missing).toEqual([{ kind: "champion", t: 5, reason: "away" }]);
    expect(transactions).toBe(0);
    expect(outpostRows[0]!.monsters.housed).toEqual({ C1: 200 });
  });

  test("an outpost under attack sends nothing", async () => {
    split();
    outpostRows[0]!.attackid = 9;
    outpostRows[0]!.attacks = [{ starttime: now() }];
    const answer = await autoAttackPlanFor(user() as never, CAMP);
    expect(answer.missing).toEqual([{ kind: "monster", id: "C1", need: 150, have: 60 }]);
    expect(answer.moves).toEqual([]);
  });
});

describe("POST /worldmapv2/autoattack with moves (Smart Repeat attack, the route)", () => {
  const FAR = "1000244208";
  const KEY = `${FAR}>${HOME}:C1=90`;
  const split = () => {
    userSave.buildingdata = housing(3);
    userSave.monsters.housed = { C1: 60 };
    addOutpost(244, 208, 2, { C1: 200 });
  };
  /** Calls the controller as the router does, with the body the web client posts. */
  const post = async (body: Record<string, unknown>, meetsDiscordAgeCheck = true) => {
    const ctx = {
      request: { body: { rules: RULES_VERSION, ...body } },
      authUser: user(),
      meetsDiscordAgeCheck,
      status: 0,
      body: undefined as unknown,
    };
    await autoAttackRoute(ctx as never, async () => {});
    return ctx;
  };
  const refusalOf = async (body: Record<string, unknown>) => {
    try {
      await post(body);
    } catch (err) {
      return { ...((err as { data?: object }).data ?? {}), message: (err as Error).message } as Record<string, unknown>;
    }
    throw new Error("expected a refusal");
  };

  test("a page with older battle rules, or none, is refused with New version before anything moves (23 Nov 2026)", async () => {
    split();
    for (const rules of ["0ba3fde8701104af", undefined]) {
      expect(await refusalOf({ baseid: FAR, moves: KEY, rules })).toMatchObject({ reason: "newVersion" });
    }
    expect(userSave.monsters.housed).toEqual({ C1: 60 });
    expect(outpostRows[0]!.monsters.housed).toEqual({ C1: 200 });
  });

  test("the key of the moves shown: the moves are made and the attack lands", async () => {
    split();
    const ctx = await post({ baseid: CAMP, moves: KEY });
    expect(ctx.status).toBe(200);
    expect(ctx.body).toMatchObject({ error: 0, moved: [{ from: FAR, to: HOME, monsters: { C1: 90 } }], flung: { C1: 150 } });
    expect(outpostRows[0]!.monsters.housed).toEqual({ C1: 110 });
  });

  test("no key or another key: movesChanged, nothing moved, nothing minted", async () => {
    split();
    expect((await refusalOf({ baseid: CAMP })).reason).toBe("movesChanged");
    expect((await refusalOf({ baseid: CAMP, moves: `${FAR}>${HOME}:C1=91` })).reason).toBe("movesChanged");
    expect(transactions).toBe(0);
    expect(mint).not.toHaveBeenCalled();
    expect(outpostRows[0]!.monsters.housed).toEqual({ C1: 200 });
  });

  test("all or nothing: the attack load refuses after the moves, and the route leaves every yard as it was", async () => {
    split();
    mintRefuses = true;
    expect((await refusalOf({ baseid: CAMP, moves: KEY })).message).toBe("the attack load said no");
    expect(transactions).toBe(2);
    expect(outpostRows[0]!.monsters.housed).toEqual({ C1: 200 });
    expect(userSave.monsters.housed).toEqual({ C1: 60 });
  });

  test("a key that is not a string, or too long, is refused before anything runs", async () => {
    split();
    for (const moves of [42, "x".repeat(4_001)]) {
      await expect(post({ baseid: CAMP, moves })).rejects.toThrow();
    }
    expect(transactions).toBe(0);
    expect(mint).not.toHaveBeenCalled();
  });

  test("the Discord age rule still applies", async () => {
    split();
    await expect(post({ baseid: CAMP, moves: KEY }, false)).rejects.toThrow(/discord/i);
    expect(transactions).toBe(0);
  });
});

describe("Repeat attack's putty fee (owner, 20 Nov 2026)", () => {
  // The camp is level 35: 2,000,000 putty.
  const FEE = 2_000_000;
  /** A plan that flings one Pokey: the camp stands, the attack is lost. */
  const LOST_PLAN = { v: 1, tick: 2_000, events: [{ kind: "fling", t: 480, x: -615, y: 115, r: 300, monsters: { C1: 1 } }] };
  /** The plan with a putty shot (100,000) instead of the pebble one; a level 3 Catapult fires it. */
  const puttyPlan = () => ({
    ...PLAN,
    events: PLAN.events.map((event) => (event.kind === "bomb" ? { ...event, id: "pu1" } : event)),
  });

  test("the plan answer carries the fee by the camp's level, and is short when the pool cannot pay it", async () => {
    expect((await autoAttackPlanFor(user() as never, CAMP)).fee).toBe(FEE);
    expect((await autoAttackPlanFor(user() as never, CAMP)).missing).toEqual([]);

    userSave.resources.r3 = FEE - 1;
    const answer = await autoAttackPlanFor(user() as never, CAMP);
    expect(answer.missing).toEqual([{ kind: "fee", need: FEE, have: FEE - 1 }]);
    expect(flush).not.toHaveBeenCalled();

    // A camp of another band: level 29 is 1,000,000.
    camp.level = 29;
    planRow!.level = 29;
    expect((await autoAttackPlanFor(user() as never, CAMP)).fee).toBe(1_000_000);
  });

  test("short of putty: refused before anything is written, the pool untouched", async () => {
    userSave.resources.r3 = FEE - 1;
    const refused = await refusal(runAutoAttack(user() as never, CAMP));
    expect(refused.reason).toBe("missing");
    expect(refused.missing).toEqual([{ kind: "fee", need: FEE, have: FEE - 1 }]);
    expect(mint).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
    expect(camp.attackid).toBe(0);
    expect(userSave.resources.r3).toBe(FEE - 1);
    expect(userSave.monsters.housed).toEqual({ C1: 200 });
  });

  test("the fee and the Catapult's putty shots come out of one purse", async () => {
    userSave.catapult = 3;
    planRow!.plan = puttyPlan();
    userSave.resources.r3 = FEE + 100_000 - 1;
    // One line for the putty, not the fee and the shot apart.
    expect((await autoAttackPlanFor(user() as never, CAMP)).missing).toEqual([
      { kind: "fee", need: FEE + 100_000, have: FEE + 100_000 - 1 },
    ]);
    expect((await refusal(runAutoAttack(user() as never, CAMP))).missing).toEqual([
      { kind: "fee", need: FEE + 100_000, have: FEE + 100_000 - 1 },
    ]);
    expect(camp.attackid).toBe(0);
    expect(userSave.resources.r3).toBe(FEE + 100_000 - 1);

    // Enough for both: the fee goes before the attack, the shot as it is fired.
    userSave.resources = { r1: 0, r2: 0, r3: FEE + 100_000, r4: 0 };
    const result = await runAutoAttack(user() as never, CAMP);
    expect(result.bombs).toEqual(["pu1"]);
    expect(userSave.resources.r3).toBe(result.loot.r3);
  }, REPLAY_TIMEOUT_MS);

  test("a lost attack: the fee is gone all the same", async () => {
    planRow!.plan = LOST_PLAN;
    userSave.resources = { r1: 0, r2: 0, r3: 10_000_000, r4: 0 };
    const result = await runAutoAttack(user() as never, CAMP);
    expect(result.destroyed).toBe(0);
    expect(result.fee).toBe(FEE);
    expect(userSave.resources.r3).toBe(10_000_000 - FEE + result.loot.r3);
    expect(userSave.monsters.housed).toEqual({ C1: 199 });
  }, REPLAY_TIMEOUT_MS);

  test("putty spent between the checks and the commit: refused at the commit, nothing charged", async () => {
    spendBeforeCommit = true;
    const refused = await refusal(runAutoAttack(user() as never, CAMP));
    expect(refused.missing).toEqual([{ kind: "fee", need: FEE, have: 0 }]);
    expect(camp.attackid).toBe(0);
    expect(userSave.resources.r3).toBe(0);
    expect(store.has(attackCheckpointKey(BASESAVEID))).toBe(false);
  });

  test("an attack that started but can never land gives the fee back", async () => {
    mintFailsAfterCommit = true;
    expect((await refusal(runAutoAttack(user() as never, CAMP))).message).toBe("the attack session could not be written");
    expect(userSave.resources.r3).toBe(5_000_000);
    expect(flush).toHaveBeenCalled();
    expect(store.has(attackCheckpointKey(BASESAVEID))).toBe(false);
  });
});

describe("Repeat attack's plan check (beta 9, owner's fix 2)", () => {
  test("a fling on a building of the camp's fresh layout: refused in the owner's words, nothing spent", async () => {
    // The stand-in plan's fling lands on the sandbox yard's walls.
    freshLayout = sandbox.buildingdata;
    const refused = await refusal(runAutoAttack(user() as never, CAMP));
    expect(refused.reason).toBe("planOnBuilding");
    expect(refused.message).toBe("Attack once by hand on a fresh camp to record a new plan.");
    expect(refused.fling).toEqual({ t: 480, x: -615, y: 115 });
    // No fee, no attack, no monsters, no moves.
    expect(mint).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
    expect(transactions).toBe(0);
    expect(camp.attackid).toBe(0);
    expect(userSave.resources.r3).toBe(5_000_000);
    expect(userSave.monsters.housed).toEqual({ C1: 200 });
    expect(store.has(attackCheckpointKey(BASESAVEID))).toBe(false);
    expect(store.has(autoAttackLockKey(ATTACKER))).toBe(false);
  });

  test("the same plan on a fresh layout with that ground open still lands, fee and all", async () => {
    const open = Object.fromEntries(
      Object.entries(sandbox.buildingdata as Record<string, { t: number }>).filter(([, building]) => building.t !== 17)
    );
    freshLayout = open;
    const result = await runAutoAttack(user() as never, CAMP);
    expect(result.fee).toBe(2_000_000);
    expect(userSave.resources.r3).toBeLessThan(5_000_000);
  }, REPLAY_TIMEOUT_MS);
});
