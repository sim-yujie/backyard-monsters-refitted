import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Save } from "../../../../database/models/save.model.js";
import { Truce } from "../../../../database/models/truce.model.js";
import { User } from "../../../../database/models/user.model.js";
import { WorldMapCell } from "../../../../database/models/worldmapcell.model.js";
import { World } from "../../../../database/models/world.model.js";
import type { AttackSession } from "../../../../services/base/attackSession.js";
import { matchesWhere } from "../../../../testing/matchesWhere.js";
import { generateBaseId } from "../../../../utils/generateBaseId.js";
import { WILD_MONSTER_EXPIRATION } from "../../../../services/maproom/wildMonsterExpiry.js";

/**
 * A Map Room 2 wild monster camp heals 12 hours after its last attack
 * (`wildMonsterExpiry.ts`). The map already showed such a camp as healed and
 * opening it regrew it (`baseModeView`), but attacking it straight from the map
 * fought the old, damaged row. The attack load now regrows it too: the old row
 * goes, but only once nothing can refuse the attack, and never under someone
 * else's attack (`campInPlay.ts`). Drives `baseModeAttack` over the in-memory
 * stand-in of `baseModeAttack.online.test.ts`.
 */

const ATTACKER = 2505;
const WORLD = "world-a";
const ATTACKER_BASEID = "2000241207";
const CAMP_X = 241;
const CAMP_Y = 209;
const CAMP_BASEID = generateBaseId(WORLD, CAMP_X, CAMP_Y);
const CAMP_ROW = 4100;

type Row = Record<string, unknown>;

const now = () => Math.floor(Date.now() / 1000);

let tables: Map<unknown, Row[]>;
let removed: Row[];
let refuseRange: boolean;
const store = new Map<string, string>();
const sessions = new Map<number, AttackSession>();

interface StandIn {
  findOne: (entity: unknown, where: Row) => Promise<Row | null>;
  find: (entity: unknown, where: Row) => Promise<Row[]>;
  transactional: (run: (tx: StandIn) => Promise<unknown>) => Promise<unknown>;
  create: (entity: unknown, data: Row) => Row;
  persist: () => void;
  remove: (row: Row) => void;
  flush: () => Promise<void>;
}

const em: StandIn = {
  findOne: async (entity, where) => (tables.get(entity) ?? []).find((row) => matchesWhere(row, where)) ?? null,
  find: async (entity, where) => (tables.get(entity) ?? []).filter((row) => matchesWhere(row, where)),
  transactional: async (run) => run(em),
  create: (_entity, data) => data,
  persist: () => {},
  remove: (row) => {
    removed.push(row);
    tables.set(
      Save,
      tables.get(Save)!.filter((other) => other !== row)
    );
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
    if (refuseRange) throw new Error("out of range");
  },
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
const { tribeSaveV2 } = await import("../../../../services/maproom/v2/tribeSaveV2.js");
const { attackSessionKey } = await import("../../../../services/base/attackSession.js");

const attackerRow = (): Row => ({
  basesaveid: 2526,
  baseid: ATTACKER_BASEID,
  userid: ATTACKER,
  saveuserid: ATTACKER,
  type: "main",
  mapversion: 2,
  mr2upgraded: 1,
  worldid: WORLD,
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

/** The camp's row as its last attack left it: 60% damaged, saved `age` seconds ago. */
const damagedCamp = (age: number): Row => ({
  ...(tribeSaveV2(CAMP_BASEID, WORLD) as unknown as Row),
  basesaveid: CAMP_ROW,
  damage: 60,
  destroyed: 0,
  savetime: now() - age,
  attackid: 0,
  attacks: [],
  protected: 0,
});

const seed = (camp: Row) => {
  tables = new Map<unknown, Row[]>([
    [Save, [attackerRow(), camp]],
    [
      WorldMapCell,
      [
        { baseid: ATTACKER_BASEID, map_version: 2, x: 241, y: 207, terrainHeight: 125 },
        { baseid: CAMP_BASEID, map_version: 2, x: CAMP_X, y: CAMP_Y, terrainHeight: 125 },
      ],
    ],
    [World, [{ uuid: WORLD }]],
    [User, [{ userid: ATTACKER, username: "alice" }]],
    [Truce, []],
  ]);
};

const attack = () => {
  const own = tables.get(Save)!.find((row) => row.saveuserid === ATTACKER && row.type === "main")!;
  const user = { userid: ATTACKER, username: "alice", save: own } as unknown as User;
  return baseModeAttack({ user, baseid: CAMP_BASEID, mapversion: 2, attackerLevel: 40 });
};

beforeEach(() => {
  store.clear();
  sessions.clear();
  removed = [];
  refuseRange = false;
});

describe("attacking a wild monster camp straight from the map (camp healing)", () => {
  test("a camp attacked within its 12 hours is fought as its last attack left it", async () => {
    const camp = damagedCamp(60 * 60);
    seed(camp);

    const { save } = await attack();

    expect(save as unknown).toBe(camp);
    expect(save.damage).toBe(60);
    expect(removed).toHaveLength(0);
  });

  test("a camp past its 12 hours is fought fresh: the old row goes, a new one stands", async () => {
    const camp = damagedCamp(WILD_MONSTER_EXPIRATION + 60);
    seed(camp);

    const { save } = await attack();

    expect(removed).toEqual([camp]);
    expect(save as unknown).not.toBe(camp);
    expect(save.baseid).toBe(CAMP_BASEID);
    expect(save.damage ?? 0).toBe(0);
    expect(save.destroyed ?? 0).toBe(0);
    expect(save.wmid).toBe(camp.wmid as number);
  });

  test("a destroyed camp heals the same way", async () => {
    const camp = { ...damagedCamp(WILD_MONSTER_EXPIRATION + 60), damage: 100, destroyed: 1 };
    seed(camp);

    const { save } = await attack();

    expect(removed).toEqual([camp]);
    expect(save.destroyed ?? 0).toBe(0);
  });

  test("an attack refused for range leaves the expired row alone", async () => {
    const camp = damagedCamp(WILD_MONSTER_EXPIRATION + 60);
    seed(camp);
    refuseRange = true;

    await expect(attack()).rejects.toThrow("out of range");
    expect(removed).toHaveLength(0);
    expect(tables.get(Save)).toContain(camp);
  });

  test("an expired camp still under someone's attack is refused, not regrown under them", async () => {
    const camp = damagedCamp(WILD_MONSTER_EXPIRATION + 60);
    seed(camp);
    store.set(attackSessionKey(CAMP_ROW), "{}");

    await expect(attack()).rejects.toThrow();
    expect(removed).toHaveLength(0);
    expect(tables.get(Save)).toContain(camp);
  });
});
