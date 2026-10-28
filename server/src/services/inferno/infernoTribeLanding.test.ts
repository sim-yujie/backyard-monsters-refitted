import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

import type { AbandonedInput, AbandonedOutcome } from "../base/combat/abandonedAttack.js";

/**
 * The Moloch tribe landing (WP 2.8, `docs/design/inferno.md` §2.7): the
 * `/base/save` that ends a tribe attack lands the server's own battle, once,
 * for the attack `POST /bm/inferno/attack/start` minted. The Under Hall's fall
 * wins and wrecks the tribe for an hour; the monsters that fought leave the
 * Inferno yard's Housing Bunkers; the loot, capped by what the tribe holds,
 * goes into the Inferno purse up to its caps. What the client says is only
 * compared, and a save with no attack behind it lands nothing.
 */

const ATTACKER = 3401;
const MAIN_BASEID = "5000";
const INFERNO_BASEID = "6000";
const ATTACK_ID = 6161;
const ARMY = { IC1: 30, IC2: 5 };
const FORCES = { bunkers: {}, defenderLevels: {}, defenderChampions: [] };

const store = new Map<string, string>();
let userSave: Record<string, unknown>;
let inferno: Record<string, unknown>;
let maproom: Record<string, unknown> | null;
let flushes = 0;
let transactions = 0;

const em = {
  populate: async (user: Record<string, unknown>) => {
    user.save = userSave;
  },
  findOne: async (entity: { name: string }, where: Record<string, unknown>) => {
    if (entity.name === "InfernoMaproom") return maproom;
    if (where.basesaveid !== undefined) return where.basesaveid === userSave.basesaveid ? userSave : null;
    return String(where.baseid) === INFERNO_BASEID ? inferno : null;
  },
  create: (entity: new () => object, data: object) => Object.assign(new entity(), data),
  persist: (entity: unknown) => {
    if ((entity as { constructor?: { name?: string } })?.constructor?.name === "InfernoMaproom") {
      maproom = entity as Record<string, unknown>;
    }
  },
  flush: async () => {
    flushes += 1;
  },
  transactional: async (run: (tx: unknown) => Promise<unknown>) => {
    transactions += 1;
    return run(em);
  },
};

mock.module("../../server.js", () => ({
  postgres: { em },
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
mock.module("../../utils/logger.js", () => ({
  logger: { warn, error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

mock.module("../base/reportManager.js", () => ({
  logReport: async () => {},
  logAttackViolation: async () => {},
  logBanReport: async () => {},
}));

// The real replay runner, unless a test hands the battle in (`canned`) or
// asks for one that times out. Bun keeps module mocks across files, so it is
// left delegating to the real runner.
const REAL_RUNNER = "../base/combat/replayRunner.ts?real";
const realRunner = (await import(REAL_RUNNER)) as typeof import("../base/combat/replayRunner.js");
let canned: Partial<AbandonedOutcome> | null = null;
let replayTimesOut = false;
const inputs: AbandonedInput[] = [];
mock.module("../base/combat/replayRunner.js", () => ({
  ...realRunner,
  replayAbandonedInWorker: async (...args: Parameters<typeof realRunner.replayAbandonedInWorker>) => {
    inputs.push(args[0]);
    if (replayTimesOut) throw new realRunner.ReplayTimeoutError(5_000);
    if (canned) return outcome(canned);
    return realRunner.replayAbandonedInWorker(...args);
  },
}));

const { baseSave } = await import("../../controllers/base/save/baseSave.js");
const { combatConfig } = await import("../../config/CombatConfig.js");
const MODE = combatConfig.mode;
const { serialiseAttackSession } = await import("../base/attackSession.js");
const { infernoTribeFinalLockKey, infernoTribeSessionKey } = await import("./infernoTribeSession.js");
const { infernoTribeYardOf } = await import("./infernoTribes.js");
const { infernoStartBuildingData } = await import("./infernoYard.js");
const { infernoStorageCap } = await import("./infernoLoad.js");
const { mr1TribePool } = await import("../maproom/v1/mr1TribeRules.js");
const { LOOT_GAIN_RATIO, bucketCost } = await import("../../game-rules/combat/index.js");
const { BaseType } = await import("../../enums/Base.js");

/** A whole battle outcome, with `part` over a quiet default. */
const outcome = (part: Partial<AbandonedOutcome>): AbandonedOutcome => ({
  tick: 2_400,
  buildinghealthdata: {},
  damage: 0,
  destroyed: 0,
  firedTraps: [],
  attackloot: { r1: 0, r2: 0, r3: 0, r4: 0 },
  defenderDelta: { r1: 0, r2: 0, r3: 0, r4: 0 },
  flung: { IC1: 6 },
  attackerchampion: undefined,
  championsFlung: [],
  attackersiege: undefined,
  attackreport: "",
  bunkerLosses: {},
  bunkerGarrisons: {},
  defenderChampions: [],
  ...part,
});

const now = () => Math.floor(Date.now() / 1000);

/** The tribe attack the start mints, on `baseid`. */
const startSession = (baseid = "214", capacity = 780) =>
  store.set(
    infernoTribeSessionKey(ATTACKER),
    JSON.stringify({
      baseid,
      flingerCapacity: capacity,
      session: serialiseAttackSession({
        attackerid: ATTACKER,
        attackid: ATTACK_ID,
        startedat: now(),
        entryHoused: { [INFERNO_BASEID]: { ...ARMY } },
        defenderForces: FORCES as never,
        attackerAcademy: {},
      }),
    })
  );

/** Six Spurtz flung at the edge of the yard. */
const SCRATCH = { v: 1, seed: 7, events: [{ kind: "fling", t: 40, x: 300, y: 150, r: 100, monsters: { IC1: 6 } }] };

const ctxFor = (body: Record<string, string>) =>
  ({
    authUser: { userid: ATTACKER, username: "raider" },
    request: { body: { baseid: "214", basesaveid: "0", ...body } },
    ip: "127.0.0.1",
    path: "/base/save",
  }) as unknown as Context & { body: { tribe?: Record<string, any> } };

/** The save that ends the attack, on `baseid`. */
const finalSave = (baseid = "214", extra: Record<string, string> = {}) =>
  ctxFor({
    baseid,
    over: "1",
    attackid: String(ATTACK_ID),
    tick: "2400",
    flinglog: JSON.stringify(SCRATCH),
    ...extra,
  });

const run = async (ctx: Context): Promise<{ data?: { reason?: string } } | null> => {
  try {
    await baseSave(ctx, async () => {});
    return null;
  } catch (caught) {
    return caught as { data?: { reason?: string } };
  }
};

/** The stored state of `baseid`. */
const tribeState = (baseid = "214") =>
  (maproom?.tribedata as Record<string, any>[] | undefined)?.find((tribe) => tribe.baseid === baseid);

const hallOf = (baseid: string): string => {
  const rows = infernoTribeYardOf(baseid)!.buildingdata as Record<string, { t: number; id: number }>;
  return String(Object.values(rows).find((row) => row.t === 14)!.id);
};

const savedSwitch = process.env.INFERNO_ENABLED;

beforeEach(() => {
  process.env.INFERNO_ENABLED = "on";
  (combatConfig as { mode: typeof MODE }).mode = "log";
  canned = null;
  replayTimesOut = false;
  inputs.length = 0;
  store.clear();
  flushes = 0;
  transactions = 0;
  warn.mockClear();
  userSave = {
    userid: ATTACKER,
    baseid: MAIN_BASEID,
    basesaveid: 9,
    baseid_inferno: INFERNO_BASEID,
    worldid: "w1",
    resources: { r1: 100, r2: 100, r3: 100, r4: 100 },
    iresources: { r1: 9_000, r2: 0, r3: 0, r4: 0, r1max: 10_000, r2max: 10_000, r3max: 10_000, r4max: 10_000 },
    savetime: now(),
    buildingdata: {},
    storedata: {},
    academy: {},
    champion: [],
    monsters: { housed: { C1: 10 } },
  };
  inferno = {
    baseid: INFERNO_BASEID,
    basesaveid: 60,
    type: BaseType.INFERNO,
    userid: ATTACKER,
    saveuserid: ATTACKER,
    attackid: 0,
    buildingdata: { ...infernoStartBuildingData(), "50": { t: 128, id: 50, l: 4, X: 200, Y: 200 } },
    buildinghealthdata: {},
    academy: {},
    monsters: { housed: { ...ARMY } },
    storedata: {},
    resources: {},
  };
  maproom = { userid: ATTACKER, tribedata: [] };
});

afterEach(() => {
  if (savedSwitch === undefined) delete process.env.INFERNO_ENABLED;
  else process.env.INFERNO_ENABLED = savedSwitch;
  (combatConfig as { mode: typeof MODE }).mode = MODE;
});

describe("binding", () => {
  test("a save with no attack behind it is refused, and nothing is written", async () => {
    const err = await run(finalSave());
    expect(err?.data?.reason).toBeDefined();
    expect(transactions).toBe(0);
    expect(flushes).toBe(0);
  });

  test("a save for another tribe than the session's is refused", async () => {
    startSession("215");
    expect((await run(finalSave("214")))?.data?.reason).toBeDefined();
    expect(transactions).toBe(0);
    expect(store.has(infernoTribeSessionKey(ATTACKER))).toBe(true);
  });

  test("a save without over writes nothing and keeps the session", async () => {
    startSession();
    const ctx = ctxFor({ attackid: String(ATTACK_ID), flinglog: JSON.stringify(SCRATCH) });
    expect(await run(ctx)).toBeNull();
    expect(ctx.body.tribe).toBeUndefined();
    expect(transactions).toBe(0);
    expect(inputs.length).toBe(0);
    expect(store.has(infernoTribeSessionKey(ATTACKER))).toBe(true);
  });
});

describe("landing", () => {
  test("the Under Hall falls: won, the tribe wrecked for an hour, the army and the loot settled", async () => {
    startSession();
    const hall = hallOf("214");
    canned = {
      buildinghealthdata: { [hall]: 0 },
      damage: 64.7,
      flung: { IC1: 6 },
      attackloot: { r1: 5_000, r2: 300, r3: 0, r4: 0 },
    };
    // The purse's caps follow the Inferno yard's silos (`syncInfernoCap`): 1,000 short of full.
    const cap = infernoStorageCap(inferno as never);
    (userSave.iresources as Record<string, number>).r1 = cap - 1_000;
    const ctx = finalSave("214", { attackloot: JSON.stringify({ r1: 1e9 }) });
    const at = now();
    expect(await run(ctx)).toBeNull();

    const tribe = ctx.body.tribe!;
    expect(tribe.won).toBe(true);
    expect(tribe.damage).toBe(64);
    expect(tribe.loot).toEqual({ r1: 5_000, r2: 300, r3: 0, r4: 0 });
    // The purse takes what fits under its caps; the tribe gives up all of it.
    expect(tribe.lootcredited).toEqual({ r1: 1_000, r2: 300, r3: 0, r4: 0 });
    expect(tribe.total).toEqual({ r1: cap, r2: 300, r3: 0, r4: 0 });
    expect(tribe.respawnat).toBeGreaterThanOrEqual(at + 3_600);

    expect((userSave.iresources as Record<string, number>).r1).toBe(cap);
    // Only the Inferno yard's monsters left; the main yard's stay.
    expect((inferno.monsters as { housed: Record<string, number> }).housed).toEqual({ IC1: 24, IC2: 5 });
    expect((userSave.monsters as { housed: Record<string, number> }).housed).toEqual({ C1: 10 });

    const state = tribeState();
    expect(state).toMatchObject({ destroyed: 1, damage: 64, looted: { r1: 5_000, r2: 300, r3: 0, r4: 0 } });
    expect(state!.tribeHealthData).toEqual({ [hall]: 0 });
    expect(state!.destroyedAt).toBeGreaterThanOrEqual(at);

    expect(transactions).toBe(1);
    expect(store.has(infernoTribeSessionKey(ATTACKER))).toBe(false);
    expect(store.has(infernoTribeFinalLockKey(ATTACKER))).toBe(false);
  });

  test("no Under Hall down, no win however high the damage: the tribe keeps its health", async () => {
    startSession();
    canned = { buildinghealthdata: { "1": 0, "2": 0 }, damage: 95, flung: { IC2: 2 } };
    const ctx = finalSave("214", { damage: "100", destroyed: "1" });
    expect(await run(ctx)).toBeNull();

    expect(ctx.body.tribe).toMatchObject({ won: false, damage: 95, respawnat: 0 });
    expect(tribeState()).toMatchObject({ damage: 95, tribeHealthData: { "1": 0, "2": 0 } });
    expect(tribeState()!.destroyed).toBeUndefined();
    expect((inferno.monsters as { housed: Record<string, number> }).housed).toEqual({ IC1: 30, IC2: 3 });
  });

  test("more flung than the yard held at the start takes only what it held", async () => {
    startSession();
    canned = { flung: { IC1: 500, IC3: 9 } };
    expect(await run(finalSave())).toBeNull();
    expect((inferno.monsters as { housed: Record<string, number> }).housed).toEqual({ IC1: 0, IC2: 5 });
  });

  test("the loot is capped by what the tribe holds, less what it gave this life", async () => {
    startSession();
    const pool = mr1TribePool(infernoTribeYardOf("214")!);
    maproom = { userid: ATTACKER, tribedata: [{ baseid: "214", tribeHealthData: {}, looted: { r1: 1_000 } }] };
    (userSave.iresources as Record<string, number>).r1 = 0;
    canned = { attackloot: { r1: 1e9, r2: 0, r3: 0, r4: 0 } };
    const ctx = finalSave();
    expect(await run(ctx)).toBeNull();
    const left = Math.floor(pool.r1 * LOOT_GAIN_RATIO) - 1_000;
    expect(ctx.body.tribe!.loot.r1).toBe(left);
    expect(tribeState()!.looted.r1).toBe(left + 1_000);
  });

  test("a replay past its deadline lands nothing and keeps the session for a resent save", async () => {
    startSession();
    replayTimesOut = true;
    const err = await run(finalSave());
    expect(err?.data?.reason).toBeDefined();
    expect(transactions).toBe(0);
    expect(store.has(infernoTribeSessionKey(ATTACKER))).toBe(true);
    expect((inferno.monsters as { housed: Record<string, number> }).housed).toEqual(ARMY);
  });

  test("the real replay fights the tribe as an Inferno yard, each fling cut to the session's load", async () => {
    startSession("214", 200);
    const greedy = { v: 1, seed: 7, events: [{ kind: "fling", t: 40, x: 300, y: 150, r: 100, monsters: { IC1: 30, IC2: 5 } }] };
    const ctx = finalSave("214", { flinglog: JSON.stringify(greedy) });
    expect(await run(ctx)).toBeNull();
    const input = inputs[0]!;
    expect(input.defender.kind).toBe("inferno");
    expect(input.defender.type).toBe("iwm");
    expect(input.attacker.champion).toEqual([]);
    const fling = input.log.events.find((event) => event.kind === "fling") as { monsters: Record<string, number> };
    expect(bucketCost({ IC1: 30, IC2: 5 }, {})).toBeGreaterThan(200);
    expect(bucketCost(fling.monsters, {})).toBeLessThanOrEqual(200);
    expect(ctx.body.tribe).toBeDefined();
  });

  test("no siege weapon on a Moloch tribe (owner: siege is for the overworld): the Decoy is cut and none is spent", async () => {
    const stock = { decoy: { level: 1, quantity: 2 } };
    userSave.siege = structuredClone(stock);
    startSession();
    const log = { ...SCRATCH, events: [...SCRATCH.events, { kind: "siege", t: 60, x: 300, y: 150, weapon: "decoy" }] };
    expect(await run(finalSave("214", { flinglog: JSON.stringify(log) }))).toBeNull();
    const input = inputs[0]!;
    expect(input.log.events.map((event) => event.kind)).toEqual(["fling"]);
    expect(input.attacker.siege).toBeNull();
    expect(userSave.siege).toEqual(stock);
  });
});
