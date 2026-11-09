import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { attackWindowSeconds } from "../../base/attackWindow.js";
import type { Context } from "koa";
import { withTribeGooBonus } from "../../base/tribeGooBonus.js";

/**
 * Issue #161: a `/base/save` naming a Map Room 1 tribe base used to credit
 * `attackloot` (and overwrite the army) with no attack behind it. It is now
 * bound to an attack session the attack load minted for this caller on this
 * tribe, lands once, and its loot is capped by what the tribe holds.
 */

const ATTACKER = 2503;
const OTHER = 77;
const TRIBE = "2"; // Legionnaire, Town Hall 1-2 tier
const ATTACK_ID = 4242;

const store = new Map<string, string>();
const sets = new Map<string, Set<string>>();
/** A Redis delete this picks fails, as if the server died right there. */
let crashOn: ((key: string) => boolean) | null = null;
/** The landing's database write fails. */
let flushFails = false;
let maproom: { userid: number; tribedata: Record<string, unknown>[] };
let userSave: Record<string, unknown>;
const persisted: unknown[] = [];
/** The event counter writes (`services/events/progressStore.ts`), as `[event, amount]`. */
const counted: [string, number][] = [];

/** The stand-in ORM's entity manager: only it skips the request context (the finaliser's own). */
const fakeOrmEm = {};

mock.module("../../../server.js", () => ({
  postgres: {
    orm: { em: fakeOrmEm },
    em: {
      populate: async (user: Record<string, unknown>) => {
        user.save = userSave;
      },
      // The finaliser loads the attacker with their row; anything else is the Map Room 1 row.
      findOne: async (entity: { name?: string }) =>
        entity?.name === "User" ? { userid: ATTACKER, username: "attacker", save: userSave } : maproom,
      persist: (entity: unknown) => persisted.push(entity),
      flush: async () => {
        if (flushFails) throw new Error("the database refused the write");
      },
      // Only the event counter's SQL is answered; anything else fails as with no database.
      execute: async (sql: string, params: unknown[]) => {
        if (!sql.includes("event_progress")) throw new Error("no database");
        counted.push([String(params[1]), Number(params[2])]);
        return [{ counter: params[2] }];
      },
      // The Goals tribe counter's own locked write reads the attacker's row (#227).
      transactional: async <T>(cb: (tx: unknown) => Promise<T>) =>
        cb({ findOne: async () => userSave, flush: async () => {} }),
    },
  },
  redis: {
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
    del: async (key: string) => {
      if (crashOn?.(key)) throw new Error("the server stopped here");
      return store.delete(key) ? 1 : 0;
    },
    sadd: async (key: string, member: string) => {
      const set = sets.get(key) ?? new Set<string>();
      sets.set(key, set);
      if (set.has(member)) return 0;
      set.add(member);
      return 1;
    },
    srem: async (key: string, member: string) => (sets.get(key)?.delete(member) ? 1 : 0),
    smembers: async (key: string) => [...(sets.get(key) ?? [])],
  },
}));

const warn = mock((..._args: unknown[]) => {});
mock.module("../../../utils/logger.js", () => ({
  logger: { warn, error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

// The audit trail (issue #23, C7), kept here rather than on the stand-in rows.
const reports: string[] = [];
mock.module("../../base/reportManager.js", () => ({
  logReport: async (_user: unknown, message: string) => {
    reports.push(message);
  },
  logAttackViolation: async () => {},
  logBanReport: async () => {},
}));

// The real replay runner, unless a test asks for a replay that times out
// (issue #23, C5). The query makes the real module one no mock replaces.
const REAL_RUNNER = "../../base/combat/replayRunner.ts?real";
const realRunner = (await import(REAL_RUNNER)) as typeof import("../../base/combat/replayRunner.js");
let replayTimesOut = false;
mock.module("../../base/combat/replayRunner.js", () => ({
  ...realRunner,
  replayAbandonedInWorker: async (...args: Parameters<typeof realRunner.replayAbandonedInWorker>) => {
    if (replayTimesOut) throw new realRunner.ReplayTimeoutError(5_000);
    return realRunner.replayAbandonedInWorker(...args);
  },
}));

const core = await import("@mikro-orm/core");
// Kept before the stand-in replaces the module in place. Object.create keeps the
// static getEntityManager the DB tests that run later need, and any other
// entity manager still gets a real request context.
const RealRequestContext = core.RequestContext;
const realCreate = core.RequestContext.create.bind(core.RequestContext);
mock.module("@mikro-orm/core", () => ({
  ...core,
  RequestContext: Object.assign(Object.create(RealRequestContext), {
    create: (em: unknown, next: () => unknown) => (em === fakeOrmEm ? next() : realCreate(em as never, next as never)),
  }),
}));

const { baseSave } = await import("../../../controllers/base/save/baseSave.js");
const { attackCheckpoint } = await import("../../../controllers/base/attackCheckpoint.js");
const { ROWLESS_CLOSE_ATTEMPTS, finaliseExpiredRowlessAttacks, finaliseRowlessAttacksOf } = await import(
  "../../base/finaliseRowlessAttack.js"
);
const { mr1TribeFinalLockKey } = await import("./mr1TribeSession.js");
const { ROWLESS_CHECKPOINT_INDEX, rowlessCheckpointKey } = await import("../../base/rowlessCheckpoint.js");
const { combatConfig } = await import("../../../config/CombatConfig.js");
const { emptyQuests, questsJson, readQuests } = await import("../../quests/state.js");
/** The mode the suite runs in, put back after a test changes it (C7). */
const MODE = combatConfig.mode;
const setMode = (mode: typeof MODE) => {
  (combatConfig as { mode: typeof MODE }).mode = mode;
};
const { mr1TribeSessionKey } = await import("./mr1TribeSession.js");
const { serialiseAttackSession } = await import("../../base/attackSession.js");
const { mr1TribePool } = await import("./mr1TribeRules.js");
const { MR1_TRIBES_MAP } = await import("../../../game-data/tribes/v1/index.js");
const { LOOT_GAIN_RATIO } = await import("../../../game-rules/combat/index.js");
const { replayAbandonedAttack } = await import("../../base/combat/abandonedAttack.js");
const { battleReplayInput, battleTick } = await import("../../base/combat/battle.js");
const { readOnboarding } = await import("../../onboarding/state.js");

const now = () => Math.floor(Date.now() / 1000);

const startSession = (attackerid = ATTACKER, startedat = now(), housed: Record<string, number> = { C1: 10 }) =>
  store.set(
    mr1TribeSessionKey(ATTACKER, TRIBE),
    serialiseAttackSession({ attackerid, attackid: ATTACK_ID, startedat, entryHoused: { "5000": housed } })
  );

/**
 * Real battles on the Legionnaire camp (issue #23, C4): sixty Pokeys by its
 * harvesters wreck it by the end of the countdown; four barely scratch it.
 */
const WRECK = { v: 1, seed: 7, events: [{ kind: "fling", t: 40, x: 300, y: 150, r: 100, monsters: { C1: 60 } }] };
const WRECK_TICK = 24_000;

/** A day's record with one "Catapult 2 Town Halls" quest. */
const catapultQuestDay = () =>
  questsJson({
    ...emptyQuests(),
    daily: {
      period: new Date().toISOString().slice(0, 10),
      bonus: false,
      swaps: 0,
      quests: [{ slot: 0, kind: "catapultHit", variant: "14", need: 2, have: 0, claimed: false, rewards: [] }],
    },
  } as never);
const catapultQuestHave = () => readQuests(userSave.dailyquests).daily?.quests[0]?.have;
/** A fight with one bomb at this spot; this tribe's Town Hall stands at (-70, -65). */
const wreckWithBomb = (x: number, y: number) => ({
  ...WRECK,
  events: [...WRECK.events, { kind: "bomb", t: 50, x, y, id: "tw0" }],
});
const onQuestSave = () => Object.assign(userSave, { type: "main", basesaveid: 9000, catapult: 4, dailyquests: catapultQuestDay() });
const SCRATCH = { v: 1, seed: 7, events: [{ kind: "fling", t: 40, x: 300, y: 150, r: 100, monsters: { C1: 4 } }] };
const SCRATCH_TICK = 2_400;
const ARMY = { C1: 64 };

/** What the server's own replay of `log` to `tick` does to the tribe, as it stands. */
const serverBattle = (log: unknown, tick: number) => {
  const template = MR1_TRIBES_MAP.get(TRIBE)!;
  return replayAbandonedAttack(
    battleReplayInput({
      flinglog: log,
      session: { attackerid: ATTACKER, attackid: ATTACK_ID, startedat: 0, entryHoused: { "5000": ARMY } },
      defender: {
        type: "tribe",
        kind: "tribe",
        buildingdata: template.buildingdata as never,
        buildinghealthdata: (maproom.tribedata[0]!.tribeHealthData ?? {}) as never,
        resources: template.resources as never,
      },
      attacker: userSave as never,
      tick: battleTick(tick),
      declareWar: false,
    })!
  );
};

/** The mismatch lines logged so far, by their fields. */
const mismatches = () =>
  warn.mock.calls
    .map((call) => call[1] as { event?: string; fields?: string[] } | undefined)
    .filter((line) => line?.event === "attack-replay-mismatch")
    .map((line) => line!.fields);

const ctxFor = (body: Record<string, string>, userid = ATTACKER) =>
  ({
    authUser: { userid, username: "attacker" },
    request: { body: { baseid: TRIBE, basesaveid: "0", ...body } },
    ip: "127.0.0.1",
    path: "/base/save",
  }) as unknown as Context;

const run = async (ctx: Context): Promise<{ data?: { reason?: string } } | null> => {
  try {
    await baseSave(ctx, async () => {});
    return null;
  } catch (caught) {
    return caught as { data?: { reason?: string } };
  }
};

const loot = (amounts: Record<string, number>) => JSON.stringify(amounts);

// The mock outlives this file (bun keeps module mocks across files), so it is
// left delegating to the real runner.
afterEach(() => {
  replayTimesOut = false;
  setMode(MODE);
});

beforeEach(() => {
  crashOn = null;
  flushFails = false;
  replayTimesOut = false;
  setMode("log");
  reports.length = 0;
  warn.mockClear();
  store.clear();
  sets.clear();
  persisted.length = 0;
  counted.length = 0;
  maproom = { userid: ATTACKER, tribedata: [{ baseid: TRIBE, tribeHealthData: {} }] };
  userSave = {
    userid: ATTACKER,
    baseid: "5000",
    resources: { r1: 100, r2: 100, r3: 100, r4: 100 },
    savetime: now(),
    buildingdata: {},
    storedata: {},
    academy: {},
    monsters: { housed: { C1: 10 } },
    wmstatus: [[2, 1, 0]],
  };
});

describe("Map Room 1 tribe save without a started attack (#161)", () => {
  test("credits nothing and writes nothing", async () => {
    const caught = await run(
      ctxFor({ over: "1", attackloot: loot({ r1: 1_000_000 }), attackcreatures: JSON.stringify({ C1: 999 }), destroyed: "1" })
    );

    expect(caught?.data?.reason).toBe("no-session");
    expect(userSave.resources).toEqual({ r1: 100, r2: 100, r3: 100, r4: 100 });
    expect((userSave.monsters as { housed: unknown }).housed).toEqual({ C1: 10 });
    expect(maproom.tribedata[0]!.destroyed).toBeUndefined();
    expect(persisted).toEqual([]);
  });

  test("another account's attack on the same tribe does not authorise the save", async () => {
    startSession(OTHER);
    const caught = await run(ctxFor({ over: "1", attackloot: loot({ r1: 50 }) }));
    expect(caught?.data?.reason).toBe("wrong-attacker");
    expect((userSave.resources as Record<string, number>).r1).toBe(100);
  });

  test("an attack started longer ago than its window no longer authorises it", async () => {
    startSession(ATTACKER, now() - attackWindowSeconds() - 1);
    const caught = await run(ctxFor({ over: "1", attackloot: loot({ r1: 50 }) }));
    expect(caught?.data?.reason).toBe("expired");
  });

  test("a save naming another attack id is refused", async () => {
    startSession();
    const caught = await run(ctxFor({ over: "1", attackid: "1", attackloot: loot({ r1: 50 }) }));
    expect(caught?.data?.reason).toBe("stale-attack");
  });
});

describe("Map Room 1 tribe save of a started attack", () => {
  test("the save that ends it credits the replay's loot once and ends the session", async () => {
    startSession(ATTACKER, now(), ARMY);
    const battle = serverBattle(WRECK, WRECK_TICK);
    expect(battle.damage).toBeGreaterThanOrEqual(90);
    const ctx = ctxFor({
      over: "1",
      attackid: String(ATTACK_ID),
      tick: String(WRECK_TICK),
      flinglog: JSON.stringify(WRECK),
      attackloot: loot({ r1: 50, r2: 7 }),
      destroyed: "1",
      damage: "97.5",
    });

    expect(await run(ctx)).toBeNull();
    const { r1, r2, r3, r4 } = battle.attackloot;
    // Wild tribes give 25% more Goo (patch 6.9).
    const r4WithBonus = withTribeGooBonus({ r4 }, true).r4;
    expect(userSave.resources).toEqual({ r1: 100 + r1, r2: 100 + r2, r3: 100 + r3, r4: 100 + r4WithBonus });
    expect(maproom.tribedata[0]).toMatchObject({
      destroyed: 1,
      damage: Math.trunc(battle.damage),
      looted: battle.attackloot,
      tribeHealthData: battle.buildinghealthdata,
    });
    expect(store.has(mr1TribeSessionKey(ATTACKER, TRIBE))).toBe(false);
    // Goal WM1 (#227): a Legionnaire tribe destroyed, counted on the attacker's row.
    expect(readOnboarding(userSave).counters.tribes).toMatchObject({ legionnaire: 1, kozu: 0 });

    // The same save sent again as the page closes lands nothing.
    const again = await run(ctxFor({ over: "1", attackid: String(ATTACK_ID), flinglog: JSON.stringify(WRECK) }));
    expect(again?.data?.reason).toBe("no-session");
    expect((userSave.resources as Record<string, number>).r1).toBe(100 + r1);
  });

  test("loot beyond what the tribe has left is cut to it", async () => {
    startSession(ATTACKER, now(), ARMY);
    const cap = Math.floor(mr1TribePool(MR1_TRIBES_MAP.get(TRIBE)!).r1 * LOOT_GAIN_RATIO);
    // An earlier attack took all but 100 twigs of what the tribe can give.
    maproom.tribedata[0]!.looted = { r1: cap - 100 };
    await run(ctxFor({ over: "1", tick: String(WRECK_TICK), flinglog: JSON.stringify(WRECK), attackloot: loot({ r1: 1e12 }) }));

    expect((userSave.resources as Record<string, number>).r1).toBe(200);
  });

  test("the attacker keeps only what fits in their storage; the tribe still loses it all (#166)", async () => {
    startSession(ATTACKER, now(), ARMY);
    const battle = serverBattle(WRECK, WRECK_TICK);
    // No silos: a cap of 10,000.
    userSave.resources = { r1: 100, r2: 9_950, r3: 10_000, r4: 12_000 };
    const ctx = ctxFor({ over: "1", tick: String(WRECK_TICK), flinglog: JSON.stringify(WRECK) });

    expect(await run(ctx)).toBeNull();
    expect(userSave.resources).toEqual({ r1: 100 + battle.attackloot.r1, r2: 10_000, r3: 10_000, r4: 12_000 });
    expect((ctx.body as { lootcredited?: unknown }).lootcredited).toEqual({ r1: battle.attackloot.r1, r2: 50, r3: 0, r4: 0 });
    expect(maproom.tribedata[0]!.looted).toEqual(battle.attackloot);
  });

  test("a save that does not end the attack writes nothing of the battle and credits nothing", async () => {
    startSession(ATTACKER, now(), ARMY);
    expect(
      await run(
        ctxFor({
          tick: String(WRECK_TICK),
          flinglog: JSON.stringify(WRECK),
          attackloot: loot({ r1: 50 }),
          damage: "40",
          buildinghealthdata: JSON.stringify({ "0": 0 }),
        })
      )
    ).toBeNull();
    expect((userSave.resources as Record<string, number>).r1).toBe(100);
    expect(maproom.tribedata[0]!.damage).toBeUndefined();
    expect(maproom.tribedata[0]!.tribeHealthData).toEqual({});
    expect(store.has(mr1TribeSessionKey(ATTACKER, TRIBE))).toBe(true);
  });
});

describe("Map Room 1 tribe save of a camp gone since the attack began", () => {
  const CAMP = "1"; // the guide's practice camp

  test("the practice camp, removed by a guide skip mid-attack, still lands the attack, gives nothing and stays gone", async () => {
    store.set(
      mr1TribeSessionKey(ATTACKER, CAMP),
      serialiseAttackSession({ attackerid: ATTACKER, attackid: ATTACK_ID, startedat: now(), entryHoused: { "5000": ARMY } })
    );
    const ctx = ctxFor({
      baseid: CAMP,
      over: "1",
      tick: String(WRECK_TICK),
      flinglog: JSON.stringify(WRECK),
      attackloot: loot({ r1: 1e6, r2: 1e6, r3: 1e6, r4: 1e6 }),
    });

    expect(await run(ctx)).toBeNull();
    expect(userSave.resources).toEqual({ r1: 100, r2: 100, r3: 100, r4: 100 });
    expect(store.has(mr1TribeSessionKey(ATTACKER, CAMP))).toBe(false);
    expect(maproom.tribedata.map((tribe) => tribe.baseid)).toEqual([TRIBE]);
  });

  test("any other tribe gone from the player's Map Room is still refused", async () => {
    startSession(ATTACKER, now(), ARMY);
    maproom.tribedata = [];
    const caught = await run(ctxFor({ over: "1", tick: String(WRECK_TICK), flinglog: JSON.stringify(WRECK) }));

    expect(caught?.data?.reason).toBe("baseGone");
  });
});

describe("Map Room 1 army settlement (#132)", () => {
  const flinglog = (C1: number) => JSON.stringify({ events: [{ kind: "fling", t: 10, monsters: { C1 } }] });
  const sent = (C1: number) => JSON.stringify([{ baseid: 5000, m: { housed: { C1 } } }]);

  test("the flung monsters leave the main yard's housing, from the fling log", async () => {
    startSession();
    expect(await run(ctxFor({ over: "1", monsterupdate: sent(7), flinglog: flinglog(3) }))).toBeNull();
    expect((userSave.monsters as { housed: unknown }).housed).toEqual({ C1: 7 });
  });

  test("Flash's attackcreatures blob is never written", async () => {
    startSession();
    await run(ctxFor({ over: "1", monsterupdate: sent(10), flinglog: flinglog(0), attackcreatures: JSON.stringify({ housed: { C1: 999 } }) }));
    expect((userSave.monsters as { housed: unknown }).housed).toEqual({ C1: 10 });
  });

  test("a fling log claiming more than was housed at entry takes only what was there, never adds", async () => {
    startSession();
    await run(ctxFor({ over: "1", monsterupdate: sent(99), flinglog: flinglog(50) }));
    expect((userSave.monsters as { housed: Record<string, number> }).housed.C1 ?? 0).toBe(0);
  });

  test("a save that does not end the attack leaves the army alone", async () => {
    startSession();
    await run(ctxFor({ monsterupdate: sent(7), flinglog: flinglog(3) }));
    expect((userSave.monsters as { housed: unknown }).housed).toEqual({ C1: 10 });
  });

  // The web client's final save, field for field as `saveAttack` form-encodes
  // it (`web/src/api/base.ts`; the payload is `buildAttackSave`'s): string
  // ids, the main yard's entry keyed by its string base id, the fling log in
  // its versioned shape, and keys the tribe path does not read at all.
  test("the web client's final save lands: loot, army, damage, session ended", async () => {
    startSession(ATTACKER, now(), ARMY);
    userSave.monsters = { housed: { ...ARMY } };
    const battle = serverBattle(WRECK, WRECK_TICK);
    const ctx = ctxFor({
      basesaveid: "0",
      attackid: String(ATTACK_ID),
      over: "1",
      tick: String(WRECK_TICK),
      buildingdata: JSON.stringify(MR1_TRIBES_MAP.get(TRIBE)!.buildingdata),
      buildinghealthdata: JSON.stringify(battle.buildinghealthdata),
      damage: String(battle.damage),
      destroyed: "1",
      monsterupdate: JSON.stringify([{ baseid: "5000", m: { housed: { C1: 4 }, space: 40 } }]),
      attackloot: loot(battle.attackloot),
      resources: loot(battle.defenderDelta),
      attackreport: "0:01 Flung 60 Pokey\nResult: 100% damage",
      flinglog: JSON.stringify(WRECK),
    });

    expect(await run(ctx)).toBeNull();
    const { r1, r2, r3, r4 } = battle.attackloot;
    // Wild tribes give 25% more Goo (patch 6.9).
    const r4WithBonus = withTribeGooBonus({ r4 }, true).r4;
    expect(userSave.resources).toEqual({ r1: 100 + r1, r2: 100 + r2, r3: 100 + r3, r4: 100 + r4WithBonus });
    expect((userSave.monsters as { housed: unknown }).housed).toEqual({ C1: 4 });
    expect(maproom.tribedata[0]).toMatchObject({ destroyed: 1, damage: Math.trunc(battle.damage) });
    expect(store.has(mr1TribeSessionKey(ATTACKER, TRIBE))).toBe(false);
    // It fought the same battle, so nothing is flagged.
    expect(mismatches()).toEqual([]);
  });
});

describe("Map Room 1 tribe save: the attacker's own row (#23, C1)", () => {
  const champion = (hp: number, l = 2) => ({ t: 1, hp, l, ft: 0, fd: 0, fb: 0, pl: 0, status: 0 });
  const log = {
    v: 1,
    seed: 5,
    events: [
      { kind: "fling", t: 40, x: 0, y: 0, r: 100, monsters: { C1: 1 }, champion: { t: 1, l: 2 } },
      { kind: "siege", t: 60, x: 0, y: 0, weapon: "jars" },
    ],
  };

  test("takes the champion's health only downwards and spends only the siege the log used", async () => {
    startSession();
    userSave.champion = [champion(500)];
    userSave.siege = { jars: { quantity: 2 } };

    const caught = await run(
      ctxFor({
        over: "1",
        attackid: String(ATTACK_ID),
        flinglog: JSON.stringify(log),
        attackerchampion: JSON.stringify([champion(99_999, 6)]),
        attackersiege: JSON.stringify({ jars: { quantity: 99 }, rocket: { quantity: 5 } }),
      })
    );

    expect(caught).toBeNull();
    // It fought, so it learned from the battle (issue #219); nothing else moved.
    expect(userSave.champion).toEqual([{ ...champion(500), b: expect.any(Object), bs: expect.objectContaining({ n: 1 }) }]);
    expect(userSave.siege).toEqual({ jars: { quantity: 1 } });
  });

  test("an honest champion's damage lands", async () => {
    startSession();
    userSave.champion = [champion(500)];

    await run(
      ctxFor({
        over: "1",
        attackid: String(ATTACK_ID),
        flinglog: JSON.stringify(log),
        attackerchampion: JSON.stringify([champion(120)]),
      })
    );

    expect(userSave.champion).toEqual([{ ...champion(120), b: expect.any(Object), bs: expect.objectContaining({ n: 1 }) }]);
  });

  test("a champion healed by Vorgs keeps the server's battle's heal, never the save's figure", async () => {
    const { championStatWithFood } = await import("../../../game-rules/combat/stats.js");
    const full = championStatWithFood("G3", "health", 4, 0);
    const low = Math.floor(full * 0.05);
    store.set(
      mr1TribeSessionKey(ATTACKER, TRIBE),
      serialiseAttackSession({
        attackerid: ATTACKER,
        attackid: ATTACK_ID,
        startedat: now(),
        entryHoused: { "5000": { C16: 6 } },
        championHealth: { "3": low },
      })
    );
    userSave.champion = [{ t: 3, hp: low, l: 4, ft: 0, fd: 0, fb: 0, pl: 0, status: 0 }];
    const vorgLog = {
      v: 1,
      seed: 5,
      events: [{ kind: "fling", t: 40, x: 0, y: 0, r: 100, monsters: { C16: 6 }, champion: { t: 3, l: 4 } }],
    };

    await run(
      ctxFor({
        over: "1",
        attackid: String(ATTACK_ID),
        flinglog: JSON.stringify(vorgLog),
        tick: "3000",
        attackerchampion: JSON.stringify([{ t: 3, hp: full, l: 4, ft: 0, fd: 0, fb: 0, pl: 0, status: 0 }]),
      })
    );

    expect((userSave.champion as { hp: number }[])[0]!.hp).toBeGreaterThan(low);
    expect((userSave.champion as { hp: number }[])[0]!.hp).toBeLessThan(full);
  });
});

describe("Map Room 1 tribe save: the catapult quest", () => {
  beforeEach(onQuestSave);

  test("a bomb that lands on the tribe's building counts", async () => {
    startSession();
    await run(ctxFor({ over: "1", tick: String(WRECK_TICK), flinglog: JSON.stringify(wreckWithBomb(-70, -65)) }));
    expect(catapultQuestHave()).toBe(1);
  });

  test("a bomb that lands far from the building does not", async () => {
    startSession();
    await run(ctxFor({ over: "1", tick: String(WRECK_TICK), flinglog: JSON.stringify(wreckWithBomb(20_000, 20_000)) }));
    expect(catapultQuestHave()).toBe(0);
  });
});

describe("Map Room 1 tribe save: the tribe's monsters (#23, C2)", () => {
  test("stay as stored whatever the save sends", async () => {
    startSession();
    const stored = { housed: { C1: 12 } };
    maproom.tribedata[0]!.monsters = structuredClone(stored);

    const caught = await run(
      ctxFor({
        over: "1",
        attackid: String(ATTACK_ID),
        monsters: JSON.stringify({ housed: { C1: 0 } }),
      })
    );

    expect(caught).toBeNull();
    expect(maproom.tribedata[0]!.monsters).toEqual(stored);
  });

  test("a tribe with none stored keeps none: its template's is what it is served", async () => {
    startSession();

    await run(ctxFor({ over: "1", attackid: String(ATTACK_ID), monsters: JSON.stringify({ housed: { C1: 999 } }) }));

    expect(maproom.tribedata[0]!.monsters).toBeUndefined();
  });
});

describe("Map Room 1 tribe save: the battle is the server's (#23, C4)", () => {
  test("a crafted save's damage, health, destroyed and loot are never written", async () => {
    startSession(ATTACKER, now(), ARMY);
    const battle = serverBattle(SCRATCH, SCRATCH_TICK);
    expect(battle.damage).toBeLessThan(5);

    const caught = await run(
      ctxFor({
        over: "1",
        attackid: String(ATTACK_ID),
        tick: String(SCRATCH_TICK),
        flinglog: JSON.stringify(SCRATCH),
        damage: "100",
        destroyed: "1",
        buildinghealthdata: JSON.stringify({ "0": 0, "1": 0, "2": 0 }),
        attackloot: loot({ r1: 20_000, r2: 20_000, r3: 0, r4: 0 }),
      })
    );

    expect(caught).toBeNull();
    expect(maproom.tribedata[0]).toMatchObject({
      destroyed: 0,
      damage: Math.trunc(battle.damage),
      tribeHealthData: battle.buildinghealthdata,
    });
    expect(maproom.tribedata[0]!.destroyedAt).toBeUndefined();
    expect(userSave.wmstatus).toEqual([[2, 1, 0]]);
    expect(userSave.resources).toEqual({
      r1: 100 + battle.attackloot.r1,
      r2: 100 + battle.attackloot.r2,
      r3: 100 + battle.attackloot.r3,
      r4: 100 + battle.attackloot.r4,
    });
    expect(mismatches()).toEqual([["damage", "destroyed", "buildinghealthdata", "attackloot"]]);
  });

  test("the tribe is marked destroyed past the camp's threshold, as the web client marks it", async () => {
    startSession(ATTACKER, now(), ARMY);
    await run(ctxFor({ over: "1", tick: String(WRECK_TICK), flinglog: JSON.stringify(WRECK) }));

    expect(maproom.tribedata[0]!.destroyed).toBe(1);
    expect(maproom.tribedata[0]!.destroyedAt).toBeGreaterThan(0);
    expect(userSave.wmstatus).toEqual([[2, 1, 1]]);
  });

  test("a final save without a usable fling log writes no battle and credits nothing", async () => {
    startSession(ATTACKER, now(), ARMY);
    const caught = await run(
      ctxFor({ over: "1", damage: "100", destroyed: "1", attackloot: loot({ r1: 5_000 }), flinglog: "not a log" })
    );

    expect(caught).toBeNull();
    expect(userSave.resources).toEqual({ r1: 100, r2: 100, r3: 100, r4: 100 });
    expect(maproom.tribedata[0]!.destroyed).toBeUndefined();
    expect(maproom.tribedata[0]!.damage).toBeUndefined();
    expect(store.has(mr1TribeSessionKey(ATTACKER, TRIBE))).toBe(false);
  });

  test("a replay past its deadline lands nothing and keeps the session for a resent save", async () => {
    startSession(ATTACKER, now(), ARMY);
    userSave.monsters = { housed: { ...ARMY } };
    replayTimesOut = true;
    const body = {
      over: "1",
      tick: String(WRECK_TICK),
      flinglog: JSON.stringify(WRECK),
      monsterupdate: JSON.stringify([{ baseid: "5000", m: { housed: { C1: 4 } } }]),
    };

    const caught = await run(ctxFor(body));
    expect(caught?.data?.reason).toBe("replayTimeout");
    expect(userSave.resources).toEqual({ r1: 100, r2: 100, r3: 100, r4: 100 });
    expect((userSave.monsters as { housed: unknown }).housed).toEqual(ARMY);
    expect(maproom.tribedata[0]!.damage).toBeUndefined();
    expect(persisted).toEqual([]);
    expect(store.has(mr1TribeSessionKey(ATTACKER, TRIBE))).toBe(true);

    // The lock is free again, so the same save sent again lands.
    replayTimesOut = false;
    expect(await run(ctxFor(body))).toBeNull();
    expect(maproom.tribedata[0]!.destroyed).toBe(1);
  });
});

describe("Map Room 1 tribe save under COMBAT_SAVE_VALIDATION (#23, C7)", () => {
  const craftedBody = {
    over: "1",
    attackid: String(ATTACK_ID),
    tick: String(SCRATCH_TICK),
    flinglog: JSON.stringify(SCRATCH),
    damage: "100",
    destroyed: "1",
    attackloot: loot({ r1: 20_000, r2: 0, r3: 0, r4: 0 }),
  };

  test("log: a crafted save is flagged with one Report row, and the server's figures land", async () => {
    startSession(ATTACKER, now(), ARMY);
    expect(await run(ctxFor(craftedBody))).toBeNull();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("flagged (log)");
    expect(maproom.tribedata[0]!.destroyed).toBe(0);
  });

  test("reject: a crafted save is refused and lands nothing", async () => {
    setMode("reject");
    startSession(ATTACKER, now(), ARMY);
    userSave.monsters = { housed: { ...ARMY } };

    const caught = await run(ctxFor(craftedBody));
    expect(caught?.data?.reason).toBe("replayMismatch");
    expect(reports).toHaveLength(1);
    expect(userSave.resources).toEqual({ r1: 100, r2: 100, r3: 100, r4: 100 });
    expect((userSave.monsters as { housed: unknown }).housed).toEqual(ARMY);
    expect(maproom.tribedata[0]!.damage).toBeUndefined();
    expect(persisted).toEqual([]);
  });

  test("reject: the web client's honest final save lands", async () => {
    setMode("reject");
    startSession(ATTACKER, now(), ARMY);
    const battle = serverBattle(WRECK, WRECK_TICK);

    const caught = await run(
      ctxFor({
        over: "1",
        attackid: String(ATTACK_ID),
        tick: String(WRECK_TICK),
        flinglog: JSON.stringify(WRECK),
        buildingdata: JSON.stringify(MR1_TRIBES_MAP.get(TRIBE)!.buildingdata),
        buildinghealthdata: JSON.stringify(battle.buildinghealthdata),
        damage: String(battle.damage),
        destroyed: "1",
        attackloot: loot(battle.attackloot),
      })
    );

    expect(caught).toBeNull();
    expect(reports).toEqual([]);
    expect(maproom.tribedata[0]!.destroyed).toBe(1);
  });
});

describe("Map Room 1 tribe save: the Krallen Hunt's loot", () => {
  const FORCED = process.env.EVENTS_FORCE_ON;
  beforeEach(() => {
    // A day no hunt runs on its own; the forced one starts that midnight.
    setSystemTime(new Date("2026-10-20T12:00:00Z"));
    process.env.EVENTS_FORCE_ON = "krallen-2026-11";
    // Town Hall 6 (type 14): old enough to take part.
    userSave.buildingdata = { "0": { id: 0, t: 14, X: 0, Y: 0, l: 6 } };
  });
  afterEach(() => {
    setSystemTime();
    if (FORCED === undefined) delete process.env.EVENTS_FORCE_ON;
    else process.env.EVENTS_FORCE_ON = FORCED;
  });

  const total = (amounts: Record<string, number>) => amounts.r1! + amounts.r2! + amounts.r3! + amounts.r4!;

  test("the save that ends the attack counts the whole credit once, loot that did not fit included", async () => {
    startSession(ATTACKER, now(), ARMY);
    const battle = serverBattle(WRECK, WRECK_TICK);
    // A full store: nothing lands, all of it counts.
    userSave.resources = { r1: 10_000, r2: 10_000, r3: 10_000, r4: 10_000 };
    expect(await run(ctxFor({ over: "1", tick: String(WRECK_TICK), flinglog: JSON.stringify(WRECK) }))).toBeNull();
    expect(userSave.resources).toEqual({ r1: 10_000, r2: 10_000, r3: 10_000, r4: 10_000 });
    expect(total(battle.attackloot)).toBeGreaterThan(0);
    expect(counted).toEqual([["krallen-2026-11", total(battle.attackloot)]]);

    // The same save sent again as the page closes counts nothing more.
    await run(ctxFor({ over: "1", tick: String(WRECK_TICK), flinglog: JSON.stringify(WRECK) }));
    expect(counted).toHaveLength(1);
  });

  test("a save that does not end the attack counts nothing", async () => {
    startSession(ATTACKER, now(), ARMY);
    await run(ctxFor({ tick: String(WRECK_TICK), flinglog: JSON.stringify(WRECK), attackloot: loot({ r1: 50 }) }));
    expect(counted).toEqual([]);
  });

  test("below Town Hall 6 nothing counts", async () => {
    userSave.buildingdata = { "0": { id: 0, t: 14, X: 0, Y: 0, l: 5 } };
    startSession(ATTACKER, now(), ARMY);
    expect(await run(ctxFor({ over: "1", tick: String(WRECK_TICK), flinglog: JSON.stringify(WRECK) }))).toBeNull();
    expect(counted).toEqual([]);
  });

  test("outside the event nothing counts", async () => {
    delete process.env.EVENTS_FORCE_ON;
    startSession(ATTACKER, now(), ARMY);
    expect(await run(ctxFor({ over: "1", tick: String(WRECK_TICK), flinglog: JSON.stringify(WRECK) }))).toBeNull();
    expect(counted).toEqual([]);
  });
});

/**
 * Leaving never undoes the attack (owner, 2 Nov 2026): when the final save
 * never arrives, the attacker's next load lands the attack from the last
 * checkpoint the server holds, and never more than that record shows.
 */
describe("Map Room 1 tribe attack left without a save", () => {
  const REF = { kind: "mr1" as const, userid: ATTACKER, baseid: TRIBE };

  const checkpoint = async (log: unknown, tick: number) => {
    const ctx = {
      authUser: { userid: ATTACKER, username: "attacker" },
      request: {
        body: {
          basesaveid: "0",
          baseid: TRIBE,
          attackid: String(ATTACK_ID),
          tick: String(tick),
          flinglog: JSON.stringify(log),
          sources: JSON.stringify(["5000"]),
        },
      },
      ip: "127.0.0.1",
    } as unknown as Context & { body: Record<string, unknown> };
    try {
      await attackCheckpoint(ctx, async () => {});
      return ctx.body;
    } catch (caught) {
      return caught as { data?: { reason?: string } };
    }
  };

  const finalSave = () =>
    ctxFor({ over: "1", attackid: String(ATTACK_ID), tick: String(WRECK_TICK), flinglog: JSON.stringify(WRECK) });

  test("a catapult hit in the last checkpoint counts for the quest", async () => {
    onQuestSave();
    startSession(ATTACKER, now(), ARMY);
    userSave.monsters = { housed: { ...ARMY } };
    expect(await checkpoint(wreckWithBomb(-70, -65), WRECK_TICK)).toMatchObject({ stored: true });

    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(1);
    expect(catapultQuestHave()).toBe(1);
  });

  test("the next load lands it from its last checkpoint: army spent, damage, loot, session ended", async () => {
    startSession(ATTACKER, now(), ARMY);
    userSave.monsters = { housed: { ...ARMY } };
    expect(await checkpoint(WRECK, WRECK_TICK)).toMatchObject({ stored: true });
    const battle = serverBattle(WRECK, WRECK_TICK);

    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(1);
    const { r1, r2, r3, r4 } = battle.attackloot;
    // Wild tribes give 25% more Goo (patch 6.9).
    const r4WithBonus = withTribeGooBonus({ r4 }, true).r4;
    expect(userSave.resources).toEqual({ r1: 100 + r1, r2: 100 + r2, r3: 100 + r3, r4: 100 + r4WithBonus });
    expect((userSave.monsters as { housed: unknown }).housed).toEqual({ C1: 4 });
    expect(maproom.tribedata[0]).toMatchObject({ destroyed: 1, damage: Math.trunc(battle.damage) });
    expect(store.has(mr1TribeSessionKey(ATTACKER, TRIBE))).toBe(false);
    expect(store.has(rowlessCheckpointKey(REF))).toBe(false);
    expect(sets.get(ROWLESS_CHECKPOINT_INDEX)?.size ?? 0).toBe(0);

    // Once: the next load finds nothing, and a late save is refused.
    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(0);
    expect((await run(finalSave()))?.data?.reason).toBe("no-session");
    expect((userSave.resources as Record<string, number>).r1).toBe(100 + r1);
  });

  test("never more than the record shows: the battle stops at the checkpoint's tick", async () => {
    startSession(ATTACKER, now(), ARMY);
    userSave.monsters = { housed: { ...ARMY } };
    await checkpoint(SCRATCH, SCRATCH_TICK);
    const battle = serverBattle(SCRATCH, SCRATCH_TICK);
    expect(battle.damage).toBeLessThan(90);

    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(1);
    expect((userSave.monsters as { housed: unknown }).housed).toEqual({ C1: 60 });
    expect(maproom.tribedata[0]!.destroyed).not.toBe(1);
    expect(maproom.tribedata[0]).toMatchObject({ damage: Math.trunc(battle.damage) });
  });

  test("a checkpoint that arrives after the save lands nothing more", async () => {
    startSession(ATTACKER, now(), ARMY);
    userSave.monsters = { housed: { ...ARMY } };
    await checkpoint(SCRATCH, SCRATCH_TICK);
    expect(await run(finalSave())).toBeNull();
    const snapshot = () =>
      structuredClone({ resources: userSave.resources, monsters: userSave.monsters, tribe: maproom.tribedata[0] });
    const after = snapshot();

    expect(await checkpoint(WRECK, WRECK_TICK)).toMatchObject({ data: { reason: "no-session" } });
    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(0);
    expect(snapshot()).toEqual(after);
    expect(store.has(rowlessCheckpointKey(REF))).toBe(false);
  });

  test("a crash between ending the session and dropping the checkpoint never lands it twice", async () => {
    startSession(ATTACKER, now(), ARMY);
    userSave.monsters = { housed: { ...ARMY } };
    await checkpoint(WRECK, WRECK_TICK);
    const { r1 } = serverBattle(WRECK, WRECK_TICK).attackloot;

    // The landing writes the database and ends the session, then the server
    // dies before the checkpoint goes.
    crashOn = (key) => key === rowlessCheckpointKey(REF);
    await finaliseRowlessAttacksOf(ATTACKER, "load");
    crashOn = null;
    expect(store.has(mr1TribeSessionKey(ATTACKER, TRIBE))).toBe(false);
    expect(store.has(rowlessCheckpointKey(REF))).toBe(true);
    const snapshot = () =>
      structuredClone({ resources: userSave.resources, monsters: userSave.monsters, tribe: maproom.tribedata[0] });
    const landed = snapshot();
    expect((landed.resources as Record<string, number>).r1).toBe(100 + r1);
    persisted.length = 0;

    // After the restart the load, and the sweep, find the checkpoint left
    // behind: it is dropped, nothing lands again.
    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(0);
    expect(await finaliseExpiredRowlessAttacks()).toBe(0);
    expect(snapshot()).toEqual(landed);
    expect(persisted).toHaveLength(0);
    expect(store.has(rowlessCheckpointKey(REF))).toBe(false);
    expect(sets.get(ROWLESS_CHECKPOINT_INDEX)?.size ?? 0).toBe(0);
  });

  test("a crash after the final save's write: neither a resent save nor the finaliser lands it again", async () => {
    startSession(ATTACKER, now(), ARMY);
    userSave.monsters = { housed: { ...ARMY } };
    await checkpoint(SCRATCH, SCRATCH_TICK);

    // The final save lands, then the server dies before the session ends,
    // leaving both the session and the checkpoint.
    crashOn = (key) => key === mr1TribeSessionKey(ATTACKER, TRIBE);
    expect(await run(finalSave())).not.toBeNull();
    crashOn = null;
    expect(store.has(mr1TribeSessionKey(ATTACKER, TRIBE))).toBe(true);
    expect(store.has(rowlessCheckpointKey(REF))).toBe(true);
    const snapshot = () =>
      structuredClone({ resources: userSave.resources, monsters: userSave.monsters, tribe: maproom.tribedata[0] });
    const landed = snapshot();
    expect(landed.resources).not.toEqual({ r1: 100, r2: 100, r3: 100, r4: 100 });
    persisted.length = 0;

    // The client sends the save again: refused, and what was left is cleared.
    expect((await run(finalSave()))?.data?.reason).toBe("landed");
    expect(store.has(mr1TribeSessionKey(ATTACKER, TRIBE))).toBe(false);
    expect(store.has(rowlessCheckpointKey(REF))).toBe(false);
    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(0);
    expect(snapshot()).toEqual(landed);
    expect(persisted).toHaveLength(0);
  });

  test("a database write that fails lands nothing, and the attack can still land", async () => {
    startSession(ATTACKER, now(), ARMY);
    userSave.monsters = { housed: { ...ARMY } };
    await checkpoint(WRECK, WRECK_TICK);
    const { r1 } = serverBattle(WRECK, WRECK_TICK).attackloot;

    // Nothing was written: the next try reads the rows as they were.
    const before = structuredClone({ userSave, maproom });
    flushFails = true;
    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(0);
    flushFails = false;
    ({ userSave, maproom } = structuredClone(before));
    expect(store.has(rowlessCheckpointKey(REF))).toBe(true);

    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(1);
    expect((userSave.resources as Record<string, number>).r1).toBe(100 + r1);
    expect(store.has(rowlessCheckpointKey(REF))).toBe(false);
  });

  test("not while the save holds the attack: the checkpoint waits for the next load", async () => {
    startSession(ATTACKER, now(), ARMY);
    await checkpoint(SCRATCH, SCRATCH_TICK);
    store.set(mr1TribeFinalLockKey(ATTACKER, TRIBE), "1");
    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(0);
    expect(store.has(rowlessCheckpointKey(REF))).toBe(true);
    store.delete(mr1TribeFinalLockKey(ATTACKER, TRIBE));
    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(1);
  });

  test("a replay that keeps failing lands with no battle after a few tries: the flung monsters still spent", async () => {
    startSession(ATTACKER, now(), ARMY);
    userSave.monsters = { housed: { ...ARMY } };
    await checkpoint(SCRATCH, SCRATCH_TICK);
    replayTimesOut = true;
    for (let attempt = 0; attempt < ROWLESS_CLOSE_ATTEMPTS; attempt++) {
      expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(0);
    }
    expect((userSave.monsters as { housed: unknown }).housed).toEqual(ARMY);
    expect(store.has(rowlessCheckpointKey(REF))).toBe(true);

    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(1);
    expect((userSave.monsters as { housed: unknown }).housed).toEqual({ C1: 60 });
    expect(userSave.resources).toEqual({ r1: 100, r2: 100, r3: 100, r4: 100 });
    expect(maproom.tribedata[0]!.destroyed).not.toBe(1);
    expect(store.has(rowlessCheckpointKey(REF))).toBe(false);
  });

  test("the minute sweep lands it only once its window has closed", async () => {
    startSession(ATTACKER, now(), ARMY);
    await checkpoint(SCRATCH, SCRATCH_TICK);
    expect(await finaliseExpiredRowlessAttacks()).toBe(0);
    try {
      setSystemTime(new Date(Date.now() + (attackWindowSeconds() + 1) * 1000));
      expect(await finaliseExpiredRowlessAttacks()).toBe(1);
    } finally {
      setSystemTime();
    }
    expect(store.has(rowlessCheckpointKey(REF))).toBe(false);
  });

  test("an attack still open is landed by the attacker's own next load, not another player's", async () => {
    startSession(ATTACKER, now(), ARMY);
    await checkpoint(SCRATCH, SCRATCH_TICK);
    expect(await finaliseRowlessAttacksOf(OTHER, "load")).toBe(0);
    expect(store.has(rowlessCheckpointKey(REF))).toBe(true);
  });
});
