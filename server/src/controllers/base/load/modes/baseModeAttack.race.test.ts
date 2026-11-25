import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Save } from "../../../../database/models/save.model.js";
import { Truce } from "../../../../database/models/truce.model.js";
import { User } from "../../../../database/models/user.model.js";
import { WorldMapCell } from "../../../../database/models/worldmapcell.model.js";
import type { AttackSession } from "../../../../services/base/attackSession.js";
import { matchesWhere } from "../../../../testing/matchesWhere.js";

/**
 * Two players starting an attack on the same yard at the same moment (patch
 * 8.7, owner's pick "Claim in one step", 25 Nov 2026). Both used to read the
 * yard with a plain `findOne`, both found it free and unprotected, and both
 * went on to fight it. Now the yard is claimed with one conditional UPDATE
 * that only succeeds while nobody else has claimed it since it was read and
 * its protection is over: one wins, the other gets the usual "under attack"
 * answer. Drives `baseModeAttack` over the in-memory stand-in of
 * `baseModeAttack.online.test.ts`, with both attacks held at the range check
 * until both have passed every read check, which is the race.
 */

const ALICE = 2505;
const CAROL = 2507;
const OWNER = 77;
const ALICE_BASEID = "2000241207";
const CAROL_BASEID = "2000243207";
const MAIN_BASEID = "2000245210";
const MAIN_ROW = 700;

type Row = Record<string, unknown>;

const now = () => Math.floor(Date.now() / 1000);

let tables: Map<unknown, Row[]>;
/** When set, every attack waits at the range check until this many have arrived. */
let rangeBarrier: { size: number; arrived: number; open: () => void; opened: Promise<void> } | null;
/** Run once every attack held at the barrier has arrived, before any goes on. */
let atBarrier: (() => void) | null;
const store = new Map<string, string>();
const sessions = new Map<number, AttackSession>();
const sessionsStarted: number[] = [];

interface StandIn {
  findOne: (entity: unknown, where: Row) => Promise<Row | null>;
  find: (entity: unknown, where: Row) => Promise<Row[]>;
  transactional: (run: (tx: StandIn) => Promise<unknown>) => Promise<unknown>;
  create: (entity: unknown, data: Row) => Row;
  persist: () => void;
  nativeUpdate: (entity: unknown, where: Row, data: Row) => Promise<number>;
  flush: () => Promise<void>;
}

const em: StandIn = {
  findOne: async (entity, where) => (tables.get(entity) ?? []).find((row) => matchesWhere(row, where)) ?? null,
  find: async (entity, where) => (tables.get(entity) ?? []).filter((row) => matchesWhere(row, where)),
  transactional: async (run) => run(em),
  create: (_entity, data) => data,
  persist: () => {},
  // One statement: the rows that match are changed before anything else runs.
  nativeUpdate: async (entity, where, data) => {
    const hit = (tables.get(entity) ?? []).filter((row) => matchesWhere(row, where));
    for (const row of hit) Object.assign(row, structuredClone(data));
    return hit.length;
  },
  flush: async () => {},
};

mock.module("../../../../server.js", () => ({
  postgres: { em },
  redis: {
    get: async (key: string) => store.get(key) ?? null,
    setex: async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return "OK";
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
  },
}));

mock.module("../../../../services/maproom/v2/validateRange.js", () => ({
  validateRange: async () => {
    if (rangeBarrier) {
      rangeBarrier.arrived += 1;
      if (rangeBarrier.arrived >= rangeBarrier.size) {
        atBarrier?.();
        rangeBarrier.open();
      }
      await rangeBarrier.opened;
    }
  },
  rangeCheckV2: async () => ({ cell: null, verdict: { ok: true, via: "main" } }),
}));

mock.module("../../../../services/base/attackSessionStore.js", () => ({
  startAttackSession: async (basesaveid: number, session: AttackSession) => {
    sessionsStarted.push(session.attackerid);
    sessions.set(basesaveid, session);
  },
  readAttackSession: async (basesaveid: number) => sessions.get(basesaveid) ?? null,
  endAttackSession: async () => {},
}));

const { baseModeAttack } = await import("./baseModeAttack.js");

const yardRow = (basesaveid: number, userid: number, baseid: string): Row => ({
  basesaveid,
  baseid,
  userid,
  saveuserid: userid,
  type: "main",
  mapversion: 2,
  mr2upgraded: 1,
  worldid: "world-a",
  attackid: 0,
  attacks: [],
  protected: 0,
  savetime: now() - 10,
  credits: 0,
  points: "0",
  flinger: 0,
  catapult: 0,
  resources: { r1: 1_000, r2: 1_000, r3: 1_000, r4: 1_000 },
  buildingdata: {
    "0": { id: 0, t: 14, X: 0, Y: 0, l: 10 },
    "1": { id: 1, t: 11, X: 200, Y: 200, l: 2 },
  },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: {},
  academy: {},
  champion: [],
  mushrooms: { l: [], s: now() },
  researchdata: {},
  outposts: [],
});

const saveOf = (baseid: string) => tables.get(Save)!.find((row) => row.baseid === baseid)!;

const holdBoth = () => {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  rangeBarrier = { size: 2, arrived: 0, open, opened };
};

beforeEach(() => {
  store.clear();
  sessions.clear();
  sessionsStarted.length = 0;
  rangeBarrier = null;
  atBarrier = null;
  tables = new Map<unknown, Row[]>([
    [
      Save,
      [yardRow(2526, ALICE, ALICE_BASEID), yardRow(2527, CAROL, CAROL_BASEID), yardRow(MAIN_ROW, OWNER, MAIN_BASEID)],
    ],
    [
      WorldMapCell,
      [
        { baseid: ALICE_BASEID, map_version: 2, x: 241, y: 207, terrainHeight: 125 },
        { baseid: CAROL_BASEID, map_version: 2, x: 243, y: 207, terrainHeight: 125 },
        { baseid: MAIN_BASEID, map_version: 2, x: 245, y: 210, terrainHeight: 125 },
      ],
    ],
    [
      User,
      [
        { userid: ALICE, username: "alice" },
        { userid: CAROL, username: "carol" },
        { userid: OWNER, username: "bob" },
      ],
    ],
    [Truce, []],
  ]);
});

/* mock.module stays registered for later files in a plain `bun test`: leave the range check open. */
afterAll(() => {
  rangeBarrier = null;
  atBarrier = null;
});

const attack = (from: number) => {
  const own = tables.get(Save)!.find((row) => row.saveuserid === from && row.type === "main")!;
  const user = { userid: from, username: from === ALICE ? "alice" : "carol", save: own } as unknown as User;
  return baseModeAttack({ user, baseid: MAIN_BASEID, mapversion: 2, attackerLevel: 40 });
};

const UNDER_ATTACK = "This base is currently under attack by another player. Please try again later.";

describe("two attacks on the same yard at the same moment (patch 8.7)", () => {
  test("only one claims the yard; the other is told it is under attack", async () => {
    holdBoth();

    const results = await Promise.allSettled([attack(ALICE), attack(CAROL)]);

    const won = results.filter((result) => result.status === "fulfilled");
    const lost = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason).toMatchObject({ message: UNDER_ATTACK });
    // One attack on the yard, one session, and the yard names the winner's attack.
    const yard = saveOf(MAIN_BASEID);
    expect(yard.attacks as unknown[]).toHaveLength(1);
    expect(sessionsStarted).toHaveLength(1);
    expect(sessions.get(MAIN_ROW)?.attackid).toBe(yard.attackid as number);
    const winner = sessionsStarted[0];
    expect((yard.attacks as { name: string }[])[0].name).toBe(winner === ALICE ? "alice" : "carol");
  });

  test("the claim marks the yard under attack in the same step: a third attacker after it is refused", async () => {
    await attack(ALICE);
    await expect(attack(CAROL)).rejects.toMatchObject({ message: UNDER_ATTACK });
    expect(saveOf(MAIN_BASEID).attacks as unknown[]).toHaveLength(1);
    expect(sessionsStarted).toEqual([ALICE]);
  });

  test("protection that starts between the check and the claim refuses the attack, and nothing is written", async () => {
    holdBoth();
    // Both have read the yard unprotected; it gains protection before either claims.
    atBarrier = () => {
      saveOf(MAIN_BASEID).protected = now() + 3600;
    };

    const results = await Promise.allSettled([attack(ALICE), attack(CAROL)]);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(saveOf(MAIN_BASEID)).toMatchObject({ attackid: 0, attacks: [] });
    expect(sessionsStarted).toHaveLength(0);
  });

  test("a yard left with a stale attack id (an attacker who disconnected) is still claimed", async () => {
    const yard = saveOf(MAIN_BASEID);
    yard.attackid = 4242;
    yard.attacks = [{ name: "dave", starttime: now() - 3 * 3600, count: 1 }];

    const { save } = await attack(ALICE);

    expect(save.attackid).toBeGreaterThan(0);
    expect(save.attackid).not.toBe(4242);
    expect(sessionsStarted).toEqual([ALICE]);
  });
});
