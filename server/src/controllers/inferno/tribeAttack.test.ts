import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * The Inferno map's Moloch tribes (WP 2.7) and starting an attack on one (WP
 * 2.8, `docs/design/inferno.md` §2.7, §3.2): the seven tribes by the Inferno
 * yard's level, the hour's respawn, and an attack that flings the Inferno
 * yard's Housing Bunker army only, a bunker's load per fling (R11), refused
 * before its session for a tribe that is not the player's, still wrecked, or
 * with nothing to fling.
 */

const ATTACKER = 3301;
const MAIN_BASEID = "5000";
const INFERNO_BASEID = "6000";
const NOW = 1_800_000_000;

let userSave: Record<string, unknown>;
let inferno: Record<string, unknown> | null;
let maproom: Record<string, unknown> | null;
const persisted: unknown[] = [];
let flushes = 0;
const store = new Map<string, string>();
let declareWar = false;

const em = {
  populate: async (user: Record<string, unknown>) => {
    user.save = userSave;
  },
  findOne: async (entity: { name: string }, where: Record<string, unknown>) => {
    if (entity.name === "InfernoMaproom") return maproom;
    if (where.basesaveid !== undefined) return userSave;
    return String(where.baseid) === INFERNO_BASEID ? inferno : null;
  },
  create: (entity: new () => object, data: object) => Object.assign(new entity(), data),
  persist: (entity: unknown) => {
    persisted.push(entity);
    if ((entity as { constructor?: { name?: string } })?.constructor?.name === "InfernoMaproom") {
      maproom = entity as Record<string, unknown>;
    }
  },
  flush: async () => {
    flushes += 1;
  },
  transactional: async (run: (tx: unknown) => Promise<unknown>) => run(em),
};

mock.module("../../server.js", () => ({
  postgres: { em },
  redis: {
    setex: async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return "OK";
    },
  },
}));

const REAL_POWERUPS = "../../services/alliance/powerups.ts?real";
const realPowerups = (await import(REAL_POWERUPS)) as typeof import("../../services/alliance/powerups.js");
let standIn = true;
afterAll(() => {
  standIn = false;
});
mock.module("../../services/alliance/powerups.js", () => ({
  ...realPowerups,
  isDeclareWarRunning: async (allianceId: number | null) =>
    standIn ? declareWar : realPowerups.isDeclareWarRunning(allianceId),
  runningPowerups: async (allianceId: number | null) => (standIn ? [] : realPowerups.runningPowerups(allianceId)),
}));

const { infernoAttackStart } = await import("./descentAttack.js");
const { readInfernoMap } = await import("./infernoMap.js");
const { infernoTribeSessionKey } = await import("../../services/inferno/infernoTribeSession.js");
const { parseDescentSession } = await import("../../services/inferno/descentSession.js");
const { infernoStartBuildingData } = await import("../../services/inferno/infernoYard.js");
const { infernoYardLevel } = await import("../../services/inferno/infernoTribes.js");
const { BaseType } = await import("../../enums/Base.js");
const getCurrentDateTime = await import("../../utils/getCurrentDateTime.js");

const user = () => ({ userid: ATTACKER, alliance_id: null, username: "tester" }) as never;

const contextFor = (body: unknown) =>
  ({ authUser: user(), request: { body } }) as unknown as Context & { body: any };

const start = async (body: unknown) => {
  const ctx = contextFor(body);
  await infernoAttackStart(ctx, async () => {});
  return ctx.body;
};

/** The refusal `reason` the route answered with, or "none". */
const refusalOf = async (body: unknown): Promise<string> => {
  try {
    await start(body);
    return "none";
  } catch (err) {
    return (err as { data?: { reason?: string } }).data?.reason ?? String(err);
  }
};

const infernoYard = (bunkerLevel: number, housed: Record<string, number>) => ({
  baseid: INFERNO_BASEID,
  basesaveid: 60,
  type: BaseType.INFERNO,
  userid: ATTACKER,
  saveuserid: ATTACKER,
  attackid: 0,
  points: "0",
  basevalue: "0",
  buildingdata: {
    ...infernoStartBuildingData(),
    "50": { t: 128, id: 50, l: bunkerLevel, X: 200, Y: 200 },
  },
  buildinghealthdata: {},
  academy: { IC1: { level: 3 } },
  monsters: { housed },
  storedata: {},
  resources: {},
});

const saved = process.env.INFERNO_ENABLED;

beforeEach(() => {
  process.env.INFERNO_ENABLED = "on";
  userSave = {
    baseid: MAIN_BASEID,
    basesaveid: 9,
    baseid_inferno: INFERNO_BASEID,
    points: "0",
    basevalue: "0",
    buildingdata: {},
    academy: {},
    champion: [{ t: 1, l: 3 }],
    storedata: {},
    iresources: { r1: 100, r2: 0, r3: 0, r4: 0 },
  };
  inferno = infernoYard(4, { IC1: 30, IC2: 5 });
  maproom = null;
  persisted.length = 0;
  flushes = 0;
  store.clear();
  declareWar = false;
});

afterEach(() => {
  if (saved === undefined) delete process.env.INFERNO_ENABLED;
  else process.env.INFERNO_ENABLED = saved;
});

describe("the Inferno map", () => {
  test("lists the seven tribes the Inferno yard's level faces, and makes the row", async () => {
    const level = infernoYardLevel(inferno as never);
    const body = await readInfernoMap(em as never, user(), NOW);
    expect(body.level).toBe(level);
    expect(level).toBeLessThanOrEqual(10);
    expect(body.tribes.map((tribe) => tribe.baseid)).toEqual(["214", "215", "216", "217", "218", "219", "220"]);
    expect(body.tribes[6]).toEqual({ baseid: "220", level: level + 3, destroyed: 0, respawnat: 0, damage: 0 });
    expect(maproom).not.toBeNull();
    expect(flushes).toBe(1);
  });

  test("a tribe wrecked under an hour ago shows when it is back; one past the hour is stood up", async () => {
    maproom = {
      userid: ATTACKER,
      tribedata: [
        { baseid: "215", tribeHealthData: { "0": 0 }, destroyed: 1, destroyedAt: NOW - 600, damage: 70 },
        { baseid: "216", tribeHealthData: { "0": 0 }, destroyed: 1, destroyedAt: NOW - 3_600, damage: 90, looted: { r1: 5 } },
        // Another tier's: dropped.
        { baseid: "225", tribeHealthData: {}, destroyed: 0 },
      ],
    };
    const body = await readInfernoMap(em as never, user(), NOW);
    expect(body.tribes[1]).toMatchObject({ baseid: "215", destroyed: 1, respawnat: NOW + 3_000, damage: 70 });
    expect(body.tribes[2]).toMatchObject({ baseid: "216", destroyed: 0, respawnat: 0, damage: 0 });
    const kept = (maproom!.tribedata as { baseid: string; looted?: unknown }[]).map((tribe) => tribe.baseid);
    expect(kept).toEqual(["215", "216"]);
  });

  test("409 noInfernoYard without an Inferno yard", async () => {
    userSave.baseid_inferno = 0;
    await expect(readInfernoMap(em as never, user(), NOW)).rejects.toMatchObject({ data: { reason: "noInfernoYard" } });
  });
});

describe("starting a tribe attack", () => {
  test("refused for a base that is not a Moloch tribe, or one of another tier", async () => {
    expect(await refusalOf({ kind: "tribe", baseid: "213" })).toBe("notInfernoTribe");
    expect(await refusalOf({ kind: "tribe", baseid: "221" })).toBe("notYourTribe");
    expect(store.size).toBe(0);
  });

  test("refused without an Inferno yard", async () => {
    userSave.baseid_inferno = 0;
    expect(await refusalOf({ kind: "tribe", baseid: "214" })).toBe("noInfernoYard");
  });

  test("refused while the tribe lies wrecked, with when it is back", async () => {
    const now = getCurrentDateTime.getCurrentDateTime();
    maproom = { userid: ATTACKER, tribedata: [{ baseid: "214", tribeHealthData: {}, destroyed: 1, destroyedAt: now - 60 }] };
    try {
      await start({ kind: "tribe", baseid: "214" });
      throw new Error("started");
    } catch (err) {
      expect((err as { data?: unknown }).data).toEqual({ reason: "tribeDestroyed", respawnAt: now - 60 + 3_600 });
    }
    expect(store.size).toBe(0);
  });

  test("refused with no monsters in the Housing Bunkers", async () => {
    inferno = infernoYard(4, { IC1: 0 });
    expect(await refusalOf({ kind: "tribe", baseid: "214" })).toBe("noMonsters");
    expect(store.size).toBe(0);
  });

  test("starts with the Inferno army only, a level 4 bunker's 780 per fling", async () => {
    const body = await start({ kind: "tribe", baseid: "217" });
    expect(body).toMatchObject({
      error: 0,
      kind: "tribe",
      yardkind: "inferno",
      armybaseid: INFERNO_BASEID,
      army: { IC1: 30, IC2: 5 },
      flingercapacity: 780,
      attackeracademy: { IC1: 3 },
    });
    expect(body.base.baseid).toBe("217");

    const session = parseDescentSession(store.get(infernoTribeSessionKey(ATTACKER)));
    expect(session?.baseid).toBe("217");
    expect(session?.flingerCapacity).toBe(780);
    expect(session?.session.attackid).toBe(body.attackid);
    // The Inferno yard's army, not the main yard's; no champion brains.
    expect(session?.session.entryHoused).toEqual({ [INFERNO_BASEID]: { IC1: 30, IC2: 5 } });
    expect(session?.session.championBrains).toBeUndefined();
    expect(session?.session.attackerAcademy).toEqual({ IC1: 3 });
    // The tribe's housed monsters defend from its Housing Bunkers.
    expect(Object.keys(body.defenderforces.bunkers).length).toBeGreaterThan(0);
  });

  test("Declare War adds a quarter to the load", async () => {
    declareWar = true;
    const body = await start({ kind: "tribe", baseid: "214" });
    expect(body.flingercapacity).toBe(975);
  });

  test("the tribe keeps the health earlier attacks left it", async () => {
    maproom = { userid: ATTACKER, tribedata: [{ baseid: "214", tribeHealthData: { "1": 50 }, destroyed: 0, damage: 20 }] };
    const body = await start({ kind: "tribe", baseid: "214" });
    expect(body.base.buildinghealthdata).toEqual({ "1": 50 });
  });
});
