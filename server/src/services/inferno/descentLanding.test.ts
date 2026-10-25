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
const ARMY = { C1: 200 };

const store = new Map<string, string>();
let row: Partial<InfernoProgress> | null;
let userSave: Record<string, unknown>;
const persisted: unknown[] = [];
let flushes = 0;
const sql: string[] = [];

mock.module("../../server.js", () => ({
  postgres: {
    em: {
      populate: async (user: Record<string, unknown>) => {
        user.save = userSave;
      },
      findOne: async () => row,
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

const { baseSave } = await import("../../controllers/base/save/baseSave.js");
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
  process.env.INFERNO_ENABLED = "on";
  (combatConfig as { mode: typeof MODE }).mode = "log";
  canned = null;
  replayTimesOut = false;
  inputs.length = 0;
  store.clear();
  persisted.length = 0;
  flushes = 0;
  sql.length = 0;
  warn.mockClear();
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
    const POKEYS = { v: 1, seed: 7, events: [{ kind: "fling", t: 40, x: 300, y: 150, r: 100, monsters: { C1: 40 } }] };
    const ctx = finalSave("207", { tick: "12000", flinglog: JSON.stringify(POKEYS) });

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
    expect(userSave.iresources).toEqual({ r1: 3010, r2: 2010, r3: 1010, r4: 510 });
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
