import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

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
let maproom: { userid: number; tribedata: Record<string, unknown>[] };
let userSave: Record<string, unknown>;
const persisted: unknown[] = [];

mock.module("../../../server.js", () => ({
  postgres: {
    em: {
      populate: async (user: Record<string, unknown>) => {
        user.save = userSave;
      },
      findOne: async () => maproom,
      persist: (entity: unknown) => persisted.push(entity),
      flush: async () => {},
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
    del: async (key: string) => (store.delete(key) ? 1 : 0),
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

const { baseSave } = await import("../../../controllers/base/save/baseSave.js");
const { combatConfig } = await import("../../../config/CombatConfig.js");
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
  replayTimesOut = false;
  setMode("log");
  reports.length = 0;
  warn.mockClear();
  store.clear();
  persisted.length = 0;
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

  test("an attack started more than 420 seconds ago no longer authorises it", async () => {
    startSession(ATTACKER, now() - 421);
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
    expect(userSave.resources).toEqual({ r1: 100 + r1, r2: 100 + r2, r3: 100 + r3, r4: 100 + r4 });
    expect(maproom.tribedata[0]).toMatchObject({
      destroyed: 1,
      damage: Math.trunc(battle.damage),
      looted: battle.attackloot,
      tribeHealthData: battle.buildinghealthdata,
    });
    expect(store.has(mr1TribeSessionKey(ATTACKER, TRIBE))).toBe(false);

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
    expect(userSave.resources).toEqual({ r1: 100 + r1, r2: 100 + r2, r3: 100 + r3, r4: 100 + r4 });
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
    expect(userSave.champion).toEqual([champion(500)]);
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

    expect(userSave.champion).toEqual([champion(120)]);
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
