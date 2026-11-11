import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Maproom } from "../../../../database/models/maproom.model.js";
import { Save } from "../../../../database/models/save.model.js";
import { Truce } from "../../../../database/models/truce.model.js";
import { User } from "../../../../database/models/user.model.js";
import { experiencePoints } from "../../../../game-data/stats/experiencePoints.js";
import type { AttackSession } from "../../../../services/base/attackSession.js";
import { matchesWhere } from "../../../../testing/matchesWhere.js";
import type { NeighbourData } from "../../../../types/NeighbourData.js";

/**
 * Map Room 1 attacks (owner, 11 Nov 2026, `services/maproom/v1/mr1AttackRules.ts`):
 * only neighbours, not more than 7 levels down unless the attacker has
 * vengeance on them, which an attack from more than 7 levels below earns and
 * which lapses 14 days after the last attack. Drives `baseModeAttack` over the
 * in-memory stand-in of `baseModeAttack.online.test.ts`, with the Map Room 1
 * neighbour lists (`Maproom.neighbors`) in it.
 */

const ATTACKER = 2505;
const OWNER = 77;
const ATTACKER_BASEID = "2000241207";
const MAIN_BASEID = "2000245210";
const DAY = 24 * 60 * 60;

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

/** Empire points for exactly `level`. */
const pointsFor = (level: number) => String(experiencePoints[level - 1]);

const yardRow = (basesaveid: number, userid: number, baseid: string, level: number): Row => ({
  basesaveid,
  baseid,
  userid,
  saveuserid: userid,
  type: "main",
  mapversion: 1,
  worldid: "",
  attackid: 0,
  attacks: [],
  protected: 0,
  savetime: now() - 10,
  lastupdateAt: new Date(),
  credits: 0,
  points: pointsFor(level),
  basevalue: "0",
  flinger: 0,
  catapult: 0,
  resources: { r1: 1_000, r2: 1_000, r3: 1_000, r4: 1_000 },
  buildingdata: {
    "0": { id: 0, t: 14, X: 0, Y: 0, l: 10 },
    "1": { id: 1, t: 11, X: 200, Y: 200, l: 1 },
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

const neighbour = (userid: number, fields: Partial<NeighbourData> = {}): NeighbourData => ({
  userid,
  baseid: userid === OWNER ? MAIN_BASEID : ATTACKER_BASEID,
  level: 1,
  username: userid === OWNER ? "bob" : "alice",
  attacksTodayCount: 0,
  attacksTodayDate: 0,
  ...fields,
});

const saveOf = (userid: number) => tables.get(Save)!.find((row) => row.saveuserid === userid)!;
const listOf = (userid: number) =>
  tables.get(Maproom)!.find((row) => row.userid === userid)!.neighbors as NeighbourData[];
const entryOn = (owner: number, userid: number) => listOf(owner).find((one) => one.userid === userid);

/** Sets the two players' levels and the attacker's list (`null` for none). */
const setup = (
  { attacker, owner }: { attacker: number; owner: number },
  attackersEntry: Partial<NeighbourData> | null = {}
) => {
  store.clear();
  sessions.clear();
  tables = new Map<unknown, Row[]>([
    [Save, [yardRow(2526, ATTACKER, ATTACKER_BASEID, attacker), yardRow(700, OWNER, MAIN_BASEID, owner)]],
    [User, [{ userid: ATTACKER, username: "alice" }, { userid: OWNER, username: "bob" }]],
    [Truce, []],
    [
      Maproom,
      [
        { userid: ATTACKER, neighbors: attackersEntry ? [neighbour(OWNER, attackersEntry)] : [], droppedNeighbours: [] },
        { userid: OWNER, neighbors: [], droppedNeighbours: [] },
      ],
    ],
  ]);
};

const attack = (from: number) => {
  const user = { userid: from, username: from === ATTACKER ? "alice" : "bob", save: saveOf(from) } as unknown as User;
  return baseModeAttack({ user, baseid: from === ATTACKER ? MAIN_BASEID : ATTACKER_BASEID, mapversion: 1, attackerLevel: 10 });
};

const refused = async (message: string) => {
  await expect(attack(ATTACKER)).rejects.toMatchObject({ message });
  expect(saveOf(OWNER)).toMatchObject({ attackid: 0, attacks: [] });
  expect(sessions.size).toBe(0);
};

const goesAhead = async () => {
  const { save } = await attack(ATTACKER);
  expect(save.attackid).toBeGreaterThan(0);
  expect(sessions.has(700)).toBe(true);
};

const NOT_NEIGHBOUR = "Not your neighbour. Map Room 1 attacks only your neighbours.";
const TOO_LOW = "Too low: more than 7 levels below you.";

beforeEach(() => setup({ attacker: 20, owner: 20 }));

describe("Map Room 1 attacks need a neighbour", () => {
  test("a neighbour at the same level: attacked", async () => {
    await goesAhead();
  });

  test("someone not on the attacker's list: refused, nothing written", async () => {
    setup({ attacker: 20, owner: 20 }, null);
    await refused(NOT_NEIGHBOUR);
  });

  test("the attack puts the attacker on the defender's list, so they can hit back", async () => {
    await goesAhead();
    expect(entryOn(OWNER, ATTACKER)).toMatchObject({ attacksfrom: 1, vengeance: 0 });
    expect(entryOn(OWNER, ATTACKER)?.lastattackfrom).toBeGreaterThan(now() - 5);
  });
});

describe("Map Room 1 level gap", () => {
  test("7 levels below: attacked", async () => {
    setup({ attacker: 20, owner: 13 });
    await goesAhead();
  });

  test("8 levels below: refused, nothing written", async () => {
    setup({ attacker: 20, owner: 12 });
    await refused(TOO_LOW);
  });

  test("both at 40 or more: no gap", async () => {
    setup({ attacker: 55, owner: 41 });
    await goesAhead();
  });

  test("8 levels below with vengeance: attacked, and one vengeance spent", async () => {
    setup({ attacker: 20, owner: 12 }, { attacksfrom: 1, vengeance: 2, lastattackfrom: now() - DAY });
    await goesAhead();
    expect(entryOn(ATTACKER, OWNER)?.vengeance).toBe(1);
  });

  test("vengeance used up: refused again", async () => {
    setup({ attacker: 20, owner: 12 }, { attacksfrom: 1, vengeance: 1, lastattackfrom: now() - DAY });
    await goesAhead();
    expect(entryOn(ATTACKER, OWNER)?.vengeance).toBe(0);
    // The attack's catch-up worked out both yards' value from their
    // buildings; put the levels back to 20 and 12 for the second try.
    for (const [userid, level] of [[ATTACKER, 20], [OWNER, 12]] as const) {
      Object.assign(saveOf(userid), { points: pointsFor(level), basevalue: "0" });
    }
    saveOf(OWNER).attackid = 0;
    saveOf(OWNER).attacks = [];
    sessions.clear();
    await refused(TOO_LOW);
  });

  test("vengeance lapses 14 days after their last attack: refused", async () => {
    setup({ attacker: 20, owner: 12 }, { attacksfrom: 1, vengeance: 2, lastattackfrom: now() - 14 * DAY - 60 });
    await refused(TOO_LOW);
  });

  test("attacking 8 levels up is allowed and earns the defender one vengeance", async () => {
    setup({ attacker: 12, owner: 20 });
    await goesAhead();
    expect(entryOn(OWNER, ATTACKER)).toMatchObject({ attacksfrom: 1, vengeance: 1 });
  });

  test("an attack inside the gap earns no vengeance", async () => {
    setup({ attacker: 15, owner: 20 });
    await goesAhead();
    expect(entryOn(OWNER, ATTACKER)?.vengeance).toBe(0);
  });
});
