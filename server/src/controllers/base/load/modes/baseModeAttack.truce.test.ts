import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Save } from "../../../../database/models/save.model.js";
import { Truce } from "../../../../database/models/truce.model.js";
import { User } from "../../../../database/models/user.model.js";
import { WorldMapCell } from "../../../../database/models/worldmapcell.model.js";
import type { AttackSession } from "../../../../services/base/attackSession.js";
import { matchesWhere } from "../../../../testing/matchesWhere.js";

/**
 * A truce blocks attacks both ways while it runs (#203): the attack load
 * refuses any base of the other player's, main yard or outpost, before it
 * writes a thing. A request still waiting, a rejected request and an expired
 * truce block nothing. Drives `baseModeAttack` over an in-memory stand-in for
 * the rows it reads, as `baseModeAttack.autobank.test.ts` does.
 */

const ATTACKER = 2505;
const OWNER = 77;
const DAY = 86_400;
const ATTACKER_BASEID = "2000241207";
const OUTPOST_BASEID = "2000241208";
const MAIN_BASEID = "2000245210";

type Row = Record<string, unknown>;

const now = () => Math.floor(Date.now() / 1000);

let tables: Map<unknown, Row[]>;
const store = new Map<string, string>();
const sessions = new Map<number, AttackSession>();

interface StandIn {
  findOne: (entity: unknown, where: Row) => Promise<Row | null>;
  find: (entity: unknown, where: Row) => Promise<Row[]>;
  transactional: (run: (tx: StandIn) => Promise<unknown>) => Promise<unknown>;
  create: (entity: unknown, data: Row) => Row;
  persist: () => void;
  flush: () => Promise<void>;
}

const em: StandIn = {
  findOne: async (entity, where) => (tables.get(entity) ?? []).find((row) => matchesWhere(row, where)) ?? null,
  find: async (entity, where) => (tables.get(entity) ?? []).filter((row) => matchesWhere(row, where)),
  transactional: async (run) => run(em),
  create: (_entity, data) => data,
  persist: () => {},
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
  validateRange: async () => {},
  rangeCheckV2: async () => ({ cell: null, verdict: { ok: true, via: "main" } }),
}));

mock.module("../../../../services/base/attackSessionStore.js", () => ({
  startAttackSession: async (basesaveid: number, session: AttackSession) => {
    sessions.set(basesaveid, session);
  },
  readAttackSession: async (basesaveid: number) => sessions.get(basesaveid) ?? null,
  endAttackSession: async () => {},
}));

const { baseModeAttack } = await import("./baseModeAttack.js");

const yardRow = (basesaveid: number, userid: number, baseid: string, type: string): Row => ({
  basesaveid,
  baseid,
  userid,
  saveuserid: userid,
  type,
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
    "1": { id: 1, t: type === "outpost" ? 112 : 11, X: 200, Y: 200, l: 2 },
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

/** A truce Alice (the attacker) asked for and Bob (the owner) answered. */
const truce = (status: string, extra: Row = {}): Row => ({
  id: 1,
  initiator_userid: ATTACKER,
  recipient_userid: OWNER,
  status,
  created_at: new Date(),
  ...extra,
});

beforeEach(() => {
  store.clear();
  sessions.clear();
  tables = new Map<unknown, Row[]>([
    [
      Save,
      [
        yardRow(2526, ATTACKER, ATTACKER_BASEID, "main"),
        { ...yardRow(700, OWNER, MAIN_BASEID, "main"), outposts: [[241, 208, OUTPOST_BASEID]] },
        yardRow(900, OWNER, OUTPOST_BASEID, "outpost"),
      ],
    ],
    [
      WorldMapCell,
      [
        { baseid: ATTACKER_BASEID, map_version: 2, x: 241, y: 207, terrainHeight: 125 },
        { baseid: OUTPOST_BASEID, map_version: 2, x: 241, y: 208, terrainHeight: 125 },
        { baseid: MAIN_BASEID, map_version: 2, x: 245, y: 210, terrainHeight: 125 },
      ],
    ],
    [User, [{ userid: ATTACKER, username: "alice" }, { userid: OWNER, username: "bob" }]],
    [Truce, []],
  ]);
});

const attack = (from: number, baseid: string) => {
  const own = tables.get(Save)!.find((row) => row.saveuserid === from && row.type === "main")!;
  const user = { userid: from, username: from === ATTACKER ? "alice" : "bob", save: own } as unknown as User;
  return baseModeAttack({ user, baseid, mapversion: 2, attackerLevel: 40 });
};

describe("an accepted truce, while it runs, refuses an attack either way", () => {
  beforeEach(() => {
    tables.get(Truce)!.push(truce("accepted", { expires_at: now() + 14 * DAY }));
  });

  test.each([
    ["their main yard", MAIN_BASEID],
    ["their outpost", OUTPOST_BASEID],
  ])("the one who asked cannot attack %s, and nothing is written", async (_what, baseid) => {
    await expect(attack(ATTACKER, baseid)).rejects.toMatchObject({
      status: 403,
      message: "You have an active truce with this player and cannot attack them.",
    });

    expect(saveOf(baseid)).toMatchObject({ attackid: 0, attacks: [] });
    expect(sessions.size).toBe(0);
  });

  test("nor can the one who accepted", async () => {
    await expect(attack(OWNER, ATTACKER_BASEID)).rejects.toMatchObject({ status: 403 });
    expect(saveOf(ATTACKER_BASEID)).toMatchObject({ attackid: 0, attacks: [] });
  });

  test("once it has expired, the attack goes ahead", async () => {
    tables.get(Truce)![0]!.expires_at = now() - 1;

    const { save } = await attack(ATTACKER, MAIN_BASEID);

    expect(save.attackid).toBeGreaterThan(0);
    expect(sessions.has(700)).toBe(true);
  });
});

describe("a truce that does not bind refuses nothing", () => {
  test.each([
    ["a request still waiting", truce("requested")],
    // A rejection keeps the proposer's 2-day wait in expires_at, which is no truce.
    ["a rejected request, its proposer's wait still running", truce("rejected", { expires_at: now() + 2 * DAY })],
  ])("%s", async (_what, row) => {
    tables.get(Truce)!.push(row);

    const { save } = await attack(ATTACKER, OUTPOST_BASEID);

    expect(save.attackid).toBeGreaterThan(0);
    expect(sessions.has(900)).toBe(true);
  });
});
