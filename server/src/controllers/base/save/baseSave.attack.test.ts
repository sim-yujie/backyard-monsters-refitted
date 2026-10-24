import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import type { Context } from "koa";
import { gzipSync } from "node:zlib";
import type { BrainWeights } from "../../../game-rules/combat/index.js";

/**
 * Attack saves through `/base/save`. Loot (issue #163): only the save that
 * ends the attack credits anything, and it credits no more than the server's
 * replay of the battle gives. The army (issue #164): nothing the client sends
 * is written over it. The defender is a small wild monster camp so the replay
 * is quick; the rows are plain objects behind a stand-in ORM.
 */

const DEFENDER_OWNER = 1;
const ATTACKER = 2505;
const ATTACK_ID = 4242;
const HOME = "2000241207";

const YARD = {
  "0": { id: 0, t: 14, l: 1, X: 0, Y: 0 },
  "1": { id: 1, t: 20, l: 1, X: 200, Y: 200 },
};
const LOG = {
  v: 1,
  seed: 5,
  events: [{ kind: "fling", t: 80, x: 400, y: 400, r: 200, monsters: { C4: 12 } }],
};
const ENTRY = { [HOME]: { C4: 12, C1: 4 } };

let defender: Record<string, any>;
/** Messages the save leaves in a mailbox. */
const notices: Record<string, unknown>[] = [];
let attackerSave: Record<string, any>;
const store = new Map<string, string>();
/** Plans written (issue #221). */
const upsert = mock(async (_entity: unknown, _row: Record<string, any>) => {});
/** Defence replays written (issue #359). */
const replays: Record<string, any>[] = [];
/** The event counter writes (`services/events/progressStore.ts`), as `[event, amount]`. */
const counted: [string, number][] = [];

mock.module("../../../server.js", () => ({
  postgres: {
    em: {
      populate: async (user: Record<string, unknown>) => {
        user.save = attackerSave;
      },
      // `isBot` asks the request's context (bot neighbours, #241); nobody here is one.
      global: false,
      getContext() {
        return this;
      },
      findOne: async (entity: { name?: string }) => (entity?.name === "Bot" ? null : defender),
      find: async () => [],
      // The outpost owner's academy and buffs are read in a fork (issue #160).
      fork() {
        return this;
      },
      // The outpost owner's mail (outposts WP8, #187; issue #160).
      create: (_entity: unknown, data: Record<string, unknown>) => {
        notices.push(data);
        return data;
      },
      count: async () => 0,
      nativeUpdate: async () => 0,
      upsert,
      persist: () => {},
      flush: async () => {},
      // Only the event counter's SQL is answered; anything else fails as with no database.
      execute: async (sql: string, params: unknown[]) => {
        if (!sql.includes("event_progress")) throw new Error("no database");
        counted.push([String(params[1]), Number(params[2])]);
        return [{ counter: params[2] }];
      },
      // The attacker's main row, locked for an achievement event (#204).
      transactional: async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          findOne: async (_entity: unknown, where: Record<string, unknown>) =>
            where.basesaveid === attackerSave.basesaveid ? attackerSave : null,
          flush: async () => {},
          // A defence replay's row, and its prune to the newest 20 (#359).
          insert: async (_entity: unknown, row: Record<string, any>) => {
            replays.push(row);
            return replays.length;
          },
          execute: async () => [],
        }),
    },
  },
  redis: {
    get: async (key: string) => store.get(key) ?? null,
    setex: async () => "OK",
    set: async (key: string, value: string, ...options: string[]) => {
      if (options.includes("NX") && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
    srem: async () => 0,
  },
}));

mock.module("../../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

// The audit trail (issue #23, C7), kept here rather than on the stand-in rows.
const reports: string[] = [];
mock.module("../../../services/base/reportManager.js", () => ({
  logReport: async (_user: unknown, message: string) => {
    reports.push(message);
  },
  logAttackViolation: async () => {},
  logBanReport: async () => {},
}));

mock.module("../../../scripts/anticheat/anticheat.js", () => ({
  initAnticheat: async () => {},
  validateSave: async () => {},
}));

/** The defence the attack load served, when a test gives the session one (issue #195). */
let sessionForces: unknown;
/** The champions' brains the attack froze at launch, when a test gives the session some (issue #219). */
let sessionBrains: Record<string, BrainWeights> | undefined;

mock.module("../../../services/base/attackSessionStore.js", () => ({
  startAttackSession: async () => {},
  readAttackSession: async () => ({
    attackerid: ATTACKER,
    attackid: ATTACK_ID,
    startedat: Math.floor(Date.now() / 1000),
    entryHoused: ENTRY,
    defenderResources: { r1: 5000, r2: 0, r3: 0, r4: 0 },
    ...(sessionForces ? { defenderForces: sessionForces } : {}),
    ...(sessionBrains ? { championBrains: sessionBrains } : {}),
  }),
  endAttackSession: async () => {},
}));

// The real replay runner, unless a test asks for a replay that times out
// (issue #23, C5). The query makes the real module one no mock replaces.
const REAL_RUNNER = "../../../services/base/combat/replayRunner.ts?real";
const realRunner = (await import(REAL_RUNNER)) as typeof import("../../../services/base/combat/replayRunner.js");
let replayTimesOut = false;
mock.module("../../../services/base/combat/replayRunner.js", () => ({
  ...realRunner,
  replayAbandonedInWorker: async (...args: Parameters<typeof realRunner.replayAbandonedInWorker>) => {
    if (replayTimesOut) throw new realRunner.ReplayTimeoutError(5_000);
    return realRunner.replayAbandonedInWorker(...args);
  },
}));

const { baseSave } = await import("./baseSave.js");
const { combatConfig } = await import("../../../config/CombatConfig.js");
/** The mode the suite runs in, put back after a test changes it (C7). */
const MODE = combatConfig.mode;
const setMode = (mode: typeof MODE) => {
  (combatConfig as { mode: typeof MODE }).mode = mode;
};
const { attackLootOf } = await import("../../../services/base/combat/attackLoot.js");
const { replayAbandonedAttack } = await import("../../../services/base/combat/abandonedAttack.js");
const { battleReplayInput, battleTick, foughtLoot } = await import("../../../services/base/combat/battle.js");
const { decodeReplay } = await import("../../../services/defences/defenceReplayStore.js");
const { defenceReplayInput } = await import("../../../services/defences/recordDefenceReplay.js");

const ctxFor = (body: Record<string, string>) =>
  ({
    authUser: { userid: ATTACKER, username: "attacker" },
    request: { body: { baseid: "1234", basesaveid: "9", attackid: String(ATTACK_ID), ...body } },
    ip: "127.0.0.1",
    path: "/base/save",
  }) as unknown as Context;

const CLAIM = { r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 };

/**
 * The loot rule over the server's own battle, worked out as the save that ends
 * the attack does: a save with no tick is replayed to the longest end.
 */
const serverLoot = (flinglog: unknown, buildingdata: unknown) => {
  const args = {
    sent: CLAIM,
    reported: undefined,
    flinglog,
    session: { attackerid: ATTACKER, attackid: ATTACK_ID, startedat: 0, entryHoused: ENTRY },
    defender: { type: "tribe", buildingdata: buildingdata as never, buildinghealthdata: {}, resources: defender.resources },
    attacker: attackerSave,
    mapRoom3: false,
  };
  const input = battleReplayInput({ ...args, tick: battleTick(undefined), declareWar: false });
  return attackLootOf({ ...args, fought: input && foughtLoot(replayAbandonedAttack(input)) });
};

/** What the server's replay allows this attack, worked out the same way. */
const replayCap = (flinglog: unknown = LOG) => serverLoot(flinglog, YARD).cap;

// The mock outlives this file (bun keeps module mocks across files), so it is
// left delegating to the real runner.
afterEach(() => {
  replayTimesOut = false;
  setMode(MODE);
});

beforeEach(() => {
  replayTimesOut = false;
  sessionForces = undefined;
  sessionBrains = undefined;
  setMode("log");
  reports.length = 0;
  replays.length = 0;
  notices.length = 0;
  counted.length = 0;
  store.clear();
  defender = {
    basesaveid: 9,
    baseid: "1234",
    saveuserid: DEFENDER_OWNER,
    userid: DEFENDER_OWNER,
    type: "tribe",
    attackid: ATTACK_ID,
    savetime: 0,
    damage: 0,
    buildingdata: structuredClone(YARD),
    buildinghealthdata: {},
    resources: { r1: 5000, r2: 0, r3: 0, r4: 0 },
  };
  attackerSave = {
    basesaveid: 5,
    baseid: HOME,
    saveuserid: ATTACKER,
    userid: ATTACKER,
    type: "main",
    academy: {},
    champion: [],
    buildingdata: {},
    resources: { r1: 100, r2: 100, r3: 100, r4: 100 },
  };
});

describe("the plan a hand-played camp attack leaves (issue #221)", () => {
  test("the save that ends a Map Room 2 camp attack keeps the log the server fought, to its tick", async () => {
    upsert.mockClear();
    Object.assign(defender, { wmid: 11, level: 35 });
    attackerSave.mapversion = 2;

    await baseSave(ctxFor({ over: "1", tick: "3200", flinglog: JSON.stringify(LOG) }), async () => {});

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]![1]).toMatchObject({
      userid: ATTACKER,
      wmid: 11,
      level: 35,
      slot: "last",
      baseid: "1234",
      plan: { v: 1, tick: 3200, events: LOG.events },
    });
  });

  test("a save that does not end it, or one off Map Room 2, keeps none", async () => {
    upsert.mockClear();
    Object.assign(defender, { wmid: 11, level: 35 });
    attackerSave.mapversion = 2;
    await baseSave(ctxFor({ flinglog: JSON.stringify(LOG) }), async () => {});
    attackerSave.mapversion = 1;
    await baseSave(ctxFor({ over: "1", flinglog: JSON.stringify(LOG) }), async () => {});
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("the Kozu Town Hall a save brings down (issue #204)", () => {
  const kozuCrusher = () => attackerSave.achievements?.c?.["10"];

  test("the save that ends a Kozu camp attack with its Town Hall down counts towards Kozu Crusher", async () => {
    Object.assign(defender, { wmid: 11, level: 35 });
    attackerSave.mapversion = 2;
    attackerSave.achievements = { v: 1, s: {}, c: {}, backfilledAt: 1 };

    await baseSave(ctxFor({ over: "1", tick: "20000", flinglog: JSON.stringify(LOG) }), async () => {});

    expect(defender.buildinghealthdata["0"]).toBe(0);
    expect(kozuCrusher()).toMatchObject({ shiny: 10 });
  });

  test("a save that does not end it, or another tribe's camp, counts nothing", async () => {
    Object.assign(defender, { wmid: 11, level: 35 });
    attackerSave.mapversion = 2;
    attackerSave.achievements = { v: 1, s: {}, c: {}, backfilledAt: 1 };
    await baseSave(ctxFor({ tick: "20000", flinglog: JSON.stringify(LOG) }), async () => {});
    expect(kozuCrusher()).toBeUndefined();

    defender.wmid = 1;
    defender.attackid = ATTACK_ID;
    await baseSave(ctxFor({ over: "1", tick: "20000", flinglog: JSON.stringify(LOG) }), async () => {});
    expect(defender.buildinghealthdata["0"]).toBe(0);
    expect(kozuCrusher()).toBeUndefined();
  });
});

describe("the champion's learning brain through the save (issue #219)", () => {
  const BRAIN = { tower: 60, loot: -40, finish: 0, focus: 0, threat: 0 };
  const FORGED = { tower: -200, loot: 200, finish: 200, focus: 200, threat: 200 };
  const GORGO_LOG = {
    v: 1,
    seed: 5,
    events: [{ kind: "fling", t: 80, x: 400, y: 400, r: 200, monsters: { C4: 12 }, champion: { t: 1, l: 4, b: FORGED } }],
  };

  test("the save that ends the attack teaches the champion from the server's battle, once", async () => {
    const { learnFromLesson } = await import("../../../game-rules/combat/index.js");
    sessionBrains = { "1": BRAIN };
    attackerSave.champion = [{ t: 1, l: 4, hp: 100_000, status: 0, b: BRAIN, bs: { n: 2, hyb: 0 } }];
    // The battle the server fights: the frozen brain, never the log's forged one.
    const input = battleReplayInput({
      flinglog: GORGO_LOG,
      session: { attackerid: ATTACKER, attackid: ATTACK_ID, startedat: 0, entryHoused: ENTRY, championBrains: sessionBrains },
      defender: { type: "tribe", buildingdata: YARD as never, buildinghealthdata: {}, resources: defender.resources },
      attacker: structuredClone(attackerSave),
      tick: battleTick("3200"),
      declareWar: false,
    })!;
    expect(input.log.events[0]).toMatchObject({ champion: { b: BRAIN } });
    const lesson = replayAbandonedAttack(input).lessons!.find((one) => one.t === 1)!;
    const learned = learnFromLesson(BRAIN, { n: 2, hyb: 0 }, lesson, "hybrid");

    // A save that does not end it teaches nothing.
    await baseSave(ctxFor({ tick: "3200", flinglog: JSON.stringify(GORGO_LOG) }), async () => {});
    expect(attackerSave.champion[0].bs).toEqual({ n: 2, hyb: 0 });

    await baseSave(
      ctxFor({
        over: "1",
        tick: "3200",
        flinglog: JSON.stringify(GORGO_LOG),
        // A forged brain on the reported champion is dropped like any other key.
        attackerchampion: JSON.stringify([{ t: 1, l: 4, hp: 1, status: 0, b: FORGED, bs: { n: 999 } }]),
      }),
      async () => {}
    );
    expect(attackerSave.champion[0]).toMatchObject({ b: learned.brain, bs: learned.stats });
    expect(attackerSave.champion[0].bs.n).toBe(3);

    // The attack is over: a copy of the save is refused and teaches nothing more.
    const after = structuredClone(attackerSave.champion);
    await baseSave(ctxFor({ over: "1", tick: "3200", flinglog: JSON.stringify(GORGO_LOG) }), async () => {}).catch(
      () => {}
    );
    expect(attackerSave.champion).toEqual(after);
  });
});

describe("the Krallen Hunt's loot through the save", () => {
  const FORCED = process.env.EVENTS_FORCE_ON;
  beforeEach(() => {
    // A day no hunt runs on its own; the forced one starts that midnight.
    setSystemTime(new Date("2026-10-20T12:00:00Z"));
    process.env.EVENTS_FORCE_ON = "krallen-2026-11";
    attackerSave.buildingdata = { "0": { id: 0, t: 14, l: 6, X: 0, Y: 0 } };
  });
  afterEach(() => {
    setSystemTime();
    if (FORCED === undefined) delete process.env.EVENTS_FORCE_ON;
    else process.env.EVENTS_FORCE_ON = FORCED;
  });

  const sum = (amounts: Record<string, number>) => amounts.r1! + amounts.r2! + amounts.r3! + amounts.r4!;

  test("the save that ends the attack counts the replay's credit once, loot that did not fit included", async () => {
    const cap = replayCap();
    expect(sum(cap)).toBeGreaterThan(0);
    // Storage far over any cap: nothing lands, all of it counts.
    attackerSave.resources = { r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 };
    await baseSave(ctxFor({ over: "1", attackloot: JSON.stringify(CLAIM), flinglog: JSON.stringify(LOG) }), async () => {});

    expect(attackerSave.resources).toEqual({ r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 });
    // What the server's battle took, not the 4 billion the save claimed.
    expect(counted).toEqual([["krallen-2026-11", sum(cap)]]);
  });

  test("a save that does not end the attack counts nothing", async () => {
    await baseSave(ctxFor({ attackloot: JSON.stringify(CLAIM), flinglog: JSON.stringify(LOG) }), async () => {});
    expect(counted).toEqual([]);
  });

  test("below Town Hall 6, or outside the event, nothing counts", async () => {
    attackerSave.buildingdata = { "0": { id: 0, t: 14, l: 5, X: 0, Y: 0 } };
    await baseSave(ctxFor({ over: "1", flinglog: JSON.stringify(LOG) }), async () => {});
    attackerSave.buildingdata = { "0": { id: 0, t: 14, l: 6, X: 0, Y: 0 } };
    delete process.env.EVENTS_FORCE_ON;
    defender.attackid = ATTACK_ID;
    await baseSave(ctxFor({ over: "1", flinglog: JSON.stringify(LOG) }), async () => {});
    expect(counted).toEqual([]);
  });

  test("an attack save cannot hand the attacker a Krallen", async () => {
    attackerSave.champion = [];
    await baseSave(
      ctxFor({
        over: "1",
        flinglog: JSON.stringify(LOG),
        attackerchampion: JSON.stringify([{ t: 5, hp: 62_000, l: 5, ft: 0, fd: 0, fb: 0, pl: 2, status: 0 }]),
      }),
      async () => {}
    );
    expect(attackerSave.champion).toEqual([]);
  });
});

describe("the shop boosts through the save (beta.4)", () => {
  // Two Pokeys at the Cannon Tower: it kills them before they finish it, so
  // how hard they hit and how much they take shows in the tower's health.
  const FEW = {
    v: 1,
    seed: 5,
    events: [{ kind: "fling", t: 80, x: 220, y: 220, r: 30, monsters: { C1: 2 } }],
  };
  const ALL = { monsterDamage: true, monsterArmour: true, monsterSpeed: true };
  const forces = (buffs?: unknown) => ({
    bunkers: {},
    defenderLevels: {},
    defenderChampions: [],
    ...(buffs ? { buffs } : {}),
  });

  /** The tower's health after the server's own battle against `defence`. */
  const serverHealth = (defence: unknown) => {
    const session = { attackerid: ATTACKER, attackid: ATTACK_ID, startedat: 0, entryHoused: ENTRY, defenderForces: defence };
    const input = battleReplayInput({
      flinglog: FEW,
      session: session as never,
      defender: { type: "tribe", buildingdata: YARD as never, buildinghealthdata: {}, resources: defender.resources },
      attacker: attackerSave,
      tick: battleTick(undefined),
      declareWar: false,
    });
    return replayAbandonedAttack(input!).buildinghealthdata["1"];
  };

  const save = (body: Record<string, string> = {}) =>
    baseSave(
      ctxFor({ over: "1", flinglog: JSON.stringify(FEW), buildinghealthdata: JSON.stringify({}), ...body }),
      async () => {}
    );

  test("the attacker's boosts change the server's battle", () => {
    const plain = serverHealth(forces());
    expect(plain).toBeGreaterThan(0);
    expect(serverHealth(forces({ attacker: ALL }))).toBeLessThan(plain);
    // The same boosts, the same battle.
    expect(serverHealth(forces({ attacker: ALL }))).toBe(serverHealth(forces({ attacker: ALL })));
    // The defender's Tower Overdrive kills them sooner.
    expect(serverHealth(forces({ defender: { towerDamage: true } }))).toBeGreaterThan(plain);
  });

  test("the save is fought with the boosts the attack load froze", async () => {
    sessionForces = forces({ attacker: ALL });
    await save();
    expect(defender.buildinghealthdata["1"]).toBe(serverHealth(forces({ attacker: ALL })));
  });

  test("a client cannot claim a boost: the save's own say and the attacker's store are ignored", async () => {
    sessionForces = forces();
    // A boost bought after the load, and a save that claims every boost.
    attackerSave.storedata = { MOD: { q: 1, e: 4e9 }, MDOD: { q: 1, e: 4e9 }, MSOD: { q: 1, e: 4e9 } };
    await save({
      defenderforces: JSON.stringify(forces({ attacker: ALL })),
      buffs: JSON.stringify({ attacker: ALL }),
      attpowerups: JSON.stringify({ MOD: 1, MDOD: 1, MSOD: 1 }),
    });
    expect(defender.buildinghealthdata["1"]).toBe(serverHealth(forces()));
  });
});

describe("attack loot through the save", () => {
  test("a save that does not end the attack credits nothing, whatever it claims", async () => {
    await baseSave(
      ctxFor({ attackloot: JSON.stringify(CLAIM), resources: JSON.stringify({ r1: -5000 }), flinglog: JSON.stringify(LOG) }),
      async () => {}
    );

    expect(attackerSave.resources).toEqual({ r1: 100, r2: 100, r3: 100, r4: 100 });
    expect(defender.resources.r1).toBe(5000);
  });

  test("the save that ends it credits no more than the replay, and nothing else it sends", async () => {
    const cap = replayCap();
    expect(cap.r1).toBeGreaterThan(0);

    await baseSave(
      ctxFor({
        over: "1",
        attackloot: JSON.stringify({ ...CLAIM, r1max: 1e12, bogus: 5 }),
        flinglog: JSON.stringify(LOG),
      }),
      async () => {}
    );

    expect(attackerSave.resources).toEqual({
      r1: 100 + cap.r1,
      r2: 100 + cap.r2,
      r3: 100 + cap.r3,
      r4: 100 + cap.r4,
    });
    // The defender lost at least what the attacker banked.
    expect(defender.resources.r1).toBeLessThanOrEqual(5000 - cap.r1);
  });

  test("the attacker keeps only what fits in their storage; the defender still loses it (#166)", async () => {
    const cap = replayCap();
    // No silos: a cap of 10,000. r1 has 200 of room, r2 none, r3 is over.
    attackerSave.resources = { r1: 9_800, r2: 10_000, r3: 12_000, r4: 100 };
    const ctx = ctxFor({
      over: "1",
      attackloot: JSON.stringify(cap),
      resources: JSON.stringify({ r1: -cap.r1 }),
      flinglog: JSON.stringify(LOG),
    });

    await baseSave(ctx, async () => {});

    const kept = { r1: Math.min(200, cap.r1), r2: 0, r3: 0, r4: Math.min(9_900, cap.r4) };
    expect(cap.r1).toBeGreaterThan(200);
    expect(attackerSave.resources).toEqual({ r1: 9_800 + kept.r1, r2: 10_000, r3: 12_000, r4: 100 + kept.r4 });
    expect((ctx.body as { lootcredited?: unknown }).lootcredited).toEqual(kept);
    expect(defender.resources.r1).toBe(5000 - cap.r1);
  });

  test("a bomb's cost leaves the pool before the loot fills it", async () => {
    const log = { ...LOG, events: [{ kind: "bomb", t: 40, x: 200, y: 200, id: "tw0" }, ...LOG.events] };
    const cap = replayCap(log);
    expect(cap.r1).toBeGreaterThan(0);
    attackerSave.catapult = 1;
    attackerSave.resources = { r1: 10_000, r2: 0, r3: 0, r4: 0 };

    await baseSave(
      ctxFor({ over: "1", attackloot: JSON.stringify(cap), flinglog: JSON.stringify(log) }),
      async () => {}
    );

    // tw0 costs 10,000 twigs: the pool is emptied, then refilled by the loot.
    expect(attackerSave.resources.r1).toBe(Math.min(10_000, cap.r1));
  });

  test("a Krallen flung in the attack raises the attacker's cap", async () => {
    const log = { ...LOG, events: [...LOG.events, { kind: "fling", t: 90, x: 400, y: 400, r: 200, monsters: {}, champion: { t: 5, l: 1 } }] };
    attackerSave.champion = [{ t: 5, l: 1 }];
    const cap = replayCap(log);
    expect(cap.r1).toBeGreaterThan(0);
    attackerSave.resources = { r1: 10_000, r2: 0, r3: 0, r4: 0 };

    await baseSave(
      ctxFor({ over: "1", attackloot: JSON.stringify(cap), flinglog: JSON.stringify(log) }),
      async () => {}
    );

    // Level 1 Krallen: `buffs` 0.2, so the cap is 12,000 rather than the 10,000 held.
    expect(attackerSave.resources.r1).toBe(Math.min(12_000, 10_000 + cap.r1));
  });

  test("a claim with no fling log is credited nothing", async () => {
    await baseSave(ctxFor({ over: "1", attackloot: JSON.stringify(CLAIM) }), async () => {});

    expect(attackerSave.resources).toEqual({ r1: 100, r2: 100, r3: 100, r4: 100 });
    expect(defender.resources.r1).toBe(5000);
  });
});

describe("the attacker's army through the save (issue #164)", () => {
  const ARMY = { housed: { C4: 12 }, saved: 0 };

  test("a crafted monsterupdate or attackcreatures cannot overwrite the army", async () => {
    attackerSave.monsters = structuredClone(ARMY);
    const crafted = { housed: { C4: 5000, C20: 400 } };

    await baseSave(
      ctxFor({ monsterupdate: JSON.stringify(crafted), attackcreatures: JSON.stringify(crafted) }),
      async () => {}
    );
    await baseSave(
      ctxFor({ over: "1", monsterupdate: JSON.stringify(crafted), attackcreatures: JSON.stringify(crafted) }),
      async () => {}
    );

    expect(attackerSave.monsters).toEqual(ARMY);
  });
});

describe("a fallen bunker's garrison through the save (issue #130)", () => {
  // Three Pokeys dropped on a stocked Monster Bunker bring it down, and never
  // reach the far one; four would outlast the Cannon Tower, which shoots softer
  // as it is dented (#264).
  const RAID = {
    v: 1,
    seed: 5,
    events: [{ kind: "fling", t: 80, x: 440, y: 440, r: 200, monsters: { C1: 3 } }],
  };
  const BUNKERS = {
    "2": { id: 2, t: 22, l: 1, X: 420, Y: 420, m: { C1: 5 } },
    "3": { id: 3, t: 22, l: 1, X: -600, Y: -600, m: { C2: 4 } },
  };

  const armed = () => {
    defender.buildingdata = { ...structuredClone(YARD), ...structuredClone(BUNKERS) };
  };

  /** What the server's own battle brings down, as the save works it out. */
  const serverFallen = () => serverLoot(RAID, defender.buildingdata).fallen;

  const save = (health: Record<string, number>, over = true) =>
    baseSave(
      ctxFor({
        ...(over && { over: "1" }),
        flinglog: JSON.stringify(RAID),
        buildinghealthdata: JSON.stringify(health),
      }),
      async () => {}
    );

  test("a bunker the save and the server's battle both bring down loses its garrison", async () => {
    armed();
    expect(serverFallen()).toContain(2);

    await save({ "2": 0 });

    expect(defender.buildingdata["2"].m).toBeUndefined();
    expect(defender.buildingdata["2"]).toMatchObject({ id: 2, t: 22, l: 1 });
    expect(defender.buildingdata["3"].m).toEqual({ C2: 4 });
  });

  test("a save that claims a bunker the battle never reached fell empties nothing", async () => {
    armed();
    expect(serverFallen()).not.toContain(3);

    await save({ "2": 0, "3": 0 });

    expect(defender.buildingdata["3"].m).toEqual({ C2: 4 });
  });

  test("the server's battle decides, whatever the save reports (#23, C3)", async () => {
    armed();

    // The save says the bunker stands; the replay brought it down.
    await save({ "2": 1500 });

    expect(defender.buildingdata["2"].m).toBeUndefined();
    expect(defender.buildinghealthdata["2"]).toBe(0);
  });

  test("a save that does not end the attack empties nothing", async () => {
    armed();

    await save({ "2": 0 }, false);

    expect(defender.buildingdata["2"].m).toEqual({ C1: 5 });
  });
});

describe("a fallen Housing's monsters through the save (issue #160)", () => {
  // Three Pokeys dropped on a Housing bring it down, and never reach the far one;
  // four would outlast the Cannon Tower, which shoots softer as it is dented (#264).
  const RAID = {
    v: 1,
    seed: 5,
    events: [{ kind: "fling", t: 80, x: 440, y: 440, r: 200, monsters: { C1: 3 } }],
  };
  const HOUSINGS = {
    "2": { id: 2, t: 15, l: 1, X: 420, Y: 420 },
    "3": { id: 3, t: 15, l: 1, X: -600, Y: -600 },
  };

  const armed = (type = "main", housings: Record<string, unknown> = HOUSINGS) => {
    Object.assign(defender, { type, mapversion: 2, wmid: 0, attacks: [], attackid: ATTACK_ID });
    defender.buildingdata = { ...structuredClone(YARD), ...structuredClone(housings) };
    defender.buildinghealthdata = {};
    defender.monsters = { housed: { C1: 10, C2: 1 }, space: 400 };
  };

  const save = (over = true, tick?: number) =>
    baseSave(
      ctxFor({
        ...(over && { over: "1" }),
        ...(tick !== undefined && { tick: String(tick) }),
        flinglog: JSON.stringify(RAID),
      }),
      async () => {}
    );

  test("the fallen Housing's share goes when the attack lands, and the report says so", async () => {
    armed();

    await save();

    expect(defender.buildinghealthdata["2"]).toBe(0);
    expect(defender.buildinghealthdata["3"] ?? 1).toBeGreaterThan(0);
    // One of two: half of each stack, halves up.
    expect(defender.monsters).toEqual({ housed: { C1: 5 }, space: 400 });
    const lines = String(defender.attackreport).split("\n");
    expect(lines.at(-2)).toBe("A Housing fell: 5 Pokeys and 1 Octo-ooze were lost.");
    expect(lines.at(-1)).toStartWith("Result:");
  });

  test("a Map Room 2 outpost loses its own housed monsters, and its owner is told", async () => {
    armed("outpost");
    // The outpost's base id carries its cell (`rangeCheck.ts`).
    defender.baseid = "1000243206";
    notices.length = 0;

    await save();

    expect(defender.monsters.housed).toEqual({ C1: 5 });
    expect(notices).toHaveLength(1);
    expect(String(notices[0]!.message)).toEndWith(", and 6 housed monsters were lost.");
  });

  test("a Housing repaired before its owner's next load still lost them", async () => {
    armed();
    await save();

    // Repaired in full, then the owner's load catches the army up.
    const { catchUpMonsters } = await import("../../../services/yard/catchUpMonsters.js");
    const now = Math.floor(Date.now() / 1000);
    const yard: Record<string, any> = { ...structuredClone(defender), buildinghealthdata: {} };
    catchUpMonsters(yard, now, now, []);

    expect(yard.monsters.housed).toEqual({ C1: 5 });
  });

  test("with no Housing fallen, or nothing lost, the roster and the report are as they were", async () => {
    // Stopped before the Pokeys bring anything down.
    armed();
    await save(true, 100);
    expect(defender.buildinghealthdata["2"] ?? 1).toBeGreaterThan(0);
    expect(defender.monsters.housed).toEqual({ C1: 10, C2: 1 });
    expect(String(defender.attackreport)).not.toContain("Housing");

    armed();
    defender.monsters = { housed: {} };
    await save();
    expect(defender.buildinghealthdata["2"]).toBe(0);
    expect(String(defender.attackreport)).not.toContain("Housing");
  });

  test("a save that does not end the attack costs nothing", async () => {
    armed();

    await save(false);

    expect(defender.monsters.housed).toEqual({ C1: 10, C2: 1 });
  });

  test("a wild monster camp has no housing to lose", async () => {
    armed("tribe");

    await save();

    expect(defender.monsters.housed).toEqual({ C1: 10, C2: 1 });
  });
});

describe("the attacker's own row through the save (#23, C1)", () => {
  const champion = (hp: number, l = 2) => ({ t: 1, hp, l, ft: 0, fd: 0, fb: 0, pl: 0, status: 0 });
  const withGorgo = {
    ...LOG,
    events: [
      ...LOG.events,
      { kind: "fling", t: 90, x: 400, y: 400, r: 200, monsters: {}, champion: { t: 1, l: 2 } },
      { kind: "siege", t: 100, x: 400, y: 400, weapon: "jars" },
    ],
  };

  const save = (body: Record<string, string>) =>
    baseSave(ctxFor({ flinglog: JSON.stringify(withGorgo), ...body }), async () => {});

  beforeEach(() => {
    attackerSave.champion = [champion(500)];
    attackerSave.siege = { jars: { quantity: 2 } };
  });

  test("an attack save cannot hand the attacker a Krallen", async () => {
    attackerSave.champion = [];
    await save({
      over: "1",
      attackerchampion: JSON.stringify([{ t: 5, hp: 62_000, l: 5, ft: 0, fd: 0, fb: 0, pl: 2, status: 0 }]),
    });
    expect(attackerSave.champion).toEqual([]);
  });

  test("a crafted save cannot raise a champion's level or health, nor add siege", async () => {
    await save({
      over: "1",
      attackerchampion: JSON.stringify([champion(99_999, 6), { ...champion(1), t: 3 }]),
      attackersiege: JSON.stringify({ jars: { quantity: 99 }, rocket: { quantity: 5 } }),
    });

    // It fought, so it learned from the battle (issue #219); nothing else moved.
    expect(attackerSave.champion).toEqual([{ ...champion(500), b: expect.any(Object), bs: expect.objectContaining({ n: 1 }) }]);
    // The one jar the log used is spent, whatever the save said the stock was.
    expect(attackerSave.siege).toEqual({ jars: { quantity: 1 } });
  });

  test("an honest save's champion damage and siege use still land", async () => {
    await save({
      over: "1",
      attackerchampion: JSON.stringify([champion(180)]),
      attackersiege: JSON.stringify({ jars: { quantity: 1 } }),
    });

    expect(attackerSave.champion).toEqual([{ ...champion(180), b: expect.any(Object), bs: expect.objectContaining({ n: 1 }) }]);
    expect(attackerSave.siege).toEqual({ jars: { quantity: 1 } });
  });

  test("a save that does not end the attack changes neither", async () => {
    await save({ attackerchampion: JSON.stringify([champion(1)]) });

    expect(attackerSave.champion).toEqual([champion(500)]);
    expect(attackerSave.siege).toEqual({ jars: { quantity: 2 } });
  });
});

describe("the defender's monsters through the save (#23, C2)", () => {
  const HOUSING = { housed: { C1: 40, C3: 6 }, h: [["", 0, [["C1", 5, 3]]]], hid: [9], space: 120 };

  test("an attack save cannot touch them, final or not", async () => {
    defender.monsters = structuredClone(HOUSING);
    const wiped = JSON.stringify({ housed: {}, h: [], hid: [], space: 0 });

    await baseSave(ctxFor({ monsters: wiped, flinglog: JSON.stringify(LOG) }), async () => {});
    await baseSave(ctxFor({ over: "1", monsters: wiped, flinglog: JSON.stringify(LOG) }), async () => {});

    expect(defender.monsters).toEqual(HOUSING);
  });
});

describe("a replay past its deadline (#23, C5)", () => {
  test("lands nothing and leaves the attack to the finaliser", async () => {
    replayTimesOut = true;
    const caught = await baseSave(
      ctxFor({ over: "1", attackloot: JSON.stringify(CLAIM), flinglog: JSON.stringify(LOG) }),
      async () => {}
    ).catch((err: unknown) => err as { data?: { reason?: string } });

    expect(caught?.data?.reason).toBe("replayTimeout");
    expect(attackerSave.resources).toEqual({ r1: 100, r2: 100, r3: 100, r4: 100 });
    expect(defender.resources.r1).toBe(5000);
    // The row still carries the attack, for the finaliser to finish.
    expect(defender.attackid).toBe(ATTACK_ID);
  });
});

describe("the battle is the server's (#23, C3)", () => {
  // The camp, and a Booby Trap far from where the Ogres land, which never fires.
  const WITH_TRAP = { ...YARD, "3": { id: 3, t: 24, l: 1, X: -800, Y: -800 } };
  const TICK = 2_000;

  /** What the server's own replay of LOG to TICK does to the camp. */
  const serverBattle = (left = false) =>
    replayAbandonedAttack(
      battleReplayInput({
        flinglog: LOG,
        session: { attackerid: ATTACKER, attackid: ATTACK_ID, startedat: 0, entryHoused: ENTRY },
        defender: { type: "tribe", buildingdata: WITH_TRAP as never, buildinghealthdata: {}, resources: { r1: 5000, r2: 0, r3: 0, r4: 0 } },
        attacker: attackerSave,
        tick: battleTick(TICK),
        declareWar: false,
        left,
      })!
    );

  beforeEach(() => {
    defender.buildingdata = structuredClone(WITH_TRAP);
  });

  test("a crafted save's damage, health, destroyed and traps are never written", async () => {
    const battle = serverBattle();
    expect(battle.damage).toBeLessThan(100);

    await baseSave(
      ctxFor({
        over: "1",
        tick: String(TICK),
        flinglog: JSON.stringify(LOG),
        damage: "100",
        destroyed: "1",
        buildinghealthdata: JSON.stringify({ "0": 0, "1": 0, "3": 0 }),
        buildingdata: JSON.stringify({}),
        attackreport: "0:01 Flung 9999 Pokey\nResult: 100% damage, all of it",
      }),
      async () => {}
    );

    expect(defender.damage).toBe(Math.trunc(battle.damage));
    // The report is the replay's (C6), and says the battle as it went.
    expect(defender.attackreport).toBe(battle.attackreport);
    expect(String(defender.attackreport)).not.toContain("9999");
    expect(String(defender.attackreport)).not.toContain("Left the attack");
    expect(defender.destroyed).toBe(battle.destroyed);
    expect(defender.buildinghealthdata).toEqual(battle.buildinghealthdata);
    // The trap the battle never reached is still there.
    expect(defender.buildingdata["3"]).toMatchObject({ t: 24 });
  });

  test("an honest save lands exactly the figures its client showed", async () => {
    const battle = serverBattle();

    await baseSave(
      ctxFor({
        over: "1",
        tick: String(TICK),
        flinglog: JSON.stringify(LOG),
        damage: String(battle.damage),
        ...(battle.destroyed !== undefined && { destroyed: String(battle.destroyed) }),
        buildinghealthdata: JSON.stringify(battle.buildinghealthdata),
        attackloot: JSON.stringify(battle.attackloot),
      }),
      async () => {}
    );

    expect(defender.damage).toBe(Math.trunc(battle.damage));
    expect(defender.buildinghealthdata).toEqual(battle.buildinghealthdata);
    expect(attackerSave.resources.r1).toBe(100 + battle.attackloot.r1);
  });

  /** A save that claims the camp was wrecked and a fortune taken. */
  const crafted = () =>
    ctxFor({
      over: "1",
      tick: String(TICK),
      flinglog: JSON.stringify(LOG),
      damage: "100",
      destroyed: "1",
      buildinghealthdata: JSON.stringify({ "0": 0, "1": 0, "3": 0 }),
      attackloot: JSON.stringify(CLAIM),
    });

  test("log: a crafted save is flagged with one Report row, and the server's figures land (C7)", async () => {
    const battle = serverBattle();
    await baseSave(crafted(), async () => {});

    // The camp does fall (99%), so the claimed `destroyed` is the battle's own.
    expect(reports).toEqual([
      "Attack save on base 1234 flagged (log): disagrees with the replay on " +
        "damage, buildinghealthdata, attackloot",
    ]);
    expect(defender.damage).toBe(Math.trunc(battle.damage));
  });

  test("reject: a crafted save is refused before anything is written, the attack left to the finaliser (C7)", async () => {
    setMode("reject");
    const caught = await baseSave(crafted(), async () => {}).catch(
      (err: unknown) => err as { data?: { reason?: string; fields?: string[] } }
    );

    expect(caught?.data?.reason).toBe("replayMismatch");
    expect(caught?.data?.fields).toEqual(["damage", "buildinghealthdata", "attackloot"]);
    expect(reports).toHaveLength(1);
    expect(defender.damage).toBe(0);
    expect(defender.buildinghealthdata).toEqual({});
    expect(defender.resources.r1).toBe(5000);
    expect(attackerSave.resources).toEqual({ r1: 100, r2: 100, r3: 100, r4: 100 });
    // The row still carries the attack, for the finaliser to land from its checkpoint.
    expect(defender.attackid).toBe(ATTACK_ID);
  });

  test("reject: an honest save lands as ever (C7)", async () => {
    setMode("reject");
    const battle = serverBattle();

    await baseSave(
      ctxFor({
        over: "1",
        tick: String(TICK),
        flinglog: JSON.stringify(LOG),
        damage: String(battle.damage),
        ...(battle.destroyed !== undefined && { destroyed: String(battle.destroyed) }),
        buildinghealthdata: JSON.stringify(battle.buildinghealthdata),
        buildingdata: JSON.stringify(WITH_TRAP),
        attackloot: JSON.stringify(battle.attackloot),
      }),
      async () => {}
    );

    expect(reports).toEqual([]);
    expect(defender.damage).toBe(Math.trunc(battle.damage));
    expect(attackerSave.resources.r1).toBe(100 + battle.attackloot.r1);
  });

  test("reject: a siege stock the log does not explain is logged, not refused, and never written (#201)", async () => {
    setMode("reject");
    attackerSave.siege = { jars: { quantity: 2 } };
    const battle = serverBattle();
    const caught = await baseSave(
      ctxFor({
        over: "1",
        tick: String(TICK),
        flinglog: JSON.stringify(LOG),
        damage: String(battle.damage),
        ...(battle.destroyed !== undefined && { destroyed: String(battle.destroyed) }),
        buildinghealthdata: JSON.stringify(battle.buildinghealthdata),
        attackloot: JSON.stringify(battle.attackloot),
        attackersiege: JSON.stringify({ jars: { quantity: 99 } }),
      }),
      async () => {}
    ).catch((err: unknown) => err);

    expect(caught).toBeUndefined();
    expect(defender.damage).toBe(Math.trunc(battle.damage));
    expect(attackerSave.siege).toEqual({ jars: { quantity: 2 } });
  });

  test("a save that says the player left gets the report's line for it, and nothing else changes", async () => {
    const battle = serverBattle(true);
    expect(battle.attackreport).toContain("Left the attack");

    await baseSave(ctxFor({ over: "1", tick: String(TICK), left: "1", flinglog: JSON.stringify(LOG) }), async () => {});

    expect(defender.attackreport).toBe(battle.attackreport);
    expect(defender.damage).toBe(Math.trunc(serverBattle().damage));
    expect(defender.buildinghealthdata).toEqual(serverBattle().buildinghealthdata);
  });

  test("a save that does not end the attack writes nothing of the battle", async () => {
    await baseSave(
      ctxFor({
        flinglog: JSON.stringify(LOG),
        damage: "100",
        buildinghealthdata: JSON.stringify({ "0": 0 }),
        buildingdata: JSON.stringify({}),
      }),
      async () => {}
    );

    expect(defender.damage).toBe(0);
    expect(defender.buildinghealthdata).toEqual({});
    expect(defender.attackreport ?? null).toBeNull();
    expect(defender.buildingdata["3"]).toMatchObject({ t: 24 });
  });
});

describe("the defence lands (#195)", () => {
  // The camp with a Monster Bunker holding three Pokeys and a Champion Cage,
  // both where the Finks land.
  const DEFENDED = {
    ...YARD,
    "5": { id: 5, t: 22, l: 1, X: 360, Y: 360, m: { C1: 3 } },
    "6": { id: 6, t: 114, l: 1, X: 440, Y: 440 },
  };
  const FORCES = {
    bunkers: { 5: { C1: 3 } },
    defenderLevels: { C1: 3 },
    defenderChampions: [{ t: 1, l: 1, hp: 3000, pl: 0 }],
  };
  const GORGO = { t: 1, l: 1, hp: 3000, pl: 0, status: 0, fd: 0, ft: 0, fb: 0 };
  const TICK = 4_000;

  const serverBattle = (forces: typeof FORCES = FORCES) =>
    replayAbandonedAttack(
      battleReplayInput({
        flinglog: LOG,
        session: {
          attackerid: ATTACKER,
          attackid: ATTACK_ID,
          startedat: 0,
          entryHoused: ENTRY,
          defenderForces: forces,
        },
        defender: {
          type: "tribe",
          buildingdata: DEFENDED as never,
          buildinghealthdata: {},
          resources: { r1: 5000, r2: 0, r3: 0, r4: 0 },
        },
        attacker: attackerSave,
        tick: battleTick(TICK),
        declareWar: false,
        left: false,
      })!
    );

  beforeEach(() => {
    sessionForces = FORCES;
    defender.buildingdata = structuredClone(DEFENDED);
    defender.champion = [{ ...GORGO }];
  });

  test("the caged champion keeps the health the battle left it, and the bunker what it left", async () => {
    const battle = serverBattle();
    expect(battle.defenderChampions[0]?.hp).toBeLessThan(3000);
    expect(Object.keys(battle.bunkerLosses).length).toBeGreaterThan(0);

    await baseSave(ctxFor({ over: "1", tick: String(TICK), flinglog: JSON.stringify(LOG) }), async () => {});

    expect(defender.champion).toEqual([{ ...GORGO, hp: Math.floor(battle.defenderChampions[0]!.hp) }]);
    const garrison = battle.bunkerGarrisons[5]!;
    const entry = defender.buildingdata["5"] as { m?: unknown };
    if (Object.keys(garrison).length > 0) expect(entry.m).toEqual(garrison);
    else expect("m" in entry).toBe(false);
  });

  test("a save that sends the champion back unhurt is flagged over it", async () => {
    await baseSave(
      ctxFor({
        over: "1",
        tick: String(TICK),
        flinglog: JSON.stringify(LOG),
        champion: JSON.stringify([GORGO]),
      }),
      async () => {}
    );

    expect(reports.some((line) => line.includes("champion"))).toBe(true);
    expect((defender.champion as { hp: number }[])[0]!.hp).toBeLessThan(3000);
  });

  test("a champion hurt before its owner left heals up to the attack before savetime moves past it", async () => {
    // Stored at 1,000 two hours ago: a level 1 Gorgo is full (40,000) an hour
    // after that. Nothing of the champion fights here, so the healing alone shows.
    sessionForces = { ...FORCES, defenderChampions: [] };
    defender.savetime = Math.floor(Date.now() / 1000) - 2 * 3_600;
    defender.champion = [{ ...GORGO, hp: 1_000 }];

    await baseSave(ctxFor({ over: "1", tick: String(TICK), flinglog: JSON.stringify(LOG) }), async () => {});

    expect(defender.champion).toEqual([{ ...GORGO, hp: 40_000 }]);
  });

  test("the battle's health lands on the healed champion, not on the stale stored health", async () => {
    // The attack load served the champion healed to its full 40,000
    // (`servedDefenderForces`); its row still says 100 from an hour before,
    // and a level 1 Gorgo heals from empty to full in an hour.
    const served = { ...FORCES, defenderChampions: [{ t: 1, l: 1, hp: 40_000, pl: 0 }] };
    sessionForces = served;
    const left = Math.floor(serverBattle(served).defenderChampions[0]!.hp);
    expect(left).toBeGreaterThan(100);
    defender.savetime = Math.floor(Date.now() / 1000) - 3_600;
    defender.champion = [{ ...GORGO, hp: 100 }];

    await baseSave(ctxFor({ over: "1", tick: String(TICK), flinglog: JSON.stringify(LOG) }), async () => {});

    // What the battle left of the 40,000 it fought with, not the row's 100.
    expect(defender.champion).toEqual([{ ...GORGO, hp: left }]);
  });
});

describe("the defence replay a save lands (issue #359)", () => {
  const LOAD_KEY = "defence-replay-load:9";
  /** The defender as another player's Map Room 2 main yard, its attack load kept. */
  const asPlayerYard = () => {
    Object.assign(defender, { type: "main", mapversion: 2, damage: 7, attacks: [], protected: 0 });
    attackerSave.mapversion = 2;
    store.set(
      LOAD_KEY,
      JSON.stringify({
        attackid: ATTACK_ID,
        load: gzipSync(JSON.stringify({ type: "main", basename: "Their yard", buildingdata: YARD, credits: 5 })).toString("base64"),
      })
    );
  };

  test("the save that ends the attack records it once, from the battle the server fought", async () => {
    asPlayerYard();

    await baseSave(ctxFor({ over: "1", tick: "3200", flinglog: JSON.stringify(LOG) }), async () => {});

    expect(replays).toHaveLength(1);
    const row = replays[0]!;
    expect(row).toMatchObject({
      defender_userid: DEFENDER_OWNER,
      baseid: "1234",
      map_version: 2,
      attacker_userid: ATTACKER,
      attacker_username: "attacker",
      damage_before: 7,
      damage_after: defender.damage,
      attacker_left: false,
    });
    expect(defender.damage).toBeGreaterThan(7);
    const payload = decodeReplay(row.replay);
    expect(payload).toMatchObject({ seed: LOG.seed, tick: 3200, events: LOG.events });
    expect(payload.load.basename).toBe("Their yard");
    expect(payload.load).not.toHaveProperty("credits");

    // Played again from what was stored, it is the battle that landed.
    const again = replayAbandonedAttack(defenceReplayInput(payload));
    expect(Math.trunc(again.damage)).toBe(defender.damage);
    expect(again.buildinghealthdata).toEqual(defender.buildinghealthdata);

    // The kept load goes with the checkpoint.
    expect(store.has(LOAD_KEY)).toBe(false);
  });

  test("its owner is told as a Map Room 1 player is, the notice carrying the replay (#361)", async () => {
    asPlayerYard();

    await baseSave(ctxFor({ over: "1", tick: "3200", flinglog: JSON.stringify(LOG) }), async () => {});

    expect(replays).toHaveLength(1);
    expect(notices).toEqual([
      expect.objectContaining({
        userid: 0,
        targetid: DEFENDER_OWNER,
        messagetype: "yardattacked",
        subject: "attacker attacked your yard",
        coords: null,
        baseid: "1234",
        targetUnread: 1,
        replayid: 1,
      }),
    ]);
    expect(String(notices[0]!.message)).toStartWith(`It was left ${defender.damage}% damaged`);
  });

  test("a Map Room 1 main yard's owner is told the same words, with no replay", async () => {
    asPlayerYard();
    defender.mapversion = 1;

    await baseSave(ctxFor({ over: "1", tick: "3200", flinglog: JSON.stringify(LOG) }), async () => {});

    expect(replays).toEqual([]);
    expect(notices).toEqual([
      expect.objectContaining({ targetid: DEFENDER_OWNER, messagetype: "yardattacked", subject: "attacker attacked your yard" }),
    ]);
    expect(notices[0]).not.toHaveProperty("replayid");
  });

  test("a save that does not end the attack tells nobody yet", async () => {
    asPlayerYard();
    await baseSave(ctxFor({ tick: "800", flinglog: JSON.stringify(LOG) }), async () => {});
    expect(notices).toEqual([]);
  });

  test("a save that left the attack says so", async () => {
    asPlayerYard();
    await baseSave(ctxFor({ over: "1", left: "1", tick: "3200", flinglog: JSON.stringify(LOG) }), async () => {});
    expect(replays[0]).toMatchObject({ attacker_left: true });
  });

  test("a save that does not end the attack records nothing and keeps the load", async () => {
    asPlayerYard();
    await baseSave(ctxFor({ tick: "800", flinglog: JSON.stringify(LOG) }), async () => {});
    expect(replays).toEqual([]);
    expect(store.has(LOAD_KEY)).toBe(true);
  });

  test("a save past its replay deadline records nothing and leaves the load to the finaliser", async () => {
    asPlayerYard();
    replayTimesOut = true;
    await baseSave(ctxFor({ over: "1", flinglog: JSON.stringify(LOG) }), async () => {}).catch(() => {});
    expect(replays).toEqual([]);
    expect(store.has(LOAD_KEY)).toBe(true);
  });

  test.each([
    ["a Map Room 1 main yard", { mapversion: 1 }],
    ["an outpost", { type: "outpost" }],
    ["a camp", { type: "tribe" }],
    ["the attacker's own yard", { saveuserid: ATTACKER }],
  ])("%s is not recorded", async (_name, overrides) => {
    asPlayerYard();
    Object.assign(defender, overrides);
    // The attacker's own yard is not an attack at all: that save is refused.
    await baseSave(ctxFor({ over: "1", tick: "3200", flinglog: JSON.stringify(LOG) }), async () => {}).catch(() => {});
    expect(replays).toEqual([]);
  });
});
