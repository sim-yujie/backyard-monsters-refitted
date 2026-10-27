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
const nativeUpdates: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
/** The defender's notices (WP 3.4), as the mail rows were made. */
const notices: Record<string, any>[] = [];

const em = {
  populate: async (user: Record<string, unknown>) => {
    user.save = userSave;
  },
  findOne: async (entity: { name: string }, where: Record<string, any>) => {
    if (entity.name === "InfernoMaproom") return maprooms.get(where.userid) ?? null;
    if (entity.name === "User") {
      return where.userid === ATTACKER
        ? { userid: ATTACKER, username: "raider", pic_square: "", alliance_id: null, save: userSave }
        : { userid: where.userid, username: "defender", pic_square: "" };
    }
    if (where.basesaveid === userSave.basesaveid) return userSave;
    if (where.basesaveid === TARGET_SAVEID) return target;
    if (where.type === "main") return where.userid === DEFENDER ? defenderMain : null;
    if (String(where.baseid) === TARGET_BASEID) return target;
    return String(where.baseid) === INFERNO_BASEID ? inferno : null;
  },
  create: (entity: new () => object, data: object) => {
    if (entity.name === "Message") notices.push(data);
    return Object.assign(new entity(), data);
  },
  // The notice is written in a context of its own.
  fork: () => em,
  persist: (entity: Record<string, any>) => {
    if (entity?.constructor?.name === "InfernoMaproom") maprooms.set(entity.userid, entity);
  },
  flush: async () => {},
  count: async () => 0,
  nativeUpdate: async (_entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
    nativeUpdates.push({ where, data });
    return 1;
  },
  find: async () => [],
  transactional: async (run: (tx: unknown) => Promise<unknown>) => {
    transactions += 1;
    return run(em);
  },
  // `isBot`, on a second attack's start.
  getContext: () => ({ global: true, findOne: em.findOne }),
};

/** The stand-in ORM's entity manager: only it skips the request context. */
const fakeOrmEm = {};

mock.module("../../server.js", () => ({
  postgres: { em, orm: { em: fakeOrmEm } },
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
    sadd: async (key: string, member: string) => {
      const set = new Set(JSON.parse(store.get(key) ?? "[]") as string[]).add(member);
      store.set(key, JSON.stringify([...set]));
      return 1;
    },
    srem: async (key: string, member: string) => {
      const set = new Set(JSON.parse(store.get(key) ?? "[]") as string[]);
      set.delete(member);
      store.set(key, JSON.stringify([...set]));
      return 1;
    },
    smembers: async (key: string) => JSON.parse(store.get(key) ?? "[]") as string[],
  },
}));

const core = await import("@mikro-orm/core");
const RealRequestContext = core.RequestContext;
const realCreate = core.RequestContext.create.bind(core.RequestContext);
mock.module("@mikro-orm/core", () => ({
  ...core,
  // As in `finaliseAttack.test.ts`: only the stand-in's entity manager skips the context.
  RequestContext: Object.assign(Object.create(RealRequestContext), {
    create: (orm: unknown, next: () => unknown) => (orm === fakeOrmEm ? next() : realCreate(orm as never, next as never)),
  }),
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
const { attackCheckpoint } = await import("../../controllers/base/attackCheckpoint.js");
const { infernoAttackStart } = await import("../../controllers/inferno/descentAttack.js");
const { infernoPlayerCheckpointKey, INFERNO_PLAYER_ATTACKS } = await import("./infernoPlayerSession.js");
const { attackCheckpointKey } = await import("../base/attackCheckpoint.js");
const { closeExpiredInfernoPlayerAttacks, closeInfernoPlayerAttack, closeInfernoPlayerAttacksOf } = await import(
  "./infernoPlayerFinalise.js"
);

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
const startSession = (purse = { r1: 5_000, r2: 400, r3: 0, r4: 0 }, startedat = now()) => {
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
        startedat,
        entryHoused: { [INFERNO_BASEID]: { ...ARMY } },
        defenderForces: FORCES as never,
        defenderResources: purse,
        attackerAcademy: {},
      }),
    })
  );
  store.set(INFERNO_PLAYER_ATTACKS, JSON.stringify([String(TARGET_SAVEID)]));
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
  nativeUpdates.length = 0;
  notices.length = 0;
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
  defenderMain = { userid: DEFENDER, type: "main", baseid_inferno: TARGET_BASEID, iresources: { r1: 5_000, r2: 400, r3: 0, r4: 0 } };
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
    // The defender is told, in Inferno words (WP 3.4).
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      targetid: DEFENDER,
      messagetype: "infernoattacked",
      byuserid: ATTACKER,
      subject: "raider attacked your Inferno yard",
      message: "It was left 30% damaged, and 2,000 Bone and 100 Coal were looted.",
    });
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

/** The client's checkpoint of the attack as it runs (`/base/checkpoint`). */
const checkpoint = async (tick = 900, log = SCRATCH) => {
  const ctx = {
    authUser: { userid: ATTACKER, username: "raider" },
    request: {
      body: {
        basesaveid: String(TARGET_SAVEID),
        attackid: String(ATTACK_ID),
        tick: String(tick),
        flinglog: JSON.stringify(log),
        sources: JSON.stringify([INFERNO_BASEID]),
      },
    },
  } as unknown as Context & { body: { stored?: boolean } };
  await attackCheckpoint(ctx, async () => {});
  return ctx.body;
};

describe("an attack left without its final save (owner, 27 Oct)", () => {
  test("its checkpoints are kept under the Inferno key, never the surface finaliser's", async () => {
    startSession();
    expect((await checkpoint()).stored).toBe(true);
    expect(store.has(infernoPlayerCheckpointKey(TARGET_SAVEID))).toBe(true);
    expect(store.has(attackCheckpointKey(TARGET_SAVEID))).toBe(false);
  });

  test("a refresh closes it: what the checkpoint recorded lands, the flung monsters are spent, the session ends", async () => {
    startSession();
    await checkpoint(900);
    canned = {
      damage: 30,
      flung: { IC1: 6 },
      attackloot: { r1: 1_000, r2: 0, r3: 0, r4: 0 },
      defenderDelta: { r1: -1_000, r2: 0, r3: 0, r4: 0 },
      buildinghealthdata: { "50": 400 },
      bunkerGarrisons: { 50: { IC1: 3 }, 51: { IC1: 3 } },
    };
    // The reloaded page's yard load (`baseLoad.ts`) asks for the attacker's attacks.
    expect(await closeInfernoPlayerAttacksOf(ATTACKER, "build")).toBe(1);

    // Fought to the checkpoint's moment, as an attack its attacker left.
    expect(inputs[0]!.tick).toBe(900);
    expect(inputs[0]!.left).toBe(true);
    expect(inferno.monsters.housed).toEqual({ IC1: 4 });
    expect(target).toMatchObject({ attackid: 0, damage: 30, buildinghealthdata: { "50": 400 } });
    expect(defenderMain.iresources.r1).toBe(4_000);
    expect(userSave.iresources.r1).toBe(1_000);
    expect(maprooms.get(DEFENDER)!.neighbors.map((one: { attacksfrom: number }) => one.attacksfrom)).toEqual([1]);
    expect(store.has(infernoPlayerSessionKey(TARGET_SAVEID))).toBe(false);
    expect(store.has(infernoPlayerCheckpointKey(TARGET_SAVEID))).toBe(false);
    expect(JSON.parse(store.get(INFERNO_PLAYER_ATTACKS)!)).toEqual([]);
    // The defender gets the usual notice.
    expect(notices.map((one) => [one.targetid, one.subject])).toEqual([[DEFENDER, "raider attacked your Inferno yard"]]);
  });

  test("the closed attack cannot be saved afterwards, nor closed twice", async () => {
    startSession();
    await checkpoint();
    canned = { damage: 10 };
    await closeInfernoPlayerAttacksOf(ATTACKER, "build");
    expect(transactions).toBe(1);
    // The same attack's final save, sent late, finds no attack to bind to.
    target.attackid = ATTACK_ID;
    expect((await run(finalSave()))?.data?.reason).toBeDefined();
    expect(await closeInfernoPlayerAttack(TARGET_SAVEID, "again")).toBe("none");
    expect(transactions).toBe(1);
  });

  test("a new attack/start closes it first, and the second attack meets the usual rules: no free retry", async () => {
    startSession();
    await checkpoint();
    canned = { damage: 55, flung: { IC1: 6 } };
    let refusal: unknown = "none";
    try {
      await infernoAttackStart(
        {
          authUser: { userid: ATTACKER, username: "raider", alliance_id: null },
          request: { body: { kind: "player", baseid: TARGET_BASEID } },
        } as never,
        async () => {}
      );
    } catch (err) {
      refusal = (err as { data?: { reason?: string } }).data?.reason ?? String(err);
    }
    // The first attack landed: the army it flung is gone and its damage gave the yard 36 hours.
    expect(inferno.monsters.housed).toEqual({ IC1: 4 });
    expect(target.damage).toBe(55);
    expect(refusal).toBe("protected");
  });

  test("with no checkpoint nothing was flung: the mark is cleared and nothing else is written", async () => {
    startSession();
    expect(await closeInfernoPlayerAttacksOf(ATTACKER, "build")).toBe(1);
    expect(transactions).toBe(0);
    expect(nativeUpdates).toEqual([{ where: { basesaveid: TARGET_SAVEID, attackid: ATTACK_ID }, data: { attackid: 0 } }]);
    expect(inferno.monsters.housed).toEqual(ARMY);
    expect(store.has(infernoPlayerSessionKey(TARGET_SAVEID))).toBe(false);
    expect(notices).toEqual([]);
  });

  test("the sweep closes it only once the window (the fight's limit and a margin) has closed", async () => {
    startSession();
    await checkpoint();
    canned = { damage: 10 };
    expect(await closeExpiredInfernoPlayerAttacks()).toBe(0);
    expect(store.has(infernoPlayerSessionKey(TARGET_SAVEID))).toBe(true);

    // The same attack, its window now closed.
    const startedat = now() - 421;
    startSession(undefined, startedat);
    store.set(
      infernoPlayerCheckpointKey(TARGET_SAVEID),
      JSON.stringify({
        attackerid: ATTACKER,
        defenderid: DEFENDER,
        attackid: ATTACK_ID,
        startedat,
        at: startedat + 100,
        tick: 600,
        flinglog: SCRATCH,
        sources: [INFERNO_BASEID],
      })
    );
    expect(await closeExpiredInfernoPlayerAttacks()).toBe(1);
    expect(inferno.monsters.housed).toEqual({ IC1: 4 });
    expect(target.attackid).toBe(0);
  });

  test("a yard another attack has since taken over is not written to", async () => {
    startSession();
    await checkpoint();
    target.attackid = 999;
    expect(await closeInfernoPlayerAttack(TARGET_SAVEID, "test")).toBe("stale");
    expect(transactions).toBe(0);
    expect(target.attackid).toBe(999);
  });
});
