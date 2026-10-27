import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

import type { AbandonedInput, AbandonedOutcome } from "../base/combat/abandonedAttack.js";

/**
 * The landing of an attack on another player's Inferno yard (WP 3.3,
 * `docs/design/inferno.md` §2.7): the `/base/save` that ends it lands the
 * server's own battle, once, for the attack `POST /bm/inferno/attack/start`
 * minted on that yard. The loot moves from the defender's Inferno purse to
 * the attacker's, up to its caps; the monsters that fought leave the
 * attacker's Housing Bunkers; a fallen Housing Bunker takes its housed
 * monsters with it; the defender gets damage protection; both revenge lists
 * count the attack.
 */

const ATTACKER = 3501;
const DEFENDER = 4501;
const INFERNO_BASEID = "6000";
const TARGET_BASEID = "7000";
const TARGET_SAVEID = 70;
const ATTACK_ID = 7171;
const ARMY = { IC1: 10 };
const FORCES = { bunkers: { 50: { IC1: 3 }, 51: { IC1: 3 } }, defenderLevels: {}, defenderChampions: [] };

const store = new Map<string, string>();
let userSave: Record<string, any>;
let inferno: Record<string, any>;
let target: Record<string, any>;
let defenderMain: Record<string, any>;
let maprooms: Map<number, Record<string, any>>;
let transactions = 0;

const em = {
  populate: async (user: Record<string, unknown>) => {
    user.save = userSave;
  },
  findOne: async (entity: { name: string }, where: Record<string, any>) => {
    if (entity.name === "InfernoMaproom") return maprooms.get(where.userid) ?? null;
    if (entity.name === "User") return { userid: where.userid, username: "defender", pic_square: "" };
    if (where.basesaveid === userSave.basesaveid) return userSave;
    if (where.basesaveid === TARGET_SAVEID) return target;
    if (where.type === "main") return where.userid === DEFENDER ? defenderMain : null;
    return String(where.baseid) === INFERNO_BASEID ? inferno : null;
  },
  create: (entity: new () => object, data: object) => Object.assign(new entity(), data),
  persist: (entity: Record<string, any>) => {
    if (entity?.constructor?.name === "InfernoMaproom") maprooms.set(entity.userid, entity);
  },
  flush: async () => {},
  count: async () => 0,
  nativeUpdate: async () => 1,
  find: async () => [],
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

const REAL_RUNNER = "../base/combat/replayRunner.ts?real";
const realRunner = (await import(REAL_RUNNER)) as typeof import("../base/combat/replayRunner.js");
let canned: Partial<AbandonedOutcome> | null = null;
const inputs: AbandonedInput[] = [];
mock.module("../base/combat/replayRunner.js", () => ({
  ...realRunner,
  replayAbandonedInWorker: async (...args: Parameters<typeof realRunner.replayAbandonedInWorker>) => {
    inputs.push(args[0]);
    if (canned) return outcome(canned);
    return realRunner.replayAbandonedInWorker(...args);
  },
}));

const { baseSave } = await import("../../controllers/base/save/baseSave.js");
const { combatConfig } = await import("../../config/CombatConfig.js");
const MODE = combatConfig.mode;
const { serialiseAttackSession } = await import("../base/attackSession.js");
const { infernoPlayerFinalLockKey, infernoPlayerSessionKey } = await import("./infernoPlayerSession.js");
const { infernoStartBuildingData } = await import("./infernoYard.js");
const { infernoStorageCap } = await import("./infernoLoad.js");
const { BaseType } = await import("../../enums/Base.js");

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

/** The attack the start mints on the defender's yard, with their purse frozen. */
const startSession = (purse = { r1: 5_000, r2: 400, r3: 0, r4: 0 }) => {
  target.attackid = ATTACK_ID;
  target.attacks = [{ name: "raider", starttime: now() }];
  store.set(
    infernoPlayerSessionKey(TARGET_SAVEID),
    JSON.stringify({
      baseid: TARGET_BASEID,
      flingerCapacity: 780,
      session: serialiseAttackSession({
        attackerid: ATTACKER,
        attackid: ATTACK_ID,
        startedat: now(),
        entryHoused: { [INFERNO_BASEID]: { ...ARMY } },
        defenderForces: FORCES as never,
        defenderResources: purse,
        attackerAcademy: {},
      }),
    })
  );
};

const SCRATCH = { v: 1, seed: 7, events: [{ kind: "fling", t: 40, x: 300, y: 150, r: 100, monsters: { IC1: 6 } }] };

const ctxFor = (body: Record<string, string>, userid = ATTACKER) =>
  ({
    authUser: { userid, username: "raider", pic_square: "" },
    request: { body: { baseid: TARGET_BASEID, basesaveid: String(TARGET_SAVEID), ...body } },
    ip: "127.0.0.1",
    path: "/base/save",
  }) as unknown as Context & { body: { player?: Record<string, any> } };

const finalSave = (extra: Record<string, string> = {}) =>
  ctxFor({ over: "1", attackid: String(ATTACK_ID), tick: "2400", flinglog: JSON.stringify(SCRATCH), ...extra });

const run = async (ctx: Context): Promise<{ data?: { reason?: string } } | null> => {
  try {
    await baseSave(ctx, async () => {});
    return null;
  } catch (caught) {
    return caught as { data?: { reason?: string } };
  }
};

const savedSwitch = process.env.INFERNO_ENABLED;

beforeEach(() => {
  process.env.INFERNO_ENABLED = "on";
  (combatConfig as { mode: typeof MODE }).mode = "log";
  canned = null;
  inputs.length = 0;
  store.clear();
  transactions = 0;
  userSave = {
    userid: ATTACKER,
    baseid: "5000",
    basesaveid: 9,
    baseid_inferno: INFERNO_BASEID,
    resources: {},
    iresources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    buildingdata: {},
    storedata: {},
    academy: {},
    champion: [],
  };
  inferno = {
    baseid: INFERNO_BASEID,
    basesaveid: 60,
    type: BaseType.INFERNO,
    userid: ATTACKER,
    saveuserid: ATTACKER,
    attackid: 0,
    attacks: [],
    points: "0",
    basevalue: "0",
    buildingdata: { ...infernoStartBuildingData(), "50": { t: 128, id: 50, l: 4, X: 200, Y: 200 } },
    buildinghealthdata: {},
    academy: {},
    monsters: { housed: { ...ARMY } },
    storedata: {},
    resources: {},
  };
  target = {
    baseid: TARGET_BASEID,
    basesaveid: TARGET_SAVEID,
    type: BaseType.INFERNO,
    userid: DEFENDER,
    saveuserid: DEFENDER,
    attackid: 0,
    attacks: [],
    protected: 0,
    damage: 0,
    points: "0",
    basevalue: "0",
    buildingdata: {
      ...infernoStartBuildingData(),
      "50": { t: 128, id: 50, l: 1, X: 200, Y: 200 },
      "51": { t: 128, id: 51, l: 1, X: 300, Y: 200 },
    },
    buildinghealthdata: {},
    academy: {},
    monsters: { housed: { IC1: 6 } },
    storedata: {},
    resources: {},
  };
  defenderMain = { userid: DEFENDER, type: "main", iresources: { r1: 5_000, r2: 400, r3: 0, r4: 0 } };
  maprooms = new Map();
});

afterEach(() => {
  if (savedSwitch === undefined) delete process.env.INFERNO_ENABLED;
  else process.env.INFERNO_ENABLED = savedSwitch;
  (combatConfig as { mode: typeof MODE }).mode = MODE;
});

describe("binding", () => {
  test("a save with no attack behind it is refused, and nothing is written", async () => {
    target.attackid = ATTACK_ID;
    const err = await run(finalSave());
    expect(err?.data?.reason).toBeDefined();
    expect(transactions).toBe(0);
  });

  test("a save from someone else than the attacker is refused", async () => {
    startSession();
    const err = await run(ctxFor({ over: "1", attackid: String(ATTACK_ID), flinglog: JSON.stringify(SCRATCH) }, 9999));
    expect(err?.data?.reason).toBeDefined();
    expect(transactions).toBe(0);
    expect(store.has(infernoPlayerSessionKey(TARGET_SAVEID))).toBe(true);
  });

  test("a save with another attack id is refused", async () => {
    startSession();
    expect((await run(finalSave({ attackid: "1" })))?.data?.reason).toBeDefined();
    expect(transactions).toBe(0);
  });

  test("a save without over writes nothing and keeps the session", async () => {
    startSession();
    const ctx = ctxFor({ attackid: String(ATTACK_ID), flinglog: JSON.stringify(SCRATCH) });
    expect(await run(ctx)).toBeNull();
    expect(ctx.body.player).toBeUndefined();
    expect(transactions).toBe(0);
    expect(store.has(infernoPlayerSessionKey(TARGET_SAVEID))).toBe(true);
  });
});

describe("landing", () => {
  test("the loot moves purse to purse, up to the attacker's caps; the army and the mark settle", async () => {
    startSession();
    const cap = infernoStorageCap(inferno as never);
    userSave.iresources.r1 = cap - 1_000;
    canned = {
      damage: 30.4,
      flung: { IC1: 6 },
      attackloot: { r1: 2_000, r2: 100, r3: 0, r4: 0 },
      defenderDelta: { r1: -2_000, r2: -100, r3: 0, r4: 0 },
      buildinghealthdata: { "50": 400 },
      bunkerGarrisons: { 50: { IC1: 3 }, 51: { IC1: 3 } },
    };
    const ctx = finalSave({ attackloot: JSON.stringify({ r1: 2_000, r2: 100 }), resources: JSON.stringify({ r1: -2_000, r2: -100 }) });
    expect(await run(ctx)).toBeNull();

    const player = ctx.body.player!;
    expect(player.damage).toBe(30);
    expect(player.loot).toEqual({ r1: 2_000, r2: 100, r3: 0, r4: 0 });
    expect(player.lootcredited).toEqual({ r1: 1_000, r2: 100, r3: 0, r4: 0 });
    expect(player.total).toEqual({ r1: cap, r2: 100, r3: 0, r4: 0 });
    expect(player.housedlost).toEqual({});
    // The defender's purse lost the whole loot, whatever fitted the attacker's.
    expect(defenderMain.iresources).toMatchObject({ r1: 3_000, r2: 300 });
    // The monsters that fought left the attacker's Housing Bunkers.
    expect(inferno.monsters.housed).toEqual({ IC1: 4 });
    expect(target).toMatchObject({ attackid: 0, damage: 30, buildinghealthdata: { "50": 400 } });
    expect(target.monsters.housed).toEqual({ IC1: 6 });
    // No garrison is written onto a Housing Bunker.
    expect(target.buildingdata["50"].m).toBeUndefined();
    expect(transactions).toBe(1);
    expect(store.has(infernoPlayerSessionKey(TARGET_SAVEID))).toBe(false);
    expect(store.has(infernoPlayerFinalLockKey(TARGET_SAVEID))).toBe(false);
  });

  test("a fallen Housing Bunker loses all it housed; the standing one keeps what the battle left it", async () => {
    startSession();
    canned = {
      damage: 20,
      buildinghealthdata: { "50": 0 },
      bunkerGarrisons: { 50: { IC1: 1 }, 51: { IC1: 2 } },
    };
    const ctx = finalSave();
    expect(await run(ctx)).toBeNull();
    expect(target.monsters.housed).toEqual({ IC1: 2 });
    expect(ctx.body.player!.housedlost).toEqual({ IC1: 4 });
  });

  test("the purse gives up no more than it holds", async () => {
    startSession({ r1: 5_000, r2: 0, r3: 0, r4: 0 });
    defenderMain.iresources.r1 = 500; // spent since the attack began
    canned = { attackloot: { r1: 2_000, r2: 0, r3: 0, r4: 0 }, defenderDelta: { r1: -2_000, r2: 0, r3: 0, r4: 0 } };
    const ctx = finalSave({ attackloot: JSON.stringify({ r1: 2_000 }) });
    expect(await run(ctx)).toBeNull();
    expect(defenderMain.iresources.r1).toBe(0);
    expect(ctx.body.player!.loot.r1).toBe(500);
  });

  test("50% damage gives the defender 36 hours' protection", async () => {
    startSession();
    canned = { damage: 55 };
    const at = now();
    expect(await run(finalSave())).toBeNull();
    expect(target.protected).toBeGreaterThanOrEqual(at + 36 * 3_600);
  });

  test("less damage, a first attack: no protection", async () => {
    startSession();
    canned = { damage: 10 };
    expect(await run(finalSave())).toBeNull();
    expect(target.protected).toBe(0);
  });

  test("both revenge lists count the attack; an out-of-range one is paid back", async () => {
    startSession();
    maprooms.set(ATTACKER, { userid: ATTACKER, neighbors: [{ userid: DEFENDER, attacksfrom: 2, attacksto: 0, retaliatecount: 0 }] });
    canned = { damage: 10 };
    expect(await run(finalSave())).toBeNull();
    const mine = maprooms.get(ATTACKER)!.neighbors.find((one: { userid: number }) => one.userid === DEFENDER);
    // In range: the attack counts, no revenge is paid back.
    expect([mine.attacksto, mine.retaliatecount]).toEqual([1, 0]);
    const theirs = maprooms.get(DEFENDER)!.neighbors;
    expect(theirs.map((one: { userid: number; attacksfrom: number }) => [one.userid, one.attacksfrom])).toEqual([[ATTACKER, 1]]);
  });

  test("the real replay fights the yard as an Inferno yard with the served defence and the frozen purse", async () => {
    startSession();
    const ctx = finalSave();
    expect(await run(ctx)).toBeNull();
    const input = inputs[0]!;
    expect(input.defender.kind).toBe("inferno");
    expect(input.defender.resources).toEqual({ r1: 5_000, r2: 400, r3: 0, r4: 0 });
    expect(input.defence?.bunkers).toEqual(FORCES.bunkers);
    expect(ctx.body.player).toBeDefined();
  });
});
