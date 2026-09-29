import { beforeEach, describe, expect, mock, test } from "bun:test";
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

mock.module("../../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { baseSave } = await import("../../../controllers/base/save/baseSave.js");
const { mr1TribeSessionKey } = await import("./mr1TribeSession.js");
const { serialiseAttackSession } = await import("../../base/attackSession.js");
const { mr1TribePool } = await import("./mr1TribeRules.js");
const { MR1_TRIBES_MAP } = await import("../../../game-data/tribes/v1/index.js");
const { LOOT_GAIN_RATIO } = await import("../../../game-rules/combat/index.js");

const now = () => Math.floor(Date.now() / 1000);

const startSession = (attackerid = ATTACKER, startedat = now()) =>
  store.set(
    mr1TribeSessionKey(ATTACKER, TRIBE),
    serialiseAttackSession({ attackerid, attackid: ATTACK_ID, startedat, entryHoused: { "5000": { C1: 10 } } })
  );

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

beforeEach(() => {
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
  test("the save that ends it credits the loot once and ends the session", async () => {
    startSession();
    const ctx = ctxFor({ over: "1", attackid: String(ATTACK_ID), attackloot: loot({ r1: 50, r2: 7 }), destroyed: "1", damage: "97.5" });

    expect(await run(ctx)).toBeNull();
    expect(userSave.resources).toEqual({ r1: 150, r2: 107, r3: 100, r4: 100 });
    expect(maproom.tribedata[0]).toMatchObject({ destroyed: 1, damage: 97, looted: { r1: 50, r2: 7, r3: 0, r4: 0 } });
    expect(store.has(mr1TribeSessionKey(ATTACKER, TRIBE))).toBe(false);

    // The same save sent again as the page closes lands nothing.
    const again = await run(ctxFor({ over: "1", attackid: String(ATTACK_ID), attackloot: loot({ r1: 50 }) }));
    expect(again?.data?.reason).toBe("no-session");
    expect((userSave.resources as Record<string, number>).r1).toBe(150);
  });

  test("loot beyond what the tribe holds is cut to its pool", async () => {
    startSession();
    // Storage enough for the whole pool, so only the tribe's cap applies.
    userSave.outposts = [[0, 0, "1"]];
    await run(ctxFor({ over: "1", attackloot: loot({ r1: 1e12 }) }));

    const cap = Math.floor(mr1TribePool(MR1_TRIBES_MAP.get(TRIBE)!).r1 * LOOT_GAIN_RATIO);
    expect((userSave.resources as Record<string, number>).r1).toBe(100 + cap);
  });

  test("the attacker keeps only what fits in their storage; the tribe still loses it all (#166)", async () => {
    startSession();
    // No silos: a cap of 10,000, 9,900 of it free.
    userSave.resources = { r1: 100, r2: 9_950, r3: 10_000, r4: 12_000 };
    const ctx = ctxFor({ over: "1", attackloot: loot({ r1: 20_000, r2: 20_000, r3: 20_000, r4: 20_000 }) });

    expect(await run(ctx)).toBeNull();
    expect(userSave.resources).toEqual({ r1: 10_000, r2: 10_000, r3: 10_000, r4: 12_000 });
    expect((ctx.body as { lootcredited?: unknown }).lootcredited).toEqual({ r1: 9_900, r2: 50, r3: 0, r4: 0 });

    const pool = mr1TribePool(MR1_TRIBES_MAP.get(TRIBE)!);
    const cap = (key: "r1" | "r2" | "r3" | "r4") => Math.min(20_000, Math.floor(pool[key] * LOOT_GAIN_RATIO));
    expect(maproom.tribedata[0]!.looted).toEqual({ r1: cap("r1"), r2: cap("r2"), r3: cap("r3"), r4: cap("r4") });
  });

  test("a save that does not end the attack records the tribe's damage and credits nothing", async () => {
    startSession();
    expect(await run(ctxFor({ attackloot: loot({ r1: 50 }), damage: "40" }))).toBeNull();
    expect((userSave.resources as Record<string, number>).r1).toBe(100);
    expect(maproom.tribedata[0]!.damage).toBe(40);
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
    startSession();
    const ctx = ctxFor({
      basesaveid: "0",
      attackid: String(ATTACK_ID),
      over: "1",
      buildingdata: JSON.stringify({ "1": { id: 1, t: 14, l: 1, X: 0, Y: 0 } }),
      buildinghealthdata: JSON.stringify({ "1": 0 }),
      damage: "92.5",
      destroyed: "1",
      monsterupdate: JSON.stringify([{ baseid: "5000", m: { housed: { C1: 6 }, space: 40 } }]),
      attackloot: loot({ r1: 20, r2: 0, r3: 0, r4: 0 }),
      resources: loot({ r1: -20, r2: 0, r3: 0, r4: 0 }),
      attackreport: "0:01 Flung 4 Pokey\nResult: 92% damage",
      flinglog: JSON.stringify({
        v: 1,
        seed: 7,
        events: [{ kind: "fling", t: 40, x: -200, y: -200, monsters: { C1: 4 } }],
      }),
    });

    expect(await run(ctx)).toBeNull();
    expect(userSave.resources).toEqual({ r1: 120, r2: 100, r3: 100, r4: 100 });
    expect((userSave.monsters as { housed: unknown }).housed).toEqual({ C1: 6 });
    expect(maproom.tribedata[0]).toMatchObject({ destroyed: 1, damage: 92 });
    expect(store.has(mr1TribeSessionKey(ATTACKER, TRIBE))).toBe(false);
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
