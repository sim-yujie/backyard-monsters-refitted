import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Save } from "../../../../database/models/save.model.js";
import { User } from "../../../../database/models/user.model.js";
import { WorldMapCell } from "../../../../database/models/worldmapcell.model.js";
import type { AttackSession } from "../../../../services/base/attackSession.js";

/**
 * The attack load autobanks the defender before it snapshots the pool the
 * loot is taken from (issue #179, outposts WP4). Drives `baseModeAttack` over
 * an in-memory stand-in for the rows it reads; the attack session it starts
 * (and its `defenderResources`, the snapshot) is kept to be read back. The
 * stand-in hands out the rows themselves, as an identity map would.
 */

const ATTACKER = 2505;
const OWNER = 77;
const HOUR = 3600;
const OUTPOST_BASEID = "2000241208";
const MAIN_BASEID = "2000245210";

type Row = Record<string, unknown>;

const now = () => Math.floor(Date.now() / 1000);

let tables: Map<unknown, Row[]>;
const store = new Map<string, string>();
const sessions = new Map<number, AttackSession>();

const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, value]) =>
    value !== null && typeof value === "object" && "$in" in value
      ? (value.$in as unknown[]).includes(row[key])
      : row[key] === value
  );

interface StandIn {
  findOne: (entity: unknown, where: Row) => Promise<Row | null>;
  find: (entity: unknown, where: Row) => Promise<Row[]>;
  transactional: (run: (tx: StandIn) => Promise<unknown>) => Promise<unknown>;
  create: (entity: unknown, data: Row) => Row;
  persist: () => void;
  flush: () => Promise<void>;
}

const em: StandIn = {
  findOne: async (entity: unknown, where: Row) =>
    (tables.get(entity) ?? []).find((row) => matches(row, where)) ?? null,
  find: async (entity: unknown, where: Row) => (tables.get(entity) ?? []).filter((row) => matches(row, where)),
  transactional: async (run) => run(em),
  create: (_entity: unknown, data: Row) => data,
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

/** A main yard; the catch-up finds nothing to do on it. */
const mainRow = (basesaveid: number, userid: number, baseid: string, extra: Row = {}): Row => ({
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
  ...extra,
});

/** Four level 10 Goo Factories: 224 goo a tick at height 125. */
const gooFactories = () =>
  Object.fromEntries([10, 11, 12, 13].map((id) => [String(id), { id, t: 4, X: id * 40, Y: 0, l: 10 }]));

const outpostRow = (): Row => ({
  basesaveid: 900,
  baseid: OUTPOST_BASEID,
  userid: OWNER,
  saveuserid: OWNER,
  type: "outpost",
  mapversion: 2,
  worldid: "world-a",
  attackid: 0,
  attacks: [],
  protected: 0,
  savetime: now() - 10,
  resources: {},
  buildingdata: { "1": { id: 1, t: 112, X: 0, Y: -50, l: 1 }, ...gooFactories() },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  academy: {},
  outposts: [],
});

const defenderMain = () => tables.get(Save)!.find((row) => row.basesaveid === 700)!;

beforeEach(() => {
  store.clear();
  sessions.clear();
  tables = new Map<unknown, Row[]>([
    [
      Save,
      [
        mainRow(2526, ATTACKER, "2000241207"),
        mainRow(700, OWNER, MAIN_BASEID, {
          outposts: [[241, 208, OUTPOST_BASEID]],
          buildingresources: { t: now() - HOUR },
        }),
        outpostRow(),
      ],
    ],
    [
      WorldMapCell,
      [
        { baseid: OUTPOST_BASEID, map_version: 2, x: 241, y: 208, terrainHeight: 125 },
        { baseid: MAIN_BASEID, map_version: 2, x: 245, y: 210, terrainHeight: 125 },
      ],
    ],
    [User, [{ userid: OWNER, username: "owner" }]],
  ]);
});

const attack = async (baseid: string) => {
  const attackerSave = tables.get(Save)!.find((row) => row.basesaveid === 2526)!;
  const user = { userid: ATTACKER, username: "attacker", save: attackerSave } as unknown as User;
  const { save } = await baseModeAttack({ user, baseid, mapversion: 2, attackerLevel: 40 });
  return sessions.get(save.basesaveid);
};

/** An hour of four level 10 Goo Factories at height 125, on the 1,000 held. */
const PAID = 1_000 + 224 * 360;

describe("the attack load autobanks the defender before the loot snapshot", () => {
  test("an outpost: its owner's main pool is paid, and the session keeps the paid pool", async () => {
    const session = await attack(OUTPOST_BASEID);

    expect((defenderMain().resources as Row).r4).toBe(PAID);
    expect(session?.defenderResources).toEqual({ r1: 1_000, r2: 1_000, r3: 1_000, r4: PAID });
  });

  test("a main yard with outposts: paid in its catch-up, before the snapshot", async () => {
    const session = await attack(MAIN_BASEID);

    expect((defenderMain().resources as Row).r4).toBe(PAID);
    expect(session?.defenderResources).toEqual({ r1: 1_000, r2: 1_000, r3: 1_000, r4: PAID });
  });

  test("the attacker's own clock starts too, and pays them nothing without outposts", async () => {
    await attack(OUTPOST_BASEID);
    const attacker = tables.get(Save)!.find((row) => row.basesaveid === 2526)!;
    expect(attacker.resources).toEqual({ r1: 1_000, r2: 1_000, r3: 1_000, r4: 1_000 });
    expect(attacker.buildingresources).toEqual({ t: expect.any(Number) });
  });
});

describe("the attack load serves the defence and keeps it in the session (#195)", () => {
  test("an outpost: its own garrisons, at its owner's main-yard academy levels", async () => {
    const outpost = tables.get(Save)!.find((row) => row.basesaveid === 900)!;
    (outpost.buildingdata as Row)["20"] = { id: 20, t: 22, X: 300, Y: 300, l: 1, m: { C1: 3 } };
    defenderMain().academy = { C1: { level: 4 } };

    const attackerSave = tables.get(Save)!.find((row) => row.basesaveid === 2526)!;
    const user = { userid: ATTACKER, username: "attacker", save: attackerSave } as unknown as User;
    const { save, defenderForces } = await baseModeAttack({
      user,
      baseid: OUTPOST_BASEID,
      mapversion: 2,
      attackerLevel: 40,
    });

    expect(defenderForces).toEqual({ bunkers: { 20: { C1: 3 } }, defenderLevels: { C1: 4 }, defenderChampions: [] });
    expect(sessions.get(save.basesaveid)?.defenderForces).toEqual(defenderForces);
  });

  test("a main yard: the champion at home in its cage, not one that is away", async () => {
    defenderMain().champion = [
      { t: 1, l: 2, hp: 500, pl: 0, status: 1 },
      { t: 3, l: 4, hp: 900, pl: 1, status: 0 },
    ];
    const session = await attack(MAIN_BASEID);
    // At its health as the load's catch-up healed it.
    const champions = session?.defenderForces?.defenderChampions ?? [];
    expect(champions).toHaveLength(1);
    const champion = champions[0];
    expect(champion).toMatchObject({ t: 3, l: 4, pl: 1 });
    expect(champion?.hp).toBeGreaterThanOrEqual(900);
    expect(champion?.hp).toBe(Math.floor((defenderMain().champion as { hp: number }[])[1]!.hp));
  });

  test("a main yard: a Krallen and a basic champion both at home both defend (#310)", async () => {
    defenderMain().champion = [
      { t: 5, l: 5, hp: 9000, pl: 2, status: 0 },
      { t: 3, l: 6, hp: 900, pl: 1, status: 0 },
    ];
    const session = await attack(MAIN_BASEID);
    const champions = session?.defenderForces?.defenderChampions ?? [];
    expect(champions.map((champion) => champion.t)).toEqual([5, 3]);
  });
});

describe("the attack load ends the attacker's bought protection, notice and all (#200)", () => {
  test.each([
    ["a player's main yard", MAIN_BASEID],
    ["a player's outpost", OUTPOST_BASEID],
  ])("attacking %s drops the attacker's PRO entry with its protection", async (_what, baseid) => {
    const attackerSave = tables.get(Save)!.find((row) => row.basesaveid === 2526)!;
    attackerSave.protected = now() + 86_400;
    attackerSave.storedata = { PRO1: { q: 1, s: now(), e: now() + 86_400 }, BST: { q: 1, e: now() + 600 } };

    await attack(baseid);

    expect(attackerSave.protected).toBe(0);
    expect(attackerSave.storedata).toEqual({ BST: { q: 1, e: expect.any(Number) } });
  });
});
