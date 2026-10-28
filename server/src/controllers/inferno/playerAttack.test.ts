import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * Starting an attack on another player's Inferno yard (WP 3.2,
 * `docs/design/inferno.md` §2.7, §3.2): refused before anything is written
 * for a yard that is not another real player's live one, protected, being
 * attacked, out of range without revenge, or whose owner is playing; else the
 * Inferno yard's Housing Bunker army against the defender's yard, its housed
 * monsters in its Housing Bunkers and its owner's Inferno purse as the loot.
 */

const ATTACKER = 3301;
const DEFENDER = 4401;
const MAIN_BASEID = "5000";
const INFERNO_BASEID = "6000";
const TARGET_BASEID = "7000";

let userSave: Record<string, unknown>;
let inferno: Record<string, unknown>;
let target: Record<string, unknown>;
let defenderMain: Record<string, unknown> | null;
let maproom: Record<string, unknown> | null;
let botRow: Record<string, unknown> | null;
let onlineNow: boolean;
const store = new Map<string, string>();
const nativeUpdates: unknown[] = [];

const em = {
  populate: async (user: Record<string, unknown>) => {
    user.save = userSave;
  },
  findOne: async (entity: { name: string }, where: Record<string, unknown>) => {
    if (entity.name === "InfernoMaproom") return maproom;
    if (entity.name === "Bot") return botRow;
    if (entity.name === "User") return { userid: DEFENDER, username: "defender" };
    if (where.basesaveid === userSave.basesaveid) return userSave;
    if (where.basesaveid === target.basesaveid) return target;
    if (where.type === "main") return where.userid === DEFENDER ? defenderMain : null;
    if (String(where.baseid) === INFERNO_BASEID) return inferno;
    if (String(where.baseid) === TARGET_BASEID) return target;
    return null;
  },
  create: (entity: new () => object, data: object) => Object.assign(new entity(), data),
  persist: () => {},
  flush: async () => {},
  nativeUpdate: async (_entity: unknown, where: unknown, data: unknown) => {
    nativeUpdates.push({ where, data });
    return 1;
  },
  transactional: async (run: (tx: unknown) => Promise<unknown>) => run(em),
  getContext: () => ({ global: true, findOne: em.findOne }),
};

mock.module("../../server.js", () => ({
  postgres: { em },
  redis: {
    setex: async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return "OK";
    },
    set: async (key: string, value: string, ...options: string[]) => {
      if (options.includes("NX") && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    // A stored key, else `isPlayerOnline`'s presence mark and a real action now, or nothing.
    get: async (key: string) =>
      store.get(key) ?? (onlineNow && !key.startsWith("presence-challenge") ? String(Date.now() / 1000) : null),
    del: async (key: string) => (store.delete(key) ? 1 : 0),
    // The open player attacks (`INFERNO_PLAYER_ATTACKS`): none to close here.
    sadd: async () => 1,
    srem: async () => 1,
    smembers: async () => [],
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
  isDeclareWarRunning: async (allianceId: number | null) => (standIn ? false : realPowerups.isDeclareWarRunning(allianceId)),
  runningPowerups: async (allianceId: number | null) => (standIn ? [] : realPowerups.runningPowerups(allianceId)),
}));

const { infernoAttackStart } = await import("./descentAttack.js");
const { infernoPlayerFinalLockKey, infernoPlayerSessionKey } = await import("../../services/inferno/infernoPlayerSession.js");
const { serialiseAttackSession } = await import("../../services/base/attackSession.js");
const { parseDescentSession } = await import("../../services/inferno/descentSession.js");
const { infernoStartBuildingData } = await import("../../services/inferno/infernoYard.js");
const { experiencePoints } = await import("../../game-data/stats/experiencePoints.js");
const { BaseType } = await import("../../enums/Base.js");
const { getCurrentDateTime } = await import("../../utils/getCurrentDateTime.js");

const user = () => ({ userid: ATTACKER, alliance_id: null, username: "attacker", pic_square: "" }) as never;

const start = async (body: unknown) => {
  const ctx = { authUser: user(), request: { body } } as unknown as Context & { body: any };
  await infernoAttackStart(ctx, async () => {});
  return ctx.body;
};

/** The refusal's data, or "none". */
const refusalOf = async (baseid = TARGET_BASEID): Promise<unknown> => {
  try {
    await start({ kind: "player", baseid });
    return "none";
  } catch (err) {
    return (err as { data?: unknown }).data ?? String(err);
  }
};

/** Points that put a yard at least at `level`, with the start buildings' value on top. */
const pointsFor = (level: number) => String(experiencePoints[level - 1]);

const yardOf = (baseid: string, basesaveid: number, userid: number, extra: Record<string, unknown>) => ({
  baseid,
  basesaveid,
  type: BaseType.INFERNO,
  userid,
  saveuserid: userid,
  attackid: 0,
  attacks: [],
  protected: 0,
  points: "0",
  basevalue: "0",
  buildingdata: { ...infernoStartBuildingData(), "50": { t: 128, id: 50, l: 1, X: 200, Y: 200 } },
  buildinghealthdata: {},
  academy: {},
  storedata: {},
  resources: {},
  champion: [],
  ...extra,
});

const saved = process.env.INFERNO_ENABLED;

beforeEach(() => {
  process.env.INFERNO_ENABLED = "on";
  userSave = {
    baseid: MAIN_BASEID,
    basesaveid: 9,
    userid: ATTACKER,
    baseid_inferno: INFERNO_BASEID,
    points: "0",
    basevalue: "0",
    buildingdata: {},
    academy: {},
    storedata: {},
    iresources: {},
  };
  inferno = yardOf(INFERNO_BASEID, 60, ATTACKER, { monsters: { housed: { IC1: 10 } }, protected: 0 });
  target = yardOf(TARGET_BASEID, 70, DEFENDER, { monsters: { housed: { IC1: 6 } }, academy: { IC1: { level: 2 } } });
  defenderMain = { userid: DEFENDER, type: "main", baseid_inferno: Number(TARGET_BASEID), iresources: { r1: 5000, r2: 400, r3: 0, r4: 7 } };
  maproom = null;
  botRow = null;
  onlineNow = false;
  store.clear();
  nativeUpdates.length = 0;
});

afterEach(() => {
  if (saved === undefined) delete process.env.INFERNO_ENABLED;
  else process.env.INFERNO_ENABLED = saved;
});

describe("refusals, before anything is written", () => {
  test("not another real player's live Inferno yard", async () => {
    expect(await refusalOf(INFERNO_BASEID)).toEqual({ reason: "notInfernoPlayer" }); // own
    expect(await refusalOf("abc")).toEqual({ reason: "notInfernoPlayer" });
    expect(await refusalOf("8888")).toEqual({ reason: "notInfernoPlayer" }); // none
    defenderMain!.baseid_inferno = 9999; // not the yard its owner plays
    expect(await refusalOf()).toEqual({ reason: "notInfernoPlayer" });
    defenderMain!.baseid_inferno = Number(TARGET_BASEID);
    botRow = { userid: DEFENDER, state: "active" };
    expect(await refusalOf()).toEqual({ reason: "notInfernoPlayer" });
    expect(store.size).toBe(0);
    expect(target.attackid).toBe(0);
  });

  test("protected, with until when", async () => {
    const until = getCurrentDateTime() + 3600;
    target.protected = until;
    expect(await refusalOf()).toEqual({ reason: "protected", protectedUntil: until });
    expect(store.size).toBe(0);
  });

  test("being attacked, with by whom", async () => {
    target.attackid = 77;
    target.attacks = [{ name: "raider", starttime: getCurrentDateTime() - 30 }];
    expect(await refusalOf()).toEqual({ reason: "targetUnderAttack", attacker: "raider" });
  });

  test("out of range, unless they attacked first", async () => {
    inferno.points = pointsFor(20);
    expect(await refusalOf()).toEqual({ reason: "outOfRange" });
    maproom = { userid: ATTACKER, neighbors: [{ userid: DEFENDER, attacksfrom: 1, retaliatecount: 0 }] };
    expect(await refusalOf()).toBe("none");
  });

  test("the owner playing now", async () => {
    onlineNow = true;
    expect(await refusalOf()).toEqual({ reason: "ownerOnline" });
    expect(store.size).toBe(0);
  });

  test("nothing in the Housing Bunkers", async () => {
    inferno.monsters = { housed: {} };
    expect(await refusalOf()).toEqual({ reason: "noMonsters" });
    expect(target.attackid).toBe(0);
  });
});

describe("a started attack", () => {
  test("marks the yard attacked and keeps the Inferno army, the defence and the purse in the session", async () => {
    inferno.protected = getCurrentDateTime() + 600;
    const body = await start({ kind: "player", baseid: TARGET_BASEID });
    expect(body).toMatchObject({
      error: 0,
      kind: "player",
      yardkind: "inferno",
      ownername: "defender",
      armybaseid: INFERNO_BASEID,
      army: { IC1: 10 },
      flingercapacity: 200,
    });
    expect(body.attackid).toBe(target.attackid);
    expect((target.attacks as { name: string }[]).at(-1)!.name).toBe("attacker");
    // The loot is the defender's purse.
    expect(body.base.resources).toEqual({ r1: 5000, r2: 400, r3: 0, r4: 7 });
    // The defender's housed monsters defend from its Housing Bunker, at its academy.
    expect(body.defenderforces.bunkers[50]).toEqual({ IC1: 6 });

    const session = parseDescentSession(store.get(infernoPlayerSessionKey(70)));
    expect(session?.baseid).toBe(TARGET_BASEID);
    expect(session?.session.attackid).toBe(body.attackid);
    expect(session?.session.entryHoused).toEqual({ [INFERNO_BASEID]: { IC1: 10 } });
    expect(session?.session.defenderResources).toEqual({ r1: 5000, r2: 400, r3: 0, r4: 7 });

    // Attacking ends the attacker's Inferno protection.
    expect(nativeUpdates).toEqual([{ where: { basesaveid: 60 }, data: { protected: 0 } }]);
  });

  test("a second attack while the first runs is refused", async () => {
    await start({ kind: "player", baseid: TARGET_BASEID });
    expect(await refusalOf()).toEqual({ reason: "targetUnderAttack", attacker: "attacker" });
  });
});

describe("one attack per yard, failing closed", () => {
  /** An attack session another player left on the target, `age` seconds old. */
  const openSession = (age: number, attackid = 4242) => {
    const value = JSON.stringify({
      baseid: TARGET_BASEID,
      flingerCapacity: 200,
      session: serialiseAttackSession({ attackerid: 777, attackid, startedat: getCurrentDateTime() - age }),
    });
    store.set(infernoPlayerSessionKey(70), value);
    return value;
  };

  test("an expired attack that could not be closed keeps the yard attacked", async () => {
    target.attackid = 4242;
    target.attacks = [{ name: "first", starttime: getCurrentDateTime() - 600 }];
    const before = openSession(600);
    // The close cannot run (its final lock is held, and the stand-in has no ORM): it fails.
    store.set(infernoPlayerFinalLockKey(70), "1");
    expect(await refusalOf()).toEqual({ reason: "targetUnderAttack", attacker: "first" });
    expect(target.attackid).toBe(4242);
    expect(store.get(infernoPlayerSessionKey(70))).toBe(before);
  });

  test("an open session is never overwritten, even when the yard's mark says otherwise", async () => {
    // The row shows no attack (as after a lost write), but a session is open.
    const before = openSession(30);
    expect(await refusalOf()).toEqual({ reason: "targetUnderAttack", attacker: "" });
    expect(store.get(infernoPlayerSessionKey(70))).toBe(before);
  });

  test("of two starts at once only one gets the yard; the other is refused under the lock", async () => {
    // The second start finds the first's session minted between its checks and its lock.
    const realFindOne = em.findOne;
    let raced = false;
    em.findOne = async (entity: { name: string }, where: Record<string, unknown>) => {
      if (!raced && where.basesaveid === 70 && entity.name === "Save") {
        raced = true;
        openSession(1, 5151);
      }
      return realFindOne(entity, where);
    };
    try {
      expect(await refusalOf()).toEqual({ reason: "targetUnderAttack", attacker: "" });
    } finally {
      em.findOne = realFindOne;
    }
    expect(parseDescentSession(store.get(infernoPlayerSessionKey(70)))?.session.attackid).toBe(5151);
  });
});
