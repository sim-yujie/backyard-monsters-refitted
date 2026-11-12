import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Context } from "koa";

import type { InfernoProgress } from "../../database/models/infernoprogress.model.js";
import type { AbandonedInput, AbandonedOutcome } from "../base/combat/abandonedAttack.js";

/**
 * The Descent landing (WP 1.12, `docs/design/inferno.md` §2.4): the
 * `/base/save` that ends a Descent attack lands the server's own battle, once,
 * for the attack `POST /bm/inferno/attack/start` minted. A win at 90% beats
 * the yard, the loot goes into the Inferno purse with no cap, a loss keeps the
 * yard as the fight left it, the 13th win makes the Inferno yard, and the
 * achievements hear Flash's counter. What the client says it did is only
 * compared; a save with no attack behind it lands nothing.
 */

const ATTACKER = 3201;
const MAIN_BASEID = "5000";
const ATTACK_ID = 5151;
const NEW_YARD_BASEID = "777001";
/** The Descent defence the start served (no bunkers on the first yards). */
const FORCES = { bunkers: {}, defenderLevels: { IC1: 2 }, defenderChampions: [] };
const ARMY = { C1: 200, C10: 20 };

const store = new Map<string, string>();
/** A Redis delete this picks fails, as if the server died right there. */
let crashOn: ((key: string) => boolean) | null = null;
const sets = new Map<string, Set<string>>();
let row: Partial<InfernoProgress> | null;
let userSave: Record<string, unknown>;
const persisted: unknown[] = [];
let flushes = 0;
const sql: string[] = [];

/** The stand-in ORM's entity manager: only it skips the request context (the finaliser's own). */
const fakeOrmEm = {};

mock.module("../../server.js", () => ({
  postgres: {
    orm: { em: fakeOrmEm },
    em: {
      populate: async (user: Record<string, unknown>) => {
        user.save = userSave;
      },
      // The finaliser loads the attacker with their row; anything else is the Inferno progress row.
      findOne: async (entity: { name?: string }) =>
        entity?.name === "User" ? { userid: ATTACKER, username: "descender", save: userSave } : row,
      create: (entity: new () => object, data: object) => Object.assign(new entity(), data),
      persist: (entity: unknown) => persisted.push(entity),
      flush: async () => {
        flushes += 1;
      },
      // Only the new yard's base id is answered; anything else fails as with no database.
      execute: async (query: string) => {
        sql.push(query);
        if (!query.includes("user_baseid_seq")) throw new Error("no database");
        return [{ baseid: NEW_YARD_BASEID }];
      },
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
mock.module("../../utils/logger.js", () => ({
  logger: { warn, error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

/** The `Report` rows written, as their messages: the admins' Flagged list. */
const reports: string[] = [];
mock.module("../base/reportManager.js", () => ({
  logReport: async (_user: unknown, message: string) => {
    reports.push(message);
  },
  logAttackViolation: async () => {},
  logBanReport: async () => {},
}));

// The real replay runner, unless a test hands the battle in (`canned`) or
// asks for one that times out. Every input is kept. The query makes the real
// module one no mock replaces; bun keeps module mocks across files, so it is
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

const { baseSave } = await import("../../controllers/base/save/baseSave.js");
const { attackCheckpoint } = await import("../../controllers/base/attackCheckpoint.js");
const { finaliseRowlessAttacksOf } = await import("../base/finaliseRowlessAttack.js");
const { ROWLESS_CHECKPOINT_INDEX, rowlessCheckpointKey } = await import("../base/rowlessCheckpoint.js");
const { combatConfig } = await import("../../config/CombatConfig.js");
const MODE = combatConfig.mode;
const { serialiseAttackSession } = await import("../base/attackSession.js");
const { descentFinalLockKey, descentSessionKey } = await import("./descentSession.js");
const { descentYardOf } = await import("./descent.js");
const { infernoStartBuildingData } = await import("./infernoYard.js");
const { mr1TribePool } = await import("../maproom/v1/mr1TribeRules.js");
const { LOOT_GAIN_RATIO } = await import("../../game-rules/combat/index.js");
const { replayAbandonedAttack } = await import("../base/combat/abandonedAttack.js");
const { BaseType } = await import("../../enums/Base.js");
const achievementEvents = await import("../achievements/events.js");

/** The achievement events the landing sent, as `[basesaveid, events]`. */
const achieved = spyOn(achievementEvents, "recordAchievementEvents").mockImplementation(async () => null);
afterAll(() => achieved.mockRestore());

/** A whole battle outcome, with `part` over a quiet default. */
const outcome = (part: Partial<AbandonedOutcome>): AbandonedOutcome => ({
  tick: 2_400,
  buildinghealthdata: {},
  damage: 0,
  destroyed: 0,
  firedTraps: [],
  attackloot: { r1: 0, r2: 0, r3: 0, r4: 0 },
  defenderDelta: { r1: 0, r2: 0, r3: 0, r4: 0 },
  flung: { C1: 4 },
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

/** The Descent attack the start mints, on `baseid`. */
const startSession = (baseid = "201", attackerid = ATTACKER) =>
  store.set(
    descentSessionKey(ATTACKER),
    JSON.stringify({
      baseid,
      flingerCapacity: 2500,
      session: serialiseAttackSession({
        attackerid,
        attackid: ATTACK_ID,
        startedat: now(),
        entryHoused: { [MAIN_BASEID]: ARMY },
        defenderForces: FORCES as never,
        attackerAcademy: {},
      }),
    })
  );

/** Four Pokeys flung at the edge of the yard: towers make short work of them. */
const SCRATCH = { v: 1, seed: 7, events: [{ kind: "fling", t: 40, x: 300, y: 150, r: 100, monsters: { C1: 4 } }] };
const SCRATCH_TICK = 2_400;

/** What the client claims: the yard flattened and a fortune taken. */
const FORGED = {
  damage: "100",
  destroyed: "1",
  attackloot: JSON.stringify({ r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 }),
};

const ctxFor = (body: Record<string, string>) =>
  ({
    authUser: { userid: ATTACKER, username: "descender" },
    request: { body: { baseid: "201", basesaveid: "0", ...body } },
    ip: "127.0.0.1",
    path: "/base/save",
  }) as unknown as Context & { body: { descent?: Record<string, unknown> } };

/** The save that ends the attack, on `baseid`. */
const finalSave = (baseid = "201", extra: Record<string, string> = {}) =>
  ctxFor({
    baseid,
    over: "1",
    attackid: String(ATTACK_ID),
    tick: String(SCRATCH_TICK),
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

const progressRow = (beaten: number): Partial<InfernoProgress> => ({
  userid: ATTACKER,
  emergence_level: 5,
  descent_destroyed: Array.from({ length: 13 }, (_, index) => (index < beaten ? 1 : 0)),
  descent_best: [],
  descent_yards: {},
  popups_seen: {},
});

const PURSE = { r1: 3000, r2: 2000, r3: 1000, r4: 500 };
const savedSwitch = process.env.INFERNO_ENABLED;

beforeEach(() => {
  crashOn = null;
  process.env.INFERNO_ENABLED = "on";
  (combatConfig as { mode: typeof MODE }).mode = "log";
  canned = null;
  replayTimesOut = false;
  inputs.length = 0;
  store.clear();
  sets.clear();
  persisted.length = 0;
  flushes = 0;
  sql.length = 0;
  warn.mockClear();
  reports.length = 0;
  achieved.mockClear();
  row = progressRow(0);
  userSave = {
    userid: ATTACKER,
    baseid: MAIN_BASEID,
    basesaveid: 9,
    worldid: "w1",
    resources: { r1: 100, r2: 100, r3: 100, r4: 100 },
    iresources: { ...PURSE },
    savetime: now(),
    buildingdata: {},
    storedata: {},
    academy: {},
    champion: [],
    monsters: { housed: { ...ARMY } },
  };
});

afterEach(() => {
  canned = null;
  replayTimesOut = false;
  (combatConfig as { mode: typeof MODE }).mode = MODE;
  if (savedSwitch === undefined) delete process.env.INFERNO_ENABLED;
  else process.env.INFERNO_ENABLED = savedSwitch;
});

/** Nothing written: no row, no purse, no session spent. */
const expectNothingLanded = () => {
  expect(persisted).toEqual([]);
  expect(flushes).toBe(0);
  expect(userSave.iresources).toEqual(PURSE);
  expect(row?.descent_destroyed?.[0]).toBe(0);
  expect(row?.descent_yards).toEqual({});
  expect(achieved).not.toHaveBeenCalled();
};

describe("a Descent save with no attack behind it lands nothing", () => {
  test("no attack started", async () => {
    canned = { damage: 100, attackloot: { r1: 50, r2: 50, r3: 50, r4: 50 } };
    const caught = await run(finalSave("201", FORGED));

    expect(caught?.data?.reason).toBe("no-session");
    expect(inputs).toEqual([]);
    expectNothingLanded();
  });

  test("an attack started on another yard does not authorise it", async () => {
    startSession("202");
    const caught = await run(finalSave("201", FORGED));

    expect(caught?.data?.reason).toBe("no-session");
    expectNothingLanded();
    expect(store.has(descentSessionKey(ATTACKER))).toBe(true);
  });

  test("another account's attack does not authorise it", async () => {
    startSession("201", 77);
    const caught = await run(finalSave("201", FORGED));

    expect(caught?.data?.reason).toBe("wrong-attacker");
    expectNothingLanded();
  });

  test("a save naming another attack id is refused", async () => {
    startSession();
    const caught = await run(finalSave("201", { attackid: "1" }));

    expect(caught?.data?.reason).toBe("stale-attack");
    expectNothingLanded();
  });

  test("a save without `over` writes nothing and keeps the attack", async () => {
    startSession();
    canned = { damage: 100 };
    const ctx = ctxFor({ attackid: String(ATTACK_ID), flinglog: JSON.stringify(SCRATCH), ...FORGED });

    expect(await run(ctx)).toBeNull();
    expect(ctx.body.descent).toBeUndefined();
    expect(inputs).toEqual([]);
    expectNothingLanded();
    expect(store.has(descentSessionKey(ATTACKER))).toBe(true);
  });

  test("a replay past its deadline lands nothing and keeps the attack for a resent save", async () => {
    startSession();
    replayTimesOut = true;
    const caught = await run(finalSave());

    expect(caught?.data?.reason).toBe("replayTimeout");
    expectNothingLanded();
    expect(store.has(descentSessionKey(ATTACKER))).toBe(true);
  });

  test("a second save while the first is landing is refused", async () => {
    startSession();
    store.set(descentFinalLockKey(ATTACKER), "1");
    const caught = await run(finalSave());

    expect(caught?.data?.reason).toBe("finalising");
    expectNothingLanded();
  });

  test("with the Inferno off, nothing lands", async () => {
    startSession();
    process.env.INFERNO_ENABLED = "off";
    canned = { damage: 100 };
    const caught = await run(finalSave());

    expect(caught).not.toBeNull();
    expectNothingLanded();
  });
});

describe("the save that ends a Descent attack", () => {
  test("fights the yard as an Inferno yard, with the defence the start served and no catapult", async () => {
    startSession();
    canned = { damage: 40 };
    await run(finalSave());

    expect(inputs).toHaveLength(1);
    const [input] = inputs;
    expect(input!.defender.kind).toBe("inferno");
    expect(input!.defence).toEqual(FORCES as never);
    // The yard's number, base id less 200, for the burn from yard 7 (WP 1.21).
    expect(input!.descentYard).toBe(1);
    expect(Object.keys(input!.defender.buildingdata ?? {})).toHaveLength(
      Object.keys(descentYardOf(0).buildingdata as object).length
    );
  });

  test("no siege weapon in the Descent (owner: siege is for the overworld): the Decoy is cut and none is spent", async () => {
    const stock = { decoy: { level: 1, quantity: 2 } };
    userSave.siege = structuredClone(stock);
    startSession();
    canned = { damage: 40 };
    const log = { ...SCRATCH, events: [...SCRATCH.events, { kind: "siege", t: 60, x: 300, y: 150, weapon: "decoy" }] };
    await run(finalSave("201", { flinglog: JSON.stringify(log) }));
    const [input] = inputs;
    expect(input!.log.events.map((event) => event.kind)).toEqual(["fling"]);
    expect(input!.attacker.siege).toBeNull();
    expect(userSave.siege).toEqual(stock);
  });

  test("a win at 90% beats the yard and puts the loot in the Inferno purse, with no cap", async () => {
    startSession();
    // A purse well past any storage: the Descent's loot is never cut to fit (Flash).
    userSave.iresources = { r1: 9_000_000, r2: 0, r3: 0, r4: 0 };
    const loot = { r1: 400, r2: 300, r3: 200, r4: 100 };
    canned = { damage: 90, attackloot: loot, buildinghealthdata: { "0": 0 } };
    const ctx = finalSave();

    expect(await run(ctx)).toBeNull();
    expect(userSave.iresources).toEqual({ r1: 9_000_400, r2: 300, r3: 200, r4: 100 });
    expect(row!.descent_destroyed).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(row!.descent_best![0]).toBe(90);
    // Beaten: nothing kept for it.
    expect(row!.descent_yards).toEqual({});
    expect(ctx.body.descent).toEqual({
      won: true,
      damage: 90,
      level: 2,
      loot,
      total: { r1: 9_000_400, r2: 300, r3: 200, r4: 100 },
      captured: false,
      infernobaseid: null,
    });
    // The main yard's resources are not touched.
    expect(userSave.resources).toEqual({ r1: 100, r2: 100, r3: 100, r4: 100 });
    expect(store.has(descentSessionKey(ATTACKER))).toBe(false);
    expect(achieved).toHaveBeenCalledTimes(1);
    expect(achieved.mock.calls[0]![1]).toBe(9);
    expect(achieved.mock.calls[0]![2]).toEqual({ descent: 2 });
  });

  test("a loss below 90% keeps the yard's damage and what it gave, and the counter where it was", async () => {
    startSession();
    const loot = { r1: 40, r2: 30, r3: 0, r4: 0 };
    canned = { damage: 89.9, attackloot: loot, buildinghealthdata: { "1": 0, "2": 120 } };
    const ctx = finalSave();

    expect(await run(ctx)).toBeNull();
    expect(row!.descent_destroyed![0]).toBe(0);
    expect(row!.descent_best![0]).toBe(89);
    expect(row!.descent_yards).toEqual({
      "201": { health: { "1": 0, "2": 120 }, looted: { r1: 40, r2: 30, r3: 0, r4: 0 } },
    });
    expect(userSave.iresources).toEqual({ r1: 3040, r2: 2030, r3: 1000, r4: 500 });
    expect(ctx.body.descent).toMatchObject({ won: false, damage: 89, level: 1, captured: false });
    // Achievement 18 is earned by any first attack, won or lost.
    expect(achieved.mock.calls[0]![2]).toEqual({ descent: 1 });
  });

  test("the next attack fights the damaged yard and cannot loot it again from full", async () => {
    const cap = Math.floor(mr1TribePool(descentYardOf(0)).r1 * LOOT_GAIN_RATIO);
    row!.descent_yards = { "201": { health: { "1": 0 }, looted: { r1: cap - 10, r2: 0, r3: 0, r4: 0 } } };
    startSession();
    canned = { damage: 50, attackloot: { r1: 5_000, r2: 0, r3: 0, r4: 0 }, buildinghealthdata: { "1": 0, "3": 0 } };

    expect(await run(finalSave())).toBeNull();
    expect(inputs[0]!.defender.buildinghealthdata).toEqual({ "1": 0 });
    expect((userSave.iresources as Record<string, number>).r1).toBe(PURSE.r1 + 10);
    expect(row!.descent_yards!["201"]).toEqual({
      health: { "1": 0, "3": 0 },
      looted: { r1: cap, r2: 0, r3: 0, r4: 0 },
    });
  });

  test("the same save sent again lands nothing more", async () => {
    startSession();
    canned = { damage: 95, attackloot: { r1: 100, r2: 0, r3: 0, r4: 0 } };
    expect(await run(finalSave())).toBeNull();
    const purse = { ...(userSave.iresources as object) };

    const again = await run(finalSave());
    expect(again?.data?.reason).toBe("no-session");
    expect(userSave.iresources).toEqual(purse);
    expect(row!.descent_destroyed![1]).toBe(0);
    expect(achieved).toHaveBeenCalledTimes(1);
  });

  test("a forged result is ignored: the server's battle decides (mocked battle)", async () => {
    startSession();
    canned = { damage: 12, attackloot: { r1: 5, r2: 0, r3: 0, r4: 0 } };
    const ctx = finalSave("201", FORGED);

    expect(await run(ctx)).toBeNull();
    expect(ctx.body.descent).toMatchObject({ won: false, damage: 12, loot: { r1: 5, r2: 0, r3: 0, r4: 0 } });
    expect(userSave.iresources).toEqual({ ...PURSE, r1: PURSE.r1 + 5 });
    expect(row!.descent_destroyed![0]).toBe(0);
    const logged = warn.mock.calls
      .map((call) => call[1] as { event?: string; fields?: string[] } | undefined)
      .find((line) => line?.event === "attack-replay-mismatch");
    expect(logged?.fields).toEqual(expect.arrayContaining(["damage", "destroyed", "attackloot"]));
  });

  test("a forged result is ignored: a real replay of four Pokeys on yard 201", async () => {
    startSession();
    const ctx = finalSave("201", FORGED);

    expect(await run(ctx)).toBeNull();
    const server = replayAbandonedAttack(inputs[0]!);
    expect(server.damage).toBeLessThan(90);
    expect(ctx.body.descent).toMatchObject({ won: false, damage: Math.floor(server.damage), level: 1 });
    const gained = Object.fromEntries(
      Object.entries(userSave.iresources as Record<string, number>).map(([key, value]) => [
        key,
        value - PURSE[key as keyof typeof PURSE],
      ])
    );
    expect(gained).toEqual(ctx.body.descent!.loot as Record<string, number>);
    expect((ctx.body.descent!.loot as Record<string, number>).r1).toBeLessThan(1e9);
    expect(row!.descent_destroyed![0]).toBe(0);
  });

  test("from yard 7 the server's replay burns surface monsters, as the client's fight does (WP 1.21)", async () => {
    row = progressRow(6);
    startSession("207");
    // Twenty Crabatrons, which live long enough under the towers for the burn
    // to show in the damage (7.29% burnt, 7.61% not); Pokeys die too fast to tell.
    const CRABATRONS = { v: 1, seed: 7, events: [{ kind: "fling", t: 40, x: 300, y: 150, r: 100, monsters: { C10: 20 } }] };
    const ctx = finalSave("207", { tick: "12000", flinglog: JSON.stringify(CRABATRONS) });

    expect(await run(ctx)).toBeNull();
    const input = inputs[0]!;
    expect(input.descentYard).toBe(7);
    const burnt = replayAbandonedAttack(input);
    const unburnt = replayAbandonedAttack({ ...input, descentYard: undefined });
    expect(ctx.body.descent!.damage).toBe(Math.floor(burnt.damage));
    expect(burnt.damage).toBeLessThan(unburnt.damage);
  });
});

describe("the 13th win: the Descent is passed", () => {
  test("makes the Inferno yard with Flash's start layout and records counter 14", async () => {
    row = progressRow(12);
    startSession("213");
    canned = { damage: 100, attackloot: { r1: 10, r2: 10, r3: 10, r4: 10 } };
    const ctx = finalSave("213");

    expect(await run(ctx)).toBeNull();
    expect(ctx.body.descent).toMatchObject({ won: true, level: 14, captured: true, infernobaseid: NEW_YARD_BASEID });
    expect(inputs[0]!.descentYard).toBe(13);
    expect(row!.descent_destroyed!.every((flag) => flag === 1)).toBe(true);
    expect(row!.descent_passed_at).toBeInstanceOf(Date);
    expect(row!.inferno_baseid).toBe(NEW_YARD_BASEID);
    // Owning the yard unlocks Korath; the main yard tells the player on its next load (WP 5.1).
    expect(row!.korath_unlocked_at).toEqual(row!.descent_passed_at);
    expect(row!.korath_notice_at ?? null).toBeNull();

    const yard = persisted.find(
      (entity) => (entity as { type?: unknown }).type === BaseType.INFERNO
    ) as Record<string, unknown>;
    expect(yard).toBeDefined();
    expect(yard.baseid).toBe(NEW_YARD_BASEID);
    expect(yard.buildingdata).toEqual(infernoStartBuildingData());
    expect(Object.values(yard.buildingdata as Record<string, { t: number; l: number }>).map((b) => [b.t, b.l])).toEqual([
      [14, 1],
      [1, 1],
      [2, 1],
      [6, 3],
      [6, 3],
    ]);
    expect(userSave.baseid_inferno).toBe(Number(NEW_YARD_BASEID));
    // The purse holds what the Descent looted; it is the Inferno yard's to spend.
    // Its caps are the new yard's: 10,000 plus two level 3 pods (`syncInfernoCap`).
    expect(userSave.iresources).toEqual({
      r1: 3010,
      r2: 2010,
      r3: 1010,
      r4: 510,
      r1max: 70_000,
      r2max: 70_000,
      r3max: 70_000,
      r4max: 70_000,
    });
    expect(achieved.mock.calls[0]![2]).toEqual({ descent: 14 });
  });

  test("a player who already has an Inferno yard does not get a second", async () => {
    row = { ...progressRow(12), inferno_baseid: "4444" };
    startSession("213");
    canned = { damage: 100 };
    const ctx = finalSave("213");

    expect(await run(ctx)).toBeNull();
    expect(ctx.body.descent).toMatchObject({ captured: true, infernobaseid: "4444" });
    expect(sql).toEqual([]);
    expect(persisted.some((entity) => (entity as { type?: unknown }).type === BaseType.INFERNO)).toBe(false);
  });

  test("a 13th yard lost leaves the Descent open", async () => {
    row = progressRow(12);
    startSession("213");
    canned = { damage: 70 };
    const ctx = finalSave("213");

    expect(await run(ctx)).toBeNull();
    expect(ctx.body.descent).toMatchObject({ won: false, level: 13, captured: false, infernobaseid: null });
    expect(row!.descent_passed_at).toBeUndefined();
    expect(sql).toEqual([]);
  });
});

/** The client's running record of the attack on `baseid` (`POST /base/checkpoint`). */
const sendCheckpoint = async (baseid: string, log: unknown, tick: number, sources: string[]) => {
  const ctx = {
    authUser: { userid: ATTACKER, username: "attacker" },
    request: {
      body: {
        basesaveid: "0",
        baseid,
        attackid: String(ATTACK_ID),
        tick: String(tick),
        flinglog: JSON.stringify(log),
        sources: JSON.stringify(sources),
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

/**
 * Leaving never undoes the attack (owner, 2 Nov 2026): when the final save
 * never arrives, the attacker's next load lands the Descent attack from the
 * last checkpoint the server holds, and never more than that record shows.
 */
describe("a Descent attack left without a save", () => {
  const REF = { kind: "descent" as const, userid: ATTACKER, baseid: "201" };

  test("the next load lands it from its last checkpoint: the battle to that tick, the loot, the yard beaten", async () => {
    startSession();
    const loot = { r1: 400, r2: 300, r3: 200, r4: 100 };
    canned = { damage: 90, attackloot: loot, buildinghealthdata: { "0": 0 } };
    expect(await sendCheckpoint("201", SCRATCH, 1_200, [MAIN_BASEID])).toMatchObject({ stored: true });

    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(1);
    // The server's own battle, fought to the moment the attacker was last seen.
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.tick).toBe(1_200);
    expect(userSave.iresources).toEqual({ r1: 3400, r2: 2300, r3: 1200, r4: 600 });
    expect(row!.descent_destroyed![0]).toBe(1);
    expect(store.has(descentSessionKey(ATTACKER))).toBe(false);
    expect(store.has(rowlessCheckpointKey(REF))).toBe(false);
    expect(sets.get(ROWLESS_CHECKPOINT_INDEX)?.size ?? 0).toBe(0);

    // Once: the next load finds nothing, and a late save is refused.
    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(0);
    expect((await run(finalSave()))?.data?.reason).toBe("no-session");
    expect(userSave.iresources).toEqual({ r1: 3400, r2: 2300, r3: 1200, r4: 600 });
    expect(inputs).toHaveLength(1);
  });

  test("a loss at the checkpoint stays a loss: the yard keeps its damage, the counter stays", async () => {
    startSession();
    canned = { damage: 40, attackloot: { r1: 10, r2: 0, r3: 0, r4: 0 }, buildinghealthdata: { "1": 0 } };
    await sendCheckpoint("201", SCRATCH, 1_200, [MAIN_BASEID]);

    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(1);
    expect(row!.descent_destroyed![0]).toBe(0);
    expect(row!.descent_best![0]).toBe(40);
    expect(store.has(descentSessionKey(ATTACKER))).toBe(false);
  });

  test("a checkpoint that arrives after the save lands nothing more", async () => {
    startSession();
    canned = { damage: 50, attackloot: { r1: 40, r2: 0, r3: 0, r4: 0 }, buildinghealthdata: {} };
    expect(await run(finalSave())).toBeNull();
    const purse = structuredClone(userSave.iresources);
    const best = row!.descent_best![0];

    expect(await sendCheckpoint("201", SCRATCH, 2_000, [MAIN_BASEID])).toMatchObject({ data: { reason: "no-session" } });
    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(0);
    expect(userSave.iresources).toEqual(purse);
    expect(row!.descent_best![0]).toBe(best);
    expect(store.has(rowlessCheckpointKey(REF))).toBe(false);
  });

  test("a crash between ending the session and dropping the checkpoint never lands it twice", async () => {
    startSession();
    canned = { damage: 50, attackloot: { r1: 40, r2: 0, r3: 0, r4: 0 }, buildinghealthdata: {} };
    await sendCheckpoint("201", SCRATCH, 1_200, [MAIN_BASEID]);

    crashOn = (key) => key === rowlessCheckpointKey(REF);
    await finaliseRowlessAttacksOf(ATTACKER, "load");
    crashOn = null;
    expect(store.has(descentSessionKey(ATTACKER))).toBe(false);
    expect(store.has(rowlessCheckpointKey(REF))).toBe(true);
    const purse = structuredClone(userSave.iresources);
    expect(purse).not.toEqual(PURSE);
    expect(inputs).toHaveLength(1);

    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(0);
    expect(userSave.iresources).toEqual(purse);
    expect(inputs).toHaveLength(1);
    expect(store.has(rowlessCheckpointKey(REF))).toBe(false);
  });

  test("with the Inferno switched off nothing of it lands; the checkpoint waits", async () => {
    startSession();
    canned = { damage: 90, attackloot: { r1: 400, r2: 0, r3: 0, r4: 0 }, buildinghealthdata: {} };
    await sendCheckpoint("201", SCRATCH, 1_200, [MAIN_BASEID]);
    process.env.INFERNO_ENABLED = "off";

    expect(await finaliseRowlessAttacksOf(ATTACKER, "load")).toBe(0);
    expect(userSave.iresources).toEqual(PURSE);
    expect(store.has(rowlessCheckpointKey(REF))).toBe(true);
  });
});

/**
 * A Descent save whose result disagrees with the server's battle under
 * `COMBAT_SAVE_VALIDATION=reject` (owner, 12 Nov 2026, desk card
 * "descent-refused-rule"): flagged for the admins exactly as before, but no
 * longer refused, so the attack lands with the server's own full battle
 * rather than from the finaliser's last checkpoint, up to 5 s short of it.
 */
describe("a Descent save the server's battle overrules (reject mode)", () => {
  const mismatchLines = () =>
    warn.mock.calls
      .map((call) => call[1] as { event?: string; outcome?: string; fields?: string[]; rowless?: string } | undefined)
      .filter((line) => line?.event === "attack-replay-mismatch");

  beforeEach(() => {
    (combatConfig as { mode: typeof MODE }).mode = "reject";
  });

  test("a screen loss the server's battle won lands the win: best %, beaten yard, loot", async () => {
    startSession();
    const loot = { r1: 400, r2: 300, r3: 200, r4: 100 };
    canned = { damage: 93.4, destroyed: 0, attackloot: loot, buildinghealthdata: { "0": 0, "1": 0 } };
    // The screen says 70%: a smaller fight, little loot.
    const ctx = finalSave("201", {
      damage: "70",
      attackloot: JSON.stringify({ r1: 10, r2: 0, r3: 0, r4: 0 }),
    });

    expect(await run(ctx)).toBeNull();
    expect(ctx.body.descent).toEqual({
      won: true,
      damage: 93,
      level: 2,
      loot,
      total: { r1: PURSE.r1 + 400, r2: PURSE.r2 + 300, r3: PURSE.r3 + 200, r4: PURSE.r4 + 100 },
      captured: false,
      infernobaseid: null,
      overruled: true,
    });
    expect(row!.descent_destroyed![0]).toBe(1);
    expect(row!.descent_best![0]).toBe(93);
    expect(userSave.iresources).toEqual({ r1: PURSE.r1 + 400, r2: PURSE.r2 + 300, r3: PURSE.r3 + 200, r4: PURSE.r4 + 100 });
    // Spent: the finaliser has nothing left to land.
    expect(store.has(descentSessionKey(ATTACKER))).toBe(false);
    expect(achieved).toHaveBeenCalledTimes(1);

    // Flagged as before: the same warning and the same Report row.
    const lines = mismatchLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ outcome: "rejected", mode: "reject" });
    expect(lines[0]!.fields).toEqual(expect.arrayContaining(["damage", "attackloot"]));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatch(/^Attack save on base 201 rejected \(reject\): disagrees with the replay on .*damage.*$/);
  });

  test("a forged win the server's battle lost lands the loss, the yard keeping the battle's health", async () => {
    startSession();
    const loot = { r1: 40, r2: 30, r3: 0, r4: 0 };
    canned = { damage: 61.7, attackloot: loot, buildinghealthdata: { "1": 0, "2": 120 } };
    const ctx = finalSave("201", FORGED);

    expect(await run(ctx)).toBeNull();
    expect(ctx.body.descent).toMatchObject({ won: false, damage: 61, level: 1, loot, overruled: true });
    expect(row!.descent_destroyed![0]).toBe(0);
    expect(row!.descent_best![0]).toBe(61);
    expect(row!.descent_yards).toEqual({ "201": { health: { "1": 0, "2": 120 }, looted: loot } });
    expect(userSave.iresources).toEqual({ ...PURSE, r1: PURSE.r1 + 40, r2: PURSE.r2 + 30 });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("rejected (reject)");
  });

  test("the champion comes home at the server's battle's health, not the screen's", async () => {
    const GORGO = { t: 1, l: 3, hp: 3000, fb: 0, status: 0, fd: 0, ft: 0, pl: 0 };
    userSave.champion = [{ ...GORGO }];
    store.set(
      descentSessionKey(ATTACKER),
      JSON.stringify({
        baseid: "201",
        flingerCapacity: 2500,
        session: serialiseAttackSession({
          attackerid: ATTACKER,
          attackid: ATTACK_ID,
          startedat: now(),
          entryHoused: { [MAIN_BASEID]: ARMY },
          defenderForces: FORCES as never,
          attackerAcademy: {},
          championHealth: { "1": 3000 },
        }),
      })
    );
    canned = {
      damage: 40,
      championsFlung: [1],
      attackerchampion: [{ ...GORGO, hp: 1234 }] as never,
    };
    const ctx = finalSave("201", {
      ...FORGED,
      attackerchampion: JSON.stringify([{ ...GORGO, hp: 2900 }]),
    });

    expect(await run(ctx)).toBeNull();
    expect(ctx.body.descent).toMatchObject({ won: false, damage: 40, overruled: true });
    expect((userSave.champion as { t: number; hp: number }[])[0]).toMatchObject({ t: 1, hp: 1234 });
  });

  test("a real replay of four Pokeys on yard 201 lands in full, to the save's last tick", async () => {
    startSession();
    const ctx = finalSave("201", FORGED);

    expect(await run(ctx)).toBeNull();
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.tick).toBe(SCRATCH_TICK);
    const server = replayAbandonedAttack(inputs[0]!);
    expect(ctx.body.descent).toMatchObject({ won: false, damage: Math.floor(server.damage), overruled: true });
    expect(row!.descent_best![0]).toBe(Math.floor(server.damage));
    expect(reports).toHaveLength(1);
  });

  test("a save that agrees with the server's battle is not flagged or marked", async () => {
    startSession();
    canned = { damage: 50, attackloot: { r1: 5, r2: 0, r3: 0, r4: 0 }, buildinghealthdata: { "1": 0 } };
    const ctx = finalSave("201", {
      damage: "50",
      attackloot: JSON.stringify({ r1: 5, r2: 0, r3: 0, r4: 0 }),
      buildinghealthdata: JSON.stringify({ "1": 0 }),
    });

    expect(await run(ctx)).toBeNull();
    expect(mismatchLines()).toEqual([]);
    expect(reports).toEqual([]);
    expect(ctx.body.descent).not.toHaveProperty("overruled");
  });

  test("in log mode a disagreeing save lands the server's battle as before, unmarked", async () => {
    (combatConfig as { mode: typeof MODE }).mode = "log";
    startSession();
    canned = { damage: 12, attackloot: { r1: 5, r2: 0, r3: 0, r4: 0 } };
    const ctx = finalSave("201", FORGED);

    expect(await run(ctx)).toBeNull();
    expect(ctx.body.descent).toMatchObject({ won: false, damage: 12 });
    expect(ctx.body.descent).not.toHaveProperty("overruled");
    expect(reports[0]).toContain("flagged (log)");
  });
});
