import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

import type { InfernoProgress } from "../../database/models/infernoprogress.model.js";

/**
 * `POST /bm/inferno/attack/start` (WP 1.11): a Descent attack starts only on
 * the next yard, and every refusal comes before anything is written. A
 * started one mints its session, keyed by the attacker, with the main army
 * and the Flinger payload, and serves the yard as an Inferno yard: kind
 * `"inferno"`, its housed monsters defending from its Housing Bunkers.
 */

const ATTACKER = 3101;
const MAIN_BASEID = "5000";

/** The player's progress row, as the route's entity manager hands it back. */
let row: Partial<InfernoProgress> | null = null;
let userSave: Record<string, unknown>;
const calls: string[] = [];
const store = new Map<string, string>();
let declareWar = false;

mock.module("../../server.js", () => ({
  postgres: {
    em: {
      populate: async (user: Record<string, unknown>) => {
        calls.push("populate");
        user.save = userSave;
      },
      findOne: async () => {
        calls.push("findOne");
        return row;
      },
    },
  },
  redis: {
    setex: async (key: string, _ttl: number, value: string) => {
      calls.push("setex");
      store.set(key, value);
      return "OK";
    },
  },
}));

// The army catch-up reads and writes the attacker's rows; here it only says what the main yard houses.
// Bun keeps module mocks across files, so the rest of the module stays real
// and the stand-in hands back to the real catch-up once this file is done.
const REAL_ARMIES = "../../services/yard/armies.ts?real";
const realArmies = (await import(REAL_ARMIES)) as typeof import("../../services/yard/armies.js");
let standIn = true;
afterAll(() => {
  standIn = false;
});
const armies: unknown[] = [];
mock.module("../../services/yard/armies.js", () => ({
  ...realArmies,
  catchUpArmiesForAttack: async (input: Parameters<typeof realArmies.catchUpArmiesForAttack>[0]) => {
    if (!standIn) return realArmies.catchUpArmiesForAttack(input);
    calls.push("armies");
    armies.push(input);
    return { defender: input.defender, entryHoused: { [MAIN_BASEID]: { C1: 40 } } };
  },
}));

const REAL_POWERUPS = "../../services/alliance/powerups.ts?real";
const realPowerups = (await import(REAL_POWERUPS)) as typeof import("../../services/alliance/powerups.js");
mock.module("../../services/alliance/powerups.js", () => ({
  ...realPowerups,
  isDeclareWarRunning: async (allianceId: number | null) =>
    standIn ? declareWar : realPowerups.isDeclareWarRunning(allianceId),
  runningPowerups: async (allianceId: number | null) => (standIn ? [] : realPowerups.runningPowerups(allianceId)),
}));

const { infernoAttackStart } = await import("./descentAttack.js");
const { descentSessionKey, parseDescentSession } = await import("../../services/inferno/descentSession.js");
const { descentYardOf } = await import("../../services/inferno/descent.js");
const { MapRoomVersion } = await import("../../enums/MapRoom.js");

const progressRow = (beaten: number, emergence = 5): Partial<InfernoProgress> => ({
  userid: ATTACKER,
  emergence_level: emergence,
  descent_destroyed: Array.from({ length: 13 }, (_, index) => (index < beaten ? 1 : 0)),
  descent_best: [],
  descent_yards: {},
  popups_seen: {},
});

const contextFor = (body: unknown) =>
  ({ authUser: { userid: ATTACKER, alliance_id: null }, request: { body } }) as unknown as Context & { body: any };

/** The refusal `reason` the route answered with, or "none". */
const refusalOf = async (body: unknown): Promise<string> => {
  try {
    await infernoAttackStart(contextFor(body), async () => {});
    return "none";
  } catch (err) {
    return (err as { data?: { reason?: string } }).data?.reason ?? String(err);
  }
};

const saved = process.env.INFERNO_ENABLED;

beforeEach(() => {
  process.env.INFERNO_ENABLED = "on";
  row = progressRow(0);
  userSave = {
    baseid: MAIN_BASEID,
    basesaveid: 9,
    buildingdata: { "1": { t: 5, l: 4, X: 0, Y: 0, id: 1 }, "2": { t: 14, l: 6, X: 100, Y: 0, id: 2 } },
    academy: {},
    champion: [],
    resources: { r1: 1000, r2: 1000, r3: 0, r4: 0 },
    iresources: { r1: 3000, r2: 2000, r3: 1000, r4: 500 },
  };
  calls.length = 0;
  armies.length = 0;
  store.clear();
  declareWar = false;
});

afterEach(() => {
  if (saved === undefined) delete process.env.INFERNO_ENABLED;
  else process.env.INFERNO_ENABLED = saved;
});

describe("starting a Descent attack", () => {
  test("refused while the new Inferno is off, before anything is read", async () => {
    delete process.env.INFERNO_ENABLED;
    expect(await refusalOf({ kind: "descent", baseid: "201" })).toBe("infernoOff");
    expect(calls).toEqual([]);
  });

  test("the player kind is not built yet; a tribe attack on a Descent yard is refused", async () => {
    expect(await refusalOf({ kind: "raid", baseid: "201" })).toBe("kindNotReady");
    expect(await refusalOf({ baseid: "201" })).toBe("kindNotReady");
    expect(await refusalOf({ kind: "tribe", baseid: "201" })).toBe("notInfernoTribe");
    expect(calls).toEqual([]);
  });

  test("refused until the cave is up all five levels", async () => {
    row = progressRow(0, 4);
    expect(await refusalOf({ kind: "descent", baseid: "201" })).toBe("caveClosed");
    expect(store.size).toBe(0);
  });

  test("a wrong base is refused, with the one that is open, and nothing is written", async () => {
    row = progressRow(2);
    for (const baseid of ["201", "202", "204", "213"]) {
      try {
        await infernoAttackStart(contextFor({ kind: "descent", baseid }), async () => {});
        throw new Error("not refused");
      } catch (err) {
        expect((err as { status?: number }).status).toBe(409);
        expect((err as { data?: unknown }).data).toEqual({ reason: "notNextBase", next: "203" });
      }
    }
    expect(await refusalOf({ kind: "descent", baseid: "99" })).toBe("notDescentBase");
    expect(calls.filter((call) => call !== "populate" && call !== "findOne")).toEqual([]);
    expect(store.size).toBe(0);
  });

  test("refused once the Descent is passed", async () => {
    row = { ...progressRow(13), descent_passed_at: new Date() };
    expect(await refusalOf({ kind: "descent", baseid: "213" })).toBe("descentPassed");
    expect(store.size).toBe(0);
  });

  test("the next yard: the session holds the main army and the Flinger payload", async () => {
    row = progressRow(2);
    const ctx = contextFor({ kind: "descent", baseid: "203" });
    await infernoAttackStart(ctx, async () => {});

    const descent = parseDescentSession(store.get(descentSessionKey(ATTACKER)));
    expect(descent).not.toBeNull();
    expect(descent!.baseid).toBe("203");
    // Flinger level 4, main table: 2,500 (YARD_PROPS.as:709), not Map Room 2's 2,250.
    expect(descent!.flingerCapacity).toBe(2500);
    expect(descent!.session.attackerid).toBe(ATTACKER);
    expect(descent!.session.entryHoused).toEqual({ [MAIN_BASEID]: { C1: 40 } });
    // Main yard only: no outpost is in reach of a Descent yard.
    expect(armies[0]).toMatchObject({ cell: null, mapversion: MapRoomVersion.V1 });

    expect(ctx.body).toMatchObject({
      error: 0,
      kind: "descent",
      yardkind: "inferno",
      attackid: descent!.session.attackid,
      // Base id 203 is the third yard: what the client's fight burns by (WP 1.21).
      descentyard: 3,
      level: 3,
      flingercapacity: 2500,
      descentloot: { r1: 3000, r2: 2000, r3: 1000, r4: 500 },
    });
    expect(ctx.body.base.baseid).toBe("203");
    expect(Object.keys(ctx.body.base.buildingdata)).toEqual(Object.keys(descentYardOf(2).buildingdata as object));
    expect(ctx.body.defenderforces).toEqual(descent!.session.defenderForces);
  });

  test("Declare War widens the payload by a quarter", async () => {
    declareWar = true;
    await infernoAttackStart(contextFor({ kind: "descent", baseid: "201" }), async () => {});
    expect(parseDescentSession(store.get(descentSessionKey(ATTACKER)))!.flingerCapacity).toBe(3125);
  });

  test("from yard 206 its housed monsters defend from its Housing Bunker", async () => {
    row = progressRow(5);
    const ctx = contextFor({ kind: "descent", baseid: "206" });
    await infernoAttackStart(ctx, async () => {});

    const yard = descentYardOf(5);
    const bunker = Object.values(yard.buildingdata as Record<string, { t: number; id: number }>).find(
      (building) => building.t === 128
    )!;
    expect(ctx.body.defenderforces.bunkers).toEqual({ [bunker.id]: { IC1: 10 } });
  });

  test("a yard attacked before is served with the damage it kept", async () => {
    row = { ...progressRow(0), descent_yards: { "201": { health: { "3": 0 }, looted: { r1: 5 } } } };
    const ctx = contextFor({ kind: "descent", baseid: "201" });
    await infernoAttackStart(ctx, async () => {});
    expect(ctx.body.base.buildinghealthdata).toEqual({ "3": 0 });
  });
});
