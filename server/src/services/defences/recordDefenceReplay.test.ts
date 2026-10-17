import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Recording a defence replay (issue #359, `docs/design/defence-replays.md` §5):
 * the attack load cut down to what the attack scene reads, which attacks are
 * recorded, the payload laid over the battle the server fought, and a stored
 * payload that fights the same battle again. The store runs for real against
 * a stand-in ORM that keeps what it is asked to insert; Redis is in memory.
 */

const SANDBOX = fileURLToPath(new URL("../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url));
const sandbox = JSON.parse(readFileSync(SANDBOX, "utf8"));

const DEFENDER = 1;
const ATTACKER = 2503;
const BASESAVEID = 77;
const ATTACK_ID = 4242;
const NOW = 1_800_000_000;

const store = new Map<string, string>();
// Bun keeps a module mock for the files that run after this one, so the
// stand-in carries the ORM handle every other importer of `server.js` expects.
mock.module("../../server.js", () => ({
  postgres: { em: {}, orm: { em: {} } },
  redis: {
    get: async (key: string) => store.get(key) ?? null,
    setex: async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return "OK";
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
  },
}));

const logged: { level: string; event?: string }[] = [];
const log = (level: string) => (_message: string, data?: { event?: string }) => {
  logged.push({ level, event: data?.event });
};
mock.module("../../utils/logger.js", () => ({
  logger: { warn: log("warn"), error: log("error"), info: log("info"), debug: log("debug") },
}));

const {
  DEFENCE_REPLAY_LOAD_FIELDS,
  defenceReplayLoadKey,
  defenceReplayLoadOf,
  discardDefenceReplayLoad,
  isDefenceReplayTarget,
  keepDefenceReplayLoad,
  readDefenceReplayLoad,
} = await import("./defenceReplayLoad.js");
const { defenceReplayInput, defenceReplayPayload, recordDefenceReplay, recordsDefenceReplay } = await import(
  "./recordDefenceReplay.js"
);
const { decodeReplay, encodeReplay } = await import("./defenceReplayStore.js");
const { replayAbandonedAttack } = await import("../base/combat/abandonedAttack.js");
const { battleDefence, replayAttack } = await import("../../game-rules/combat/index.js");
const { RULES_VERSION } = await import("./rulesVersion.js");

/** Rows the store inserted, and an ORM that keeps them. */
let inserted: Record<string, any>[] = [];
const em = {
  fork() {
    return this;
  },
  transactional: async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      insert: async (_entity: unknown, row: Record<string, any>) => {
        inserted.push(row);
        return inserted.length;
      },
      execute: async () => [],
    }),
} as never;

const LOG = {
  v: 1 as const,
  seed: 1834027731,
  events: [
    { kind: "fling" as const, t: 480, x: -615, y: 115, r: 300, monsters: { C1: 300 }, champion: { t: 5, l: 5 } },
    { kind: "bomb" as const, t: 800, x: 180, y: -480, id: "pb1" },
  ],
};
const DEFENCE = { bunkers: {}, defenderLevels: { C2: 4 }, defenderRanks: {}, defenderChampions: [] };

/** A battle as the server fights it: the sandbox yard, half damaged already. */
const input = (overrides: Record<string, unknown> = {}) => ({
  defender: {
    type: "main",
    buildingdata: sandbox.buildingdata,
    buildinghealthdata: { "0": 4000 },
    resources: { r1: 5_000_000, r2: 5_000_000, r3: 5_000_000, r4: 5_000_000 },
    height: 2,
  },
  attacker: {
    academy: { C1: { level: 3, powerup: 2 } },
    champion: [{ t: 5, l: 5, hp: 62000, ft: 1, fd: 3, fb: 0, pl: 0, status: 0, b: { aggro: 0.4 }, bs: { n: 3 } }],
    siege: null,
  },
  log: LOG,
  tick: 2400,
  declareWar: false,
  playerLevel: 40,
  left: true,
  defence: DEFENCE,
  ...overrides,
});

const yard = (overrides: Record<string, unknown> = {}) => ({
  basesaveid: BASESAVEID,
  baseid: "1000241208",
  saveuserid: DEFENDER,
  type: "main",
  mapversion: 2,
  ...overrides,
});

const SESSION = { attackid: ATTACK_ID, startedat: NOW - 90, entryHoused: { "1000239208": { C1: 300 } } };

const landed = (overrides: Record<string, unknown> = {}) => ({
  yard: yard(),
  attacker: { userid: ATTACKER, username: "yardtester", pic_square: "https://pic.invalid/a.png" },
  session: SESSION,
  input: input(),
  report: "yardtester attacked",
  damageBefore: 12,
  damageAfter: 47,
  defenderDelta: { r1: -1234.6, r2: 0, r3: -5, r4: 7 },
  housedLost: 3,
  now: NOW,
  ...overrides,
});

beforeEach(() => {
  store.clear();
  inserted = [];
  logged.length = 0;
});

describe("the attack load a replay keeps", () => {
  test("only what the attack scene reads, and of the store only the yard's expansion", () => {
    const load = defenceReplayLoadOf(sandbox);

    expect(Object.keys(load).sort()).toEqual(
      [...DEFENCE_REPLAY_LOAD_FIELDS.filter((field) => sandbox[field] !== undefined), "storedata"].sort(),
    );
    expect(load.storedata).toEqual({ ENL: sandbox.storedata.ENL });
    for (const secret of ["credits", "chattoken", "chatchannel", "quests", "aiattacks", "monsterbaiter", "inventory", "unreadmessages", "researchdata", "academy", "lockerdata", "powerups", "gifts", "frontpage"]) {
      expect(sandbox[secret]).toBeDefined();
      expect(load[secret]).toBeUndefined();
    }
  });

  test("never notifications, store items or credits, whatever the load serves", () => {
    const load = defenceReplayLoadOf({ ...sandbox, notifications: 3, storeitems: { BR11: {} }, completed: [], credits: 900 });
    expect(load).not.toHaveProperty("notifications");
    expect(load).not.toHaveProperty("storeitems");
    expect(load).not.toHaveProperty("completed");
    expect(load).not.toHaveProperty("credits");
  });

  test("kept for its attack until the landing forgets it", async () => {
    await keepDefenceReplayLoad(BASESAVEID, ATTACK_ID, { buildingdata: { "1": { t: 14 } } });

    expect(store.has(defenceReplayLoadKey(BASESAVEID))).toBe(true);
    expect(await readDefenceReplayLoad(BASESAVEID, ATTACK_ID)).toEqual({ buildingdata: { "1": { t: 14 } } });
    // Another attack's landing on the same yard does not take it.
    expect(await readDefenceReplayLoad(BASESAVEID, ATTACK_ID + 1)).toBeNull();

    await discardDefenceReplayLoad(BASESAVEID);
    expect(await readDefenceReplayLoad(BASESAVEID, ATTACK_ID)).toBeNull();
  });
});

describe("which attacks are recorded", () => {
  test("another account's Map Room 2 main yard, fought by the server", () => {
    expect(isDefenceReplayTarget(yard(), ATTACKER)).toBe(true);
    expect(recordsDefenceReplay(yard(), ATTACKER, SESSION)).toBe(true);
  });

  test.each([
    ["Map Room 1", { mapversion: 1 }],
    ["Map Room 3", { mapversion: 3 }],
    ["an outpost", { type: "outpost" }],
    ["a camp", { type: "tribe" }],
    ["Inferno", { type: "inferno" }],
    ["a yard with no owner", { saveuserid: 0 }],
  ])("not %s", (_name, overrides) => {
    expect(isDefenceReplayTarget(yard(overrides), ATTACKER)).toBe(false);
  });

  test("not the attacker's own yard, nor a battle the server did not fight", () => {
    expect(isDefenceReplayTarget(yard({ saveuserid: ATTACKER }), ATTACKER)).toBe(false);
    expect(recordsDefenceReplay(yard(), ATTACKER, { ...SESSION, entryHoused: undefined })).toBe(false);
    expect(recordsDefenceReplay(yard(), ATTACKER, null)).toBe(false);
  });
});

describe("recordDefenceReplay", () => {
  test("writes one row with every figure, and the payload over the battle the server fought", async () => {
    await keepDefenceReplayLoad(BASESAVEID, ATTACK_ID, defenceReplayLoadOf({ ...sandbox, buildinghealthdata: {}, cellheight: 0 }));

    expect(await recordDefenceReplay(em, landed() as never)).toBe(1);

    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(row).toMatchObject({
      defender_userid: DEFENDER,
      baseid: "1000241208",
      map_version: 2,
      attacker_userid: ATTACKER,
      attacker_username: "yardtester",
      attacker_pic_square: "https://pic.invalid/a.png",
      attacked_at: new Date((NOW - 90) * 1000),
      landed_at: new Date(NOW * 1000),
      damage_before: 12,
      damage_after: 47,
      loot: { r1: 1234, r2: 0, r3: 5, r4: 0 },
      housed_lost: 3,
      attacker_left: true,
      rules_version: RULES_VERSION,
    });
    expect(row.replay_bytes).toBe(row.replay.byteLength);

    const payload = decodeReplay(row.replay);
    // The yard is the battle's, not the load's.
    expect(payload.load.buildinghealthdata).toEqual({ "0": 4000 });
    expect(payload.load.cellheight).toBe(2);
    expect(payload.load.defenderforces).toEqual(DEFENCE);
    expect(payload.load.attackerlevel).toBe(40);
    expect(payload.load.basename).toBe(sandbox.basename);
    expect(payload.load.credits).toBeUndefined();
    expect(payload).toMatchObject({
      seed: LOG.seed,
      events: LOG.events,
      tick: 2400,
      levels: { C1: 3 },
      ranks: { C1: 2 },
      siege: null,
      declareWar: false,
      report: "yardtester attacked",
    });
    // The champion as fought, without its learned brain.
    expect(payload.champion).toEqual([{ t: 5, l: 5, hp: 62000, pl: 0, fb: 0, status: 0 }]);
  });

  test("a save's own landing says the attacker stayed unless its log says they left", async () => {
    await recordDefenceReplay(em, landed({ input: input({ left: undefined }) }) as never);
    expect(inserted[0]!.attacker_left).toBe(false);
  });

  test("with the kept load lost, the row is still written, with no replay", async () => {
    expect(await recordDefenceReplay(em, landed() as never)).toBe(1);

    expect(inserted[0]).toMatchObject({ replay: null, replay_bytes: 0, damage_after: 47 });
    expect(logged).toContainEqual({ level: "warn", event: "defence-replay-no-load" });
  });

  test("an attack it does not record writes nothing", async () => {
    for (const other of [yard({ mapversion: 1 }), yard({ type: "outpost" }), yard({ saveuserid: ATTACKER })]) {
      expect(await recordDefenceReplay(em, landed({ yard: other }) as never)).toBeNull();
    }
    expect(await recordDefenceReplay(em, landed({ session: { ...SESSION, entryHoused: undefined } }) as never)).toBeNull();
    expect(inserted).toEqual([]);
  });

  test("never throws into the landing: a failed write is logged and gives no id", async () => {
    const broken = { fork: () => ({ transactional: async () => Promise.reject(new Error("database gone")) }) } as never;

    expect(await recordDefenceReplay(broken, landed() as never)).toBeNull();
    expect(logged).toContainEqual({ level: "error", event: "defence-replay-failed" });
  });
});

describe("a stored payload fights the battle that landed", () => {
  const stored = () => {
    const fought = input();
    // Through the store's own gzip, as it is kept and served.
    const payload = decodeReplay(encodeReplay(defenceReplayPayload(defenceReplayLoadOf(sandbox), fought as never, "report")));
    return { fought, payload };
  };

  test("the server's replay of it reaches the same damage, health and loot", () => {
    const { fought, payload } = stored();
    const original = replayAbandonedAttack(fought as never);
    const again = replayAbandonedAttack(defenceReplayInput(payload));

    expect(original.damage).toBeGreaterThan(0);
    expect(again.damage).toBe(original.damage);
    expect(again.buildinghealthdata).toEqual(original.buildinghealthdata);
    expect(again.defenderDelta).toEqual(original.defenderDelta);
    expect(again.attackloot).toEqual(original.attackloot);
    expect(again.firedTraps).toEqual(original.firedTraps);
  });

  test("so does the shared engine's replayAttack, to the stored tick", () => {
    const { fought, payload } = stored();
    const original = replayAbandonedAttack(fought as never);
    const load = payload.load;
    const last = Math.max(...payload.events.map((event) => Math.floor(event.t)));

    const replayed = replayAttack({
      buildingdata: load.buildingdata,
      buildinghealthdata: load.buildinghealthdata,
      resources: load.resources,
      kind: "main",
      height: load.cellheight,
      log: { v: 1, seed: payload.seed, events: payload.events },
      levels: payload.levels as Record<string, number>,
      ranks: payload.ranks as Record<string, number>,
      playerLevel: load.attackerlevel,
      declareWar: payload.declareWar,
      ...battleDefence(load.defenderforces),
      tailTicks: payload.tick - last,
    });

    expect(replayed.health).toEqual(original.buildinghealthdata);
    expect(replayed.damage).toBeCloseTo(original.damage, 2);
  });
});
