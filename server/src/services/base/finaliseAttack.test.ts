import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Finishing an attack its attacker left without a save (issue #138).
 *
 * The service runs for real — the replay, the handlers, the checkpoint store —
 * against an in-memory Redis and stand-in rows, so what is asserted is exactly
 * what would be written: the flung monsters gone from the attacker's cells, the
 * bomb charged once, the loot credited, the defender's damage and report, the
 * row freed, and nothing at all the second time.
 */

const SANDBOX = fileURLToPath(new URL("../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url));
const sandbox = JSON.parse(readFileSync(SANDBOX, "utf8"));

const ATTACKER = 2503;
const DEFENDER_OWNER = 1;
const BASESAVEID = 77;
const ATTACK_ID = 4242;
const HOME = "1000239208";
const OUTPOST = "1000240208";

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

let defender: Record<string, any>;
let userSave: Record<string, any>;
let outpost: Record<string, any>;
const flush = mock(async () => {});
const upsert = mock(async (_entity: unknown, _row: Record<string, any>) => {});

const reset = () => {
  store.clear();
  sets.clear();
  flush.mockClear();
  upsert.mockClear();
  defender = {
    basesaveid: BASESAVEID,
    baseid: "2000241208",
    saveuserid: DEFENDER_OWNER,
    type: "tribe",
    wmid: 0,
    attackid: ATTACK_ID,
    attacks: [],
    protected: 0,
    savetime: Math.floor(Date.now() / 1000) - 60,
    damage: 0,
    buildingdata: structuredClone(sandbox.buildingdata),
    buildinghealthdata: {},
    resources: { r1: 5_000_000, r2: 5_000_000, r3: 5_000_000, r4: 5_000_000 },
  };
  userSave = {
    basesaveid: 5,
    userid: ATTACKER,
    baseid: HOME,
    catapult: 2,
    buildingdata: {},
    resources: { r1: 1_000_000, r2: 1_000_000, r3: 1_000_000, r4: 1_000_000 },
    monsters: { housed: { C1: 200 }, space: 400 },
    academy: { C1: { level: 3 } },
    champion: [{ t: 5, l: 5, hp: 62000, status: 0 }],
    siege: null,
  };
  outpost = { baseid: OUTPOST, saveuserid: ATTACKER, protected: 123, monsters: { housed: { C1: 150 } } };
};
reset();

const attacker = () => ({ userid: ATTACKER, username: "yardtester", alliance_id: null, save: userSave });

mock.module("../../server.js", () => ({
  redis: fakeRedis,
  postgres: {
    orm: { em: {} },
    em: {
      findOne: async (entity: { name: string }, where: Record<string, unknown>) => {
        if (entity.name === "User") return where.userid === ATTACKER ? attacker() : null;
        return where.basesaveid === BASESAVEID || where.baseid === defender.baseid ? defender : null;
      },
      find: async (_entity: unknown, where: { baseid: { $in: string[] } }) =>
        where.baseid.$in.includes(OUTPOST) ? [outpost] : [],
      persist: () => {},
      upsert,
      flush,
      // The attacker's main row, locked for an achievement event (#204).
      transactional: async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          findOne: async (_entity: unknown, where: Record<string, unknown>) =>
            where.basesaveid === userSave.basesaveid ? userSave : null,
          flush: async () => {},
        }),
    },
  },
}));

const core = await import("@mikro-orm/core");
mock.module("@mikro-orm/core", () => ({
  ...core,
  RequestContext: { ...core.RequestContext, create: (_em: unknown, next: () => unknown) => next() },
}));

mock.module("../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

mock.module("../alliance/powerups.js", () => ({
  runningPowerups: async () => [],
  isDeclareWarRunning: async () => false,
}));

const { finaliseAbandonedAttack, finaliseAttacksFor, finaliseExpiredOnBase, landCheckpointedAttack } = await import(
  "./finaliseAttack.js"
);
const { storeCheckpoint, acquireFinalLock } = await import("./attackCheckpointStore.js");
const { attackCheckpointKey } = await import("./attackCheckpoint.js");
const { attackSessionKey } = await import("./attackSession.js");
const { replayAbandonedAttack } = await import("./combat/abandonedAttack.js");
const { attackLootOf } = await import("./combat/attackLoot.js");
const { foughtLoot } = await import("./combat/battle.js");
const { housingLossOf, housingLossLine } = await import("./combat/housingLoss.js");

const LOG = {
  v: 1 as const,
  seed: 1834027731,
  events: [
    { kind: "fling" as const, t: 480, x: -615, y: 115, r: 300, monsters: { C1: 300 }, champion: { t: 5, l: 5 } },
    { kind: "bomb" as const, t: 800, x: 180, y: -480, id: "pb1" },
  ],
};
const TICK = 2400;
/** Late enough in the battle for plenty to be looted. */
const LATE = 20_000;
const now = () => Math.floor(Date.now() / 1000);

/** Every test here runs the combat engine, which is slow under a loaded machine. */
const REPLAY_TIMEOUT_MS = 60_000;

/** The attacker's level the attack load served: past the low-level bonus. */
const LEVEL = 40;
/** The pool the attack load served, and the roster it recorded (#163). */
const SERVED = { r1: 5_000_000, r2: 5_000_000, r3: 5_000_000, r4: 5_000_000 };
const ENTRY_HOUSED = { [HOME]: { C1: 200 }, [OUTPOST]: { C1: 150 } };

/** What the attack load recorded, as the checkpoint keeps a copy of it. */
const facts = (overrides: Record<string, unknown> = {}) => ({
  entryHoused: ENTRY_HOUSED,
  defenderResources: SERVED,
  attackerlevel: LEVEL,
  ...overrides,
});

const checkpoint = (overrides: Record<string, unknown> = {}) => ({
  attackerid: ATTACKER,
  defenderid: DEFENDER_OWNER,
  attackid: ATTACK_ID,
  startedat: now() - 30,
  at: now() - 5,
  tick: TICK,
  flinglog: LOG,
  sources: [HOME, OUTPOST],
  ...facts(),
  ...overrides,
});

const arm = async (overrides: Record<string, unknown> = {}) => {
  const stored = checkpoint(overrides);
  await storeCheckpoint(BASESAVEID, stored as never);
  store.set(
    attackSessionKey(BASESAVEID),
    JSON.stringify({
      attackerid: ATTACKER,
      attackid: ATTACK_ID,
      startedat: stored.startedat,
      entryHoused: stored.entryHoused,
      defenderResources: stored.defenderResources,
      attackerlevel: stored.attackerlevel,
    })
  );
};

/** The battle as the client fought it: over the served pool, at the served level. */
type Log = Parameters<typeof replayAbandonedAttack>[0]["log"];

const replayed = (tick: number, log: Log = LOG, resources: Record<string, number> = SERVED) =>
  replayAbandonedAttack({
    defender: { type: "tribe", buildingdata: sandbox.buildingdata, buildinghealthdata: {}, resources },
    attacker: { academy: userSave.academy, champion: userSave.champion, siege: null },
    log,
    tick,
    declareWar: false,
    playerLevel: LEVEL,
  });

beforeEach(reset);

describe("finaliseAbandonedAttack", () => {
  test("writes the attack as its save would have: monsters spent, bomb charged, damage kept", async () => {
    await arm();
    const expected = replayed(TICK);

    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");

    // The attacker: 300 Pokeys out of 200 at home and 150 at the outpost.
    // Each cell is caught up first (nothing to hatch here), then spent.
    expect(userSave.monsters).toMatchObject({ housed: { C1: 0 } });
    expect(outpost.monsters).toMatchObject({ housed: { C1: 50 } });
    expect(outpost.protected).toBe(0);
    // The pebble bomb's 100,000 charged. With no silo the attacker's cap is
    // 13,000 (Krallen's raise included), so a million already holds more than
    // it may take: whatever Krallen loots first (issue #222) is not credited.
    expect(userSave.resources.r1).toBe(1_000_000);
    expect(userSave.resources.r2).toBe(1_000_000 + expected.attackloot.r2 - 100_000);
    expect(userSave.champion[0].hp).toBe(expected.attackerchampion![0]!.hp);

    // The defender.
    expect(defender.attackid).toBe(0);
    // Stored whole and cut down, as the attack's own save stores it (#72).
    expect(defender.damage).toBe(Math.trunc(expected.damage));
    expect(defender.damage).toBeGreaterThan(0);
    expect(defender.destroyed).toBe(expected.destroyed!);
    expect(defender.buildinghealthdata).toEqual(expected.buildinghealthdata);
    expect(defender.resources.r1).toBe(5_000_000 + expected.defenderDelta.r1);
    expect(defender.attackreport).toContain("Left the attack");
    expect(flush).toHaveBeenCalledTimes(1);

    // Nothing left to finish from, and the row is free.
    expect(store.has(attackCheckpointKey(BASESAVEID))).toBe(false);
    expect(store.has(attackSessionKey(BASESAVEID))).toBe(false);
  }, REPLAY_TIMEOUT_MS);

  test("monsters hatched during the attack stay: the flung are taken from the caught-up yard", async () => {
    await arm();
    // Home hatches Pokeys (8 s each at academy level 3) from a queue, with
    // room for 16 more beside the 200 (4 × 540 housing).
    userSave.buildingdata = {
      "1": { id: 1, t: 15, l: 6 },
      "2": { id: 2, t: 15, l: 6 },
      "3": { id: 3, t: 15, l: 6 },
      "4": { id: 4, t: 15, l: 6 },
      "9": { id: 9, t: 13, l: 3 },
    };
    userSave.savetime = now() - 80;
    userSave.monsters = {
      saved: now() - 80,
      housed: { C1: 200 },
      h: [["", 0, [["C1", 20, 3]]]],
      hid: [9],
      hstage: [0],
      hcc: [],
    };

    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");

    // 300 flung: home gives everything it houses now (200 + what hatched), the
    // outpost the rest, so the outpost keeps 50 plus what hatched at home.
    const hatched = 20 - (userSave.monsters.h[0][2][0]?.[1] ?? 0) - (userSave.monsters.h[0][0] ? 1 : 0);
    expect(hatched).toBeGreaterThanOrEqual(9);
    expect(userSave.monsters.housed).toEqual({ C1: 0 });
    expect(outpost.monsters.housed).toEqual({ C1: 50 + hatched });
  }, REPLAY_TIMEOUT_MS);

  test("the attacker keeps only what fits in their storage, Krallen's raise included (#166)", async () => {
    const tick = LATE;
    await arm({ tick });
    // No silos: a cap of 10,000, raised to 13,000 by the level 5 Krallen the log flings.
    userSave.resources = { r1: 0, r2: 1_000_000, r3: 12_000, r4: 13_000 };
    const expected = replayed(tick);
    expect(expected.attackloot.r1).toBeGreaterThan(13_000);

    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");

    // r2 is charged the pebble bomb and stays over the cap, so takes nothing.
    expect(userSave.resources).toEqual({ r1: 13_000, r2: 900_000, r3: 13_000, r4: 13_000 });
    // The defender still loses the whole loot.
    expect(defender.resources.r1).toBe(5_000_000 + expected.defenderDelta.r1);
    expect(-expected.defenderDelta.r1).toBeGreaterThanOrEqual(expected.attackloot.r1);
  }, REPLAY_TIMEOUT_MS);

  test("credits what the attack's own final save would have, at the same moment (#163, #165)", async () => {
    await arm({ tick: LATE });
    // An honest client that saved at this tick reports its engine's figures,
    // which are this replay's; the save's loot rule lands them.
    const client = replayed(LATE);
    const save = attackLootOf({
      sent: client.attackloot,
      reported: client.defenderDelta,
      flinglog: LOG,
      session: { attackerid: ATTACKER, attackid: ATTACK_ID, startedat: now() - 30, ...facts() },
      defender: { type: "tribe", buildingdata: sandbox.buildingdata, buildinghealthdata: {}, resources: defender.resources },
      attacker: structuredClone(userSave),
      mapRoom3: false,
      // The save's own battle, to the same tick: the client's engine's figures.
      fought: foughtLoot(client),
    });
    userSave.resources = { r1: 0, r2: 0, r3: 0, r4: 0 };
    userSave.buildingdata = { "1": { id: 1, t: 6, l: 10 }, "2": { id: 2, t: 6, l: 10 } };
    expect(save.credit.r1).toBeGreaterThan(0);

    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");

    // The r2 bomb's 100,000 comes off an empty pool first.
    expect(userSave.resources).toEqual({ r1: save.credit.r1, r2: save.credit.r2, r3: save.credit.r3, r4: save.credit.r4 });
    expect(defender.resources).toEqual({
      r1: 5_000_000 + save.defenderDelta.r1,
      r2: 5_000_000 + save.defenderDelta.r2,
      r3: 5_000_000 + save.defenderDelta.r3,
      r4: 5_000_000 + save.defenderDelta.r4,
    });
  }, REPLAY_TIMEOUT_MS);

  test("the pool moving while the attack ran changes nothing it credits (#163)", async () => {
    const creditWith = async (stored: Record<string, number>) => {
      reset();
      userSave.resources = { r1: 0, r2: 0, r3: 0, r4: 0 };
      userSave.buildingdata = { "1": { id: 1, t: 6, l: 10 }, "2": { id: 2, t: 6, l: 10 } };
      defender.resources = { ...stored };
      await arm({ tick: LATE });
      expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");
      return { credited: userSave.resources, left: defender.resources };
    };

    const asServed = await creditWith(SERVED);
    // Autobanked income, or another attack's loss, since the attack load served its pool.
    const grown = await creditWith({ r1: 9_000_000, r2: 9_000_000, r3: 9_000_000, r4: 9_000_000 });
    const drained = await creditWith({ r1: 1_000, r2: 1_000, r3: 1_000, r4: 1_000 });

    expect(asServed.credited.r1).toBeGreaterThan(0);
    expect(grown.credited).toEqual(asServed.credited);
    expect(drained.credited).toEqual(asServed.credited);
    // The loss lands on the pool as it stands, and never below nothing.
    expect(drained.left).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  }, REPLAY_TIMEOUT_MS);

  test("never credits more than the served pool allows, whatever the pool holds now (#163)", async () => {
    const served = { r1: 2_000, r2: 2_000, r3: 2_000, r4: 2_000 };
    await arm({ tick: LATE, defenderResources: served });
    userSave.resources = { r1: 0, r2: 0, r3: 0, r4: 0 };
    userSave.buildingdata = { "1": { id: 1, t: 6, l: 10 }, "2": { id: 2, t: 6, l: 10 } };
    // The stored pool is far larger than the one the attack was served, and
    // would have given far more.
    const fromStored = replayed(LATE, LOG, defender.resources).attackloot.r1;
    const fromServed = replayed(LATE, LOG, served).attackloot.r1;
    expect(fromStored).toBeGreaterThan(fromServed);

    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");

    expect(userSave.resources.r1).toBe(fromServed);
  }, REPLAY_TIMEOUT_MS);

  test("monsters the attacker never housed at entry fight for nothing (#163)", async () => {
    // The roster held 20 Pokeys, however many the checkpointed log flings.
    const housed = { [HOME]: { C1: 20 } };
    await arm({ tick: LATE, entryHoused: housed });
    userSave.resources = { r1: 0, r2: 0, r3: 0, r4: 0 };
    userSave.buildingdata = { "1": { id: 1, t: 6, l: 10 }, "2": { id: 2, t: 6, l: 10 } };
    const fightable: Log = {
      ...LOG,
      events: [
        { kind: "fling", t: 480, x: -615, y: 115, r: 300, monsters: { C1: 20 }, champion: { t: 5, l: 5 } },
        LOG.events[1]!,
      ],
    };
    const total = (log?: Log) => {
      const loot = replayed(LATE, log).attackloot;
      return loot.r1 + loot.r2 + loot.r3 + loot.r4;
    };
    expect(total()).toBeGreaterThan(total(fightable));

    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");

    expect(userSave.resources.r1).toBe(replayed(LATE, fightable).attackloot.r1);
  }, REPLAY_TIMEOUT_MS);

  test("its record of the attack load outlives the session (#163)", async () => {
    await arm({ tick: LATE });
    // The session is gone a minute after the attack's window; the sweep or
    // the attacker's next load finishes the attack later than that.
    store.delete(attackSessionKey(BASESAVEID));
    userSave.resources = { r1: 0, r2: 0, r3: 0, r4: 0 };
    userSave.buildingdata = { "1": { id: 1, t: 6, l: 10 }, "2": { id: 2, t: 6, l: 10 } };

    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");

    expect(userSave.resources.r1).toBe(replayed(LATE).attackloot.r1);
    expect(userSave.resources.r1).toBeGreaterThan(0);
  }, REPLAY_TIMEOUT_MS);

  test("a checkpoint with no record of the attack load credits nothing, as the save would not", async () => {
    await arm({ tick: LATE, entryHoused: undefined, defenderResources: undefined, attackerlevel: undefined });
    store.delete(attackSessionKey(BASESAVEID));
    userSave.resources = { r1: 0, r2: 1_000_000, r3: 0, r4: 0 };

    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");

    expect(userSave.resources).toEqual({ r1: 0, r2: 900_000, r3: 0, r4: 0 });
    expect(defender.resources).toEqual(SERVED);
    expect(defender.damage).toBeGreaterThan(0);
  }, REPLAY_TIMEOUT_MS);

  describe("a fallen bunker's garrison (issue #130)", () => {
    // Three hundred Pokeys dropped among the sandbox's four Monster Bunkers, where
    // enough get past the Railguns' beams (issue #261) to bring both stocked ones down.
    const RAID = {
      v: 1 as const,
      seed: 1834027731,
      events: [{ kind: "fling" as const, t: 480, x: 450, y: -350, r: 300, monsters: { C1: 300 } }],
    };

    const stock = () => {
      defender.buildingdata["83"].m = { C1: 5 };
      defender.buildingdata["84"].m = { C3: 2 };
    };

    test("goes with a bunker the server's replay brought down", async () => {
      stock();
      await arm({ tick: LATE, flinglog: RAID });

      expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");

      expect(defender.buildinghealthdata["83"]).toBe(0);
      expect(defender.buildingdata["83"].m).toBeUndefined();
      expect(defender.buildingdata["84"].m).toBeUndefined();
      expect(defender.buildingdata["83"]).toMatchObject({ id: 83, t: 22 });
    }, REPLAY_TIMEOUT_MS);

    test("stays with a bunker still standing when the attacker left", async () => {
      stock();
      await arm({ tick: 500, flinglog: RAID });

      expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");

      expect(defender.buildinghealthdata["83"] ?? 1).toBeGreaterThan(0);
      expect(defender.buildingdata["83"].m).toEqual({ C1: 5 });
      expect(defender.buildingdata["84"].m).toEqual({ C3: 2 });
    }, REPLAY_TIMEOUT_MS);
  });

  describe("a fallen Housing's monsters (issue #160)", () => {
    // Three hundred Pokeys dropped among the sandbox's four level 6 Housings, where
    // enough get past the Railguns' beams (issue #261) to bring Housings down.
    const RAID = {
      v: 1 as const,
      seed: 1834027731,
      events: [{ kind: "fling" as const, t: 480, x: 650, y: 50, r: 300, monsters: { C1: 300 } }],
    };
    const HOUSINGS = ["82", "584", "585", "586"];

    const asMainYard = () => {
      Object.assign(defender, { type: "main", mapversion: 2, attacks: [] });
      defender.monsters = { housed: { C1: 40, C3: 8, C5: 1 }, space: 2160 };
    };

    test("go with it when the server finishes the attack, and the report says so", async () => {
      asMainYard();
      await arm({ tick: LATE, flinglog: RAID });

      expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");

      const fallen = HOUSINGS.filter((id) => defender.buildinghealthdata[id] === 0).length;
      expect(fallen).toBeGreaterThan(0);
      const expected = housingLossOf({
        buildingdata: sandbox.buildingdata,
        before: {},
        after: defender.buildinghealthdata,
        housed: { C1: 40, C3: 8, C5: 1 },
        levels: {},
        expansion: false,
      })!;
      expect(expected.fallen).toBe(fallen);
      expect(defender.monsters).toEqual({ housed: expected.housed, space: 2160 });
      expect(defender.attackreport).toContain(housingLossLine(expected)!);
    }, REPLAY_TIMEOUT_MS);

    test("stay when every Housing still stands as the attacker left", async () => {
      asMainYard();
      await arm({ tick: 500, flinglog: RAID });

      expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");

      expect(HOUSINGS.every((id) => (defender.buildinghealthdata[id] ?? 1) > 0)).toBe(true);
      expect(defender.monsters.housed).toEqual({ C1: 40, C3: 8, C5: 1 });
      expect(defender.attackreport).not.toContain("Housing");
    }, REPLAY_TIMEOUT_MS);
  });

  test("is idempotent: a second finalisation finds nothing and charges nothing", async () => {
    await arm();
    await finaliseAbandonedAttack(BASESAVEID, "test");
    const after = structuredClone(userSave);

    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("none");
    expect(userSave).toEqual(after);
    expect(flush).toHaveBeenCalledTimes(1);
  }, REPLAY_TIMEOUT_MS);

  test("waits out a save that holds the lock", async () => {
    await arm();
    await acquireFinalLock(BASESAVEID);

    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("busy");
    expect(defender.attackid).toBe(ATTACK_ID);
    expect(userSave.monsters.housed.C1).toBe(200);
  }, REPLAY_TIMEOUT_MS);

  test("a row that moved on is left alone and the checkpoint dropped", async () => {
    await arm();
    defender.attackid = 999;

    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("stale");
    expect(userSave.monsters.housed.C1).toBe(200);
    expect(store.has(attackCheckpointKey(BASESAVEID))).toBe(false);
  }, REPLAY_TIMEOUT_MS);
});

describe("the plan an abandoned camp attack leaves (issue #221)", () => {
  const asKozuCamp = () => Object.assign(defender, { wmid: 11, level: 35 });

  test("an attack played by hand on a Map Room 2 camp becomes the plan, to the tick it was left at", async () => {
    asKozuCamp();
    await arm();

    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");

    expect(upsert).toHaveBeenCalledTimes(1);
    const row = upsert.mock.calls[0]![1];
    expect(row).toMatchObject({ userid: ATTACKER, wmid: 11, level: 35, slot: "last", baseid: defender.baseid });
    expect(row.plan).toEqual({ v: 1, tick: TICK, events: LOG.events });
  }, REPLAY_TIMEOUT_MS);

  test("an auto-attack's landing never does, and its report does not say the attacker left", async () => {
    asKozuCamp();
    await arm();

    const landed = await landCheckpointedAttack(BASESAVEID, "auto-attack", { left: false, recordPlan: false });

    expect(landed.status).toBe("finalised");
    expect(landed.landed?.damageAfter).toBe(defender.damage);
    expect(landed.landed?.fought.events).toEqual(LOG.events);
    expect(defender.attackreport).not.toContain("Left the attack");
    expect(upsert).not.toHaveBeenCalled();
  }, REPLAY_TIMEOUT_MS);

  test("an attack on anything but a camp leaves no plan", async () => {
    await arm();
    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");
    expect(upsert).not.toHaveBeenCalled();
  }, REPLAY_TIMEOUT_MS);
});

describe("the Kozu Town Hall an abandoned attack brings down (issue #204)", () => {
  /** A Kozu camp of nothing but its Town Hall, which 300 Pokeys flatten. */
  const asKozuHall = () =>
    Object.assign(defender, {
      wmid: 11,
      level: 35,
      buildingdata: { "0": structuredClone(sandbox.buildingdata["0"]) },
      achievements: null,
    });
  const kozuCrusher = () => (userSave.achievements as { c?: Record<string, unknown> } | undefined)?.c?.["10"];

  test("counts towards the attacker's Kozu Crusher", async () => {
    asKozuHall();
    userSave.achievements = { v: 1, s: {}, c: {}, backfilledAt: 1 };
    await arm({ tick: LATE });

    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");

    expect(defender.buildinghealthdata["0"]).toBe(0);
    expect(kozuCrusher()).toMatchObject({ shiny: 10 });
  }, REPLAY_TIMEOUT_MS);

  test("an auto-attack's landing counts too", async () => {
    asKozuHall();
    userSave.achievements = { v: 1, s: {}, c: {}, backfilledAt: 1 };
    await arm({ tick: LATE });

    const landed = await landCheckpointedAttack(BASESAVEID, "auto-attack", { left: false, recordPlan: false });

    expect(landed.status).toBe("finalised");
    expect(kozuCrusher()).toMatchObject({ shiny: 10 });
  }, REPLAY_TIMEOUT_MS);

  test("another tribe's camp counts nothing", async () => {
    asKozuHall();
    defender.wmid = 21;
    userSave.achievements = { v: 1, s: {}, c: {}, backfilledAt: 1 };
    await arm({ tick: LATE });

    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");

    expect(kozuCrusher()).toBeUndefined();
  }, REPLAY_TIMEOUT_MS);
});

describe("when finalisation runs", () => {
  test("the attacker's own load finishes their attack, window or not", async () => {
    await arm();
    expect(await finaliseAttacksFor(ATTACKER, "build")).toBe(1);
    expect(defender.attackid).toBe(0);
  }, REPLAY_TIMEOUT_MS);

  test("the defender's load waits for the attacker's window to close", async () => {
    await arm();
    expect(await finaliseAttacksFor(DEFENDER_OWNER, "build")).toBe(0);
    expect(defender.attackid).toBe(ATTACK_ID);

    store.clear();
    sets.clear();
    await arm({ startedat: now() - 420 });
    expect(await finaliseAttacksFor(DEFENDER_OWNER, "build")).toBe(1);
  }, REPLAY_TIMEOUT_MS);

  test("a stranger's load touches nothing", async () => {
    await arm({ startedat: now() - 420 });
    expect(await finaliseAttacksFor(31337, "build")).toBe(0);
  }, REPLAY_TIMEOUT_MS);

  test("a new attack on the row finishes the expired one first", async () => {
    await arm();
    await finaliseExpiredOnBase(defender.baseid);
    expect(defender.attackid).toBe(ATTACK_ID);

    await arm({ startedat: now() - 420 });
    await finaliseExpiredOnBase(defender.baseid);
    expect(defender.attackid).toBe(0);
  }, REPLAY_TIMEOUT_MS);
});


describe("the champion's learning brain (issue #219)", () => {
  // A Gorgo with twenty Pokeys: Krallen's loot-first stage leaves a brain little to choose.
  const FROZEN = { "1": { tower: 0, loot: 120, finish: 0, focus: 60, threat: 0 } };
  const FORGED = { tower: 200, loot: -200, finish: 200, focus: -200, threat: -200 };
  const gorgoLog = (b?: Record<string, number>): Log => ({
    v: 1,
    seed: LOG.seed,
    events: [
      {
        kind: "fling",
        t: 480,
        x: -615,
        y: 115,
        r: 300,
        monsters: { C1: 20 },
        champion: { t: 1, l: 5, ...(b && { b }) },
      },
    ],
  });
  const gorgo = (extra: Record<string, unknown> = {}) => ({ t: 1, l: 5, hp: 150_000, status: 0, ...extra });

  test("the champion that fought learns from the server's battle, once", async () => {
    const { learnFromLesson } = await import("../../game-rules/combat/index.js");
    userSave.champion = [gorgo({ b: FROZEN["1"], bs: { n: 4, hyb: 0.2 } })];
    await arm({ tick: LATE, championBrains: FROZEN, flinglog: gorgoLog() });
    const expected = replayed(LATE, gorgoLog(FROZEN["1"]));
    const lesson = expected.lessons!.find((one) => one.t === 1)!;
    expect(lesson.picks).toBeGreaterThan(0);
    const learned = learnFromLesson(FROZEN["1"], { n: 4, hyb: 0.2 }, lesson, "hybrid");

    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");
    expect(userSave.champion[0]).toMatchObject({ t: 1, l: 5, b: learned.brain, bs: learned.stats });
    expect(userSave.champion[0].bs.n).toBe(5);
    expect(userSave.champion[0].b).not.toEqual(FROZEN["1"]);

    // A second landing finds nothing, so nothing is learned twice.
    const after = structuredClone(userSave.champion);
    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("none");
    expect(userSave.champion).toEqual(after);
  }, REPLAY_TIMEOUT_MS);

  test("the battle is fought with the brain frozen at launch, never the log's or the live one", async () => {
    // The live brain moved on since launch, and the log claims another.
    userSave.champion = [gorgo({ b: { tower: -200, loot: -200, finish: 0, focus: 0, threat: 0 } })];
    await arm({ tick: LATE, championBrains: FROZEN, flinglog: gorgoLog(FORGED) });
    const frozen = replayed(LATE, gorgoLog(FROZEN["1"]));
    const forged = replayed(LATE, gorgoLog(FORGED));
    // The test means something only if the brains fight differently.
    expect(forged.buildinghealthdata).not.toEqual(frozen.buildinghealthdata);

    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");
    expect(defender.buildinghealthdata).toEqual(frozen.buildinghealthdata);
  }, REPLAY_TIMEOUT_MS);

  test("an attack launched before brains existed replays with none and still counts", async () => {
    userSave.champion = [gorgo()];
    await arm({ tick: LATE, flinglog: gorgoLog(FORGED) });
    const plain = replayed(LATE, gorgoLog());

    expect(await finaliseAbandonedAttack(BASESAVEID, "test")).toBe("finalised");
    expect(defender.buildinghealthdata).toEqual(plain.buildinghealthdata);
    // Its first attack in a Mode only sets the baseline.
    expect(userSave.champion[0].b).toEqual({ tower: 0, loot: 0, finish: 0, focus: 0, threat: 0 });
    expect(userSave.champion[0].bs).toMatchObject({ n: 1 });
  }, REPLAY_TIMEOUT_MS);
});
