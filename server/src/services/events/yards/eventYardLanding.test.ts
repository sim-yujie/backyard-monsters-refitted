import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

import type { AbandonedOutcome } from "../../base/combat/abandonedAttack.js";

/**
 * The Brukkarg event yard landing (beta 10, `eventYardLanding.ts`), through
 * `/base/save`: bound to the attack the load minted, the server's battle
 * landed once; the yard is beaten when its Town Hall falls or the attack
 * wrecks it to 90%; the prize for that many yards is paid in the landing,
 * once; a resent save is refused. The yard store is in memory here
 * (`yardStore.db.test.ts` covers the SQL).
 */

const ATTACKER = 4401;
const MAIN_BASEID = "7000";
const ATTACK_ID = 7171;
const RUN_START = Math.floor(Date.now() / 1000) - 600;

const store = new Map<string, string>();
const sets = new Map<string, Set<string>>();
let userSave: Record<string, any>;
let transactions = 0;

const em = {
  populate: async (user: Record<string, unknown>) => {
    user.save = userSave;
  },
  findOne: async () => null,
  persist: () => {},
  flush: async () => {},
  transactional: async (run: (tx: unknown) => Promise<unknown>) => {
    transactions += 1;
    return run(em);
  },
};

mock.module("../../../server.js", () => ({
  postgres: { em, orm: { em: {} } },
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
      const set = sets.get(key) ?? new Set<string>();
      sets.set(key, set);
      set.add(member);
      return 1;
    },
    srem: async (key: string, member: string) => (sets.get(key)?.delete(member) ? 1 : 0),
    smembers: async (key: string) => [...(sets.get(key) ?? [])],
  },
}));

mock.module("../../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

mock.module("../../base/reportManager.js", () => ({
  logReport: async () => {},
  logAttackViolation: async () => {},
  logBanReport: async () => {},
}));

// The real replay runner unless a test cans the battle (Bun keeps module mocks across files).
const REAL_RUNNER = "../../base/combat/replayRunner.ts?real";
const realRunner = (await import(REAL_RUNNER)) as typeof import("../../base/combat/replayRunner.js");
let canned: Partial<AbandonedOutcome> | null = null;
mock.module("../../base/combat/replayRunner.js", () => ({
  ...realRunner,
  replayAbandonedInWorker: async (...args: Parameters<typeof realRunner.replayAbandonedInWorker>) =>
    canned ? outcome(canned) : realRunner.replayAbandonedInWorker(...args),
}));

// The yard store in memory; its pure rules (repair, landed state) stay real.
const REAL_STORE = "./yardStore.ts?real";
const realStore = (await import(REAL_STORE)) as typeof import("./yardStore.js");
const yards = new Map<string, import("./yardStore.js").YardState>();
const prizes = new Set<number>();
mock.module("./yardStore.js", () => ({
  ...realStore,
  readYardStates: async () => new Map(yards),
  readYardState: async (_em: unknown, _userid: number, _run: string, baseid: string) => yards.get(baseid) ?? null,
  writeYardState: async (_em: unknown, _userid: number, _run: string, baseid: string, state: import("./yardStore.js").YardState) => {
    yards.set(baseid, state);
  },
  readYardCopy: async () => null,
  markPrizePaid: async (_em: unknown, _userid: number, _run: string, count: number) => {
    if (prizes.has(count)) return false;
    prizes.add(count);
    return true;
  },
}));

const { baseSave } = await import("../../../controllers/base/save/baseSave.js");
const { combatConfig } = await import("../../../config/CombatConfig.js");
const MODE = combatConfig.mode;
const { serialiseAttackSession } = await import("../../base/attackSession.js");
const { eventYardSessionKey } = await import("./eventYardSession.js");
const { setYardEventRuns } = await import("./yardEventRun.js");
const { memoryCoinStore, useCoinStore } = await import("../eventCoins.js");
const { EVENT_YARDS_MAP } = await import("../../../game-data/tribes/events/index.js");
const { CARNAGE_GLIMMERS } = await import("../../../game-data/events/yardEvents.js");

const outcome = (part: Partial<AbandonedOutcome>): AbandonedOutcome => ({
  tick: 2_400,
  buildinghealthdata: {},
  damage: 0,
  destroyed: 0,
  firedTraps: [],
  attackloot: { r1: 0, r2: 0, r3: 0, r4: 0 },
  defenderDelta: { r1: 0, r2: 0, r3: 0, r4: 0 },
  flung: { C1: 5 },
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

const startSession = (baseid: string) =>
  store.set(
    eventYardSessionKey(ATTACKER, baseid),
    serialiseAttackSession({
      attackerid: ATTACKER,
      attackid: ATTACK_ID,
      startedat: now(),
      entryHoused: { [MAIN_BASEID]: { C1: 20 } },
      defenderForces: { bunkers: {}, defenderLevels: {}, defenderChampions: [] } as never,
      attackerAcademy: {},
    })
  );

const FLINGS = { v: 1, seed: 3, events: [{ kind: "fling", t: 40, x: 500, y: 0, r: 100, monsters: { C1: 5 } }] };

const finalSave = (baseid: string) =>
  ({
    authUser: { userid: ATTACKER, username: "raider" },
    request: {
      body: {
        baseid,
        basesaveid: "0",
        over: "1",
        attackid: String(ATTACK_ID),
        tick: "2400",
        flinglog: JSON.stringify(FLINGS),
        monsterupdate: JSON.stringify([{ baseid: MAIN_BASEID, m: { housed: { C1: 15 } } }]),
      },
    },
    ip: "127.0.0.1",
    path: "/base/save",
  }) as unknown as Context & { body: { eventyard?: Record<string, any> } };

const run = async (ctx: Context): Promise<{ data?: { reason?: string } } | null> => {
  try {
    await baseSave(ctx, async () => {});
    return null;
  } catch (caught) {
    return caught as { data?: { reason?: string } };
  }
};

const hallOf = (baseid: string): string =>
  String(Object.values(EVENT_YARDS_MAP.get(baseid)!.buildingdata as Record<string, { t: number; id: number }>).find((b) => b.t === 14)!.id);

let coins: ReturnType<typeof memoryCoinStore>;
let previousCoins: ReturnType<typeof useCoinStore>;

beforeEach(() => {
  (combatConfig as { mode: typeof MODE }).mode = "log";
  canned = null;
  store.clear();
  yards.clear();
  prizes.clear();
  transactions = 0;
  coins = memoryCoinStore();
  previousCoins = useCoinStore(coins);
  setYardEventRuns([{ event: "carnage", startsAt: RUN_START, endsAt: RUN_START + 7 * 86_400 }]);
  userSave = {
    userid: ATTACKER,
    baseid: MAIN_BASEID,
    basesaveid: 11,
    resources: { r1: 0, r2: 0, r3: 0, r4: 0, r1max: 1_000_000, r2max: 1_000_000, r3max: 1_000_000, r4max: 1_000_000 },
    savetime: now(),
    buildingdata: {},
    storedata: {},
    academy: {},
    champion: [],
    rewards: {},
    researchdata: {},
    monsters: { housed: { C1: 20 } },
  };
});

afterEach(() => {
  canned = null;
  useCoinStore(previousCoins);
  setYardEventRuns([]);
  (combatConfig as { mode: typeof MODE }).mode = MODE;
});

describe("an event yard's landing", () => {
  test("the Town Hall falls below 90%: the yard is beaten, its Glimmers paid once, the session ended", async () => {
    startSession("906");
    canned = { buildinghealthdata: { [hallOf("906")]: 0 }, damage: 40 };
    const ctx = finalSave("906");
    expect(await run(ctx)).toBeNull();
    expect(ctx.body.eventyard).toMatchObject({ event: "carnage", won: true, beaten: 1, prizes: [{ yards: 1, glimmers: CARNAGE_GLIMMERS[0] }] });
    expect(yards.get("906")).toMatchObject({ destroyed: true });
    expect(coins.balances.get(ATTACKER)).toBe(CARNAGE_GLIMMERS[0]);
    expect(transactions).toBe(1);
    expect(store.has(eventYardSessionKey(ATTACKER, "906"))).toBe(false);

    // The same save again: the attack is over, nothing lands twice.
    expect((await run(finalSave("906")))?.data?.reason).toBeDefined();
    expect(coins.balances.get(ATTACKER)).toBe(CARNAGE_GLIMMERS[0]);
    expect(transactions).toBe(1);
  });

  test("90% wrecked with the Town Hall standing is a win too (the end panel's Victory)", async () => {
    startSession("906");
    canned = { buildinghealthdata: { "28": 0 }, damage: 92 };
    const ctx = finalSave("906");
    expect(await run(ctx)).toBeNull();
    expect(ctx.body.eventyard).toMatchObject({ won: true, beaten: 1 });
  });

  test("short of both: the yard keeps its damage for a day, no prize", async () => {
    startSession("906");
    canned = { buildinghealthdata: { "28": 0 }, damage: 30 };
    const ctx = finalSave("906");
    expect(await run(ctx)).toBeNull();
    expect(ctx.body.eventyard).toMatchObject({ won: false, beaten: 0, prizes: [] });
    expect(yards.get("906")).toMatchObject({ destroyed: false, damage: 30, health: { "28": 0 } });
    expect(coins.balances.get(ATTACKER) ?? 0).toBe(0);
  });

  test("a prize already paid this run is not paid again", async () => {
    prizes.add(1);
    startSession("906");
    canned = { buildinghealthdata: { [hallOf("906")]: 0 }, damage: 50 };
    const ctx = finalSave("906");
    expect(await run(ctx)).toBeNull();
    expect(ctx.body.eventyard).toMatchObject({ won: true, prizes: [] });
    expect(coins.balances.get(ATTACKER) ?? 0).toBe(0);
  });

  test("the client's destroyed figure is the camp threshold's, so reject mode takes an honest save", async () => {
    (combatConfig as { mode: typeof MODE }).mode = "reject";
    startSession("906");
    canned = { buildinghealthdata: { [hallOf("906")]: 0 }, damage: 95 };
    const ctx = finalSave("906");
    (ctx.request.body as Record<string, string>).destroyed = "1";
    (ctx.request.body as Record<string, string>).damage = "95";
    (ctx.request.body as Record<string, string>).buildinghealthdata = JSON.stringify({ [hallOf("906")]: 0 });
    expect(await run(ctx)).toBeNull();
    expect(ctx.body.eventyard).toMatchObject({ won: true });
  });

  test("a save with no attack behind it is refused and writes nothing", async () => {
    expect((await run(finalSave("906")))?.data?.reason).toBeDefined();
    expect(transactions).toBe(0);
    expect(yards.size).toBe(0);
  });
});
