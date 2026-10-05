import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Save } from "../../../../database/models/save.model.js";
import { Truce } from "../../../../database/models/truce.model.js";
import { User } from "../../../../database/models/user.model.js";
import { WorldMapCell } from "../../../../database/models/worldmapcell.model.js";
import type { AttackSession } from "../../../../services/base/attackSession.js";
import { matchesWhere } from "../../../../testing/matchesWhere.js";

/**
 * The attack load refuses a player who is online (#271): a presence mark from
 * the last minute AND a real game action from the last ten minutes, with no
 * in-game check pending (`services/user/online.ts`). Pings alone protect
 * nobody: a tab left open, a mouse jiggler or a script calling `/presence`
 * leaves the player attackable ten minutes after their last real action.
 * Drives `baseModeAttack` over the in-memory stand-in of
 * `baseModeAttack.truce.test.ts`.
 */

const ATTACKER = 2505;
const OWNER = 77;
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

const MINUTE = 60;

/** The owner's marks, as the ping and the real-action tracker write them. */
const marks = ({ seen, action, challenge }: { seen?: number; action?: number; challenge?: boolean }) => {
  if (seen !== undefined) store.set(`last-seen:main:${OWNER}`, String(now() - seen));
  if (action !== undefined) store.set(`last-action:${OWNER}`, String(now() - action));
  if (challenge) store.set(`presence-challenge:${OWNER}`, "1");
};

const refusedAsOnline = async () => {
  await expect(attack(ATTACKER, MAIN_BASEID)).rejects.toMatchObject({
    message: "This player is currently online and cannot be attacked. Please try again later.",
  });
  expect(saveOf(MAIN_BASEID)).toMatchObject({ attackid: 0, attacks: [] });
  expect(sessions.size).toBe(0);
};

const goesAhead = async () => {
  const { save } = await attack(ATTACKER, MAIN_BASEID);
  expect(save.attackid).toBeGreaterThan(0);
  expect(sessions.has(700)).toBe(true);
};

describe("an online player cannot be attacked (#271)", () => {
  test("a ping 10 s ago and a real action 9 minutes ago: refused", async () => {
    marks({ seen: 10, action: 9 * MINUTE });
    await refusedAsOnline();
  });

  test("pings still coming but the last real action 11 minutes ago: attackable", async () => {
    marks({ seen: 10, action: 11 * MINUTE });
    await goesAhead();
  });

  test("pings and never a real action: attackable", async () => {
    marks({ seen: 10 });
    await goesAhead();
  });

  test("a real action a minute ago but no ping for 90 s (the game closed): attackable", async () => {
    marks({ seen: 90, action: MINUTE });
    await goesAhead();
  });

  test("an in-game check pending (#273): attackable whatever the marks", async () => {
    marks({ seen: 10, action: MINUTE, challenge: true });
    await goesAhead();
  });

  test("an outpost is never protected by being online, as before", async () => {
    marks({ seen: 10, action: MINUTE });
    const { save } = await attack(ATTACKER, OUTPOST_BASEID);
    expect(save.attackid).toBeGreaterThan(0);
  });
});

describe("a yard a wild monster raid is being fought on cannot be attacked (#226)", () => {
  test("refused as under attack while the raid's lock holds, and nothing is written", async () => {
    saveOf(MAIN_BASEID).aiattacks = { v: 2, fight: { id: "r_one", until: now() + 60 } };
    await expect(attack(ATTACKER, MAIN_BASEID)).rejects.toMatchObject({
      message: "This base is currently under attack by another player. Please try again later.",
    });
    expect(saveOf(MAIN_BASEID)).toMatchObject({ attackid: 0, attacks: [] });
    expect(sessions.size).toBe(0);
  });

  test("attackable again once the lock has lapsed", async () => {
    saveOf(MAIN_BASEID).aiattacks = { v: 2, fight: { id: "r_one", until: now() - 1 } };
    await goesAhead();
  });
});
