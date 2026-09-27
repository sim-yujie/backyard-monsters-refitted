import { beforeEach, describe, expect, mock, test } from "bun:test";
import { MapRoomVersion } from "../../enums/MapRoom.js";

/**
 * The row-touching half of the army catch-up: attack entry and the map read,
 * against a stand-in ORM. Real time is used (`getCurrentDateTime`), so every
 * row is dated relative to `Date.now()`.
 */

const now = () => Math.floor(Date.now() / 1000);

let rows: Record<string, any>[];
const persisted: unknown[] = [];
const flushed = mock(async () => {});

const byWhere = (where: Record<string, any>) =>
  rows.find(
    (row) =>
      (where.basesaveid === undefined || row.basesaveid === where.basesaveid) &&
      (where.saveuserid === undefined || row.saveuserid === where.saveuserid) &&
      (where.type === undefined || row.type === where.type)
  ) ?? null;

const em = {
  transactional: async (work: (tx: unknown) => unknown) => work(em),
  findOne: async (_entity: unknown, where: Record<string, any>) => byWhere(where),
  find: async (_entity: unknown, where: { baseid: { $in: string[] }; saveuserid: number }) =>
    rows.filter((row) => where.baseid.$in.includes(row.baseid) && row.saveuserid === where.saveuserid),
  persist: (row: unknown) => persisted.push(row),
  flush: flushed,
};

mock.module("../../server.js", () => ({ redis: {}, postgres: { em } }));

const { catchUpArmiesForAttack, monstersForMap } = await import("./armies.js");
const { catchUpYard } = await import("./catchUp.js");

const ATTACKER = 2505;
const DEFENDER = 3000;

/** A main yard: 4 × Housing L6, one L3 hatchery with Pokeys queued since `ago` seconds. */
const yard = (basesaveid: number, baseid: string, userid: number, ago: number, extra: Record<string, any> = {}) => ({
  basesaveid,
  baseid,
  saveuserid: userid,
  userid,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: now() - ago,
  points: "0",
  buildingdata: {
    "1": { id: 1, t: 15, l: 6 },
    "2": { id: 2, t: 15, l: 6 },
    "3": { id: 3, t: 15, l: 6 },
    "4": { id: 4, t: 15, l: 6 },
    "9": { id: 9, t: 13, l: 3 },
  },
  buildinghealthdata: {},
  storedata: {},
  academy: { C1: { level: 1 } },
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
  outposts: [],
  monsters: { saved: now() - ago, housed: { C1: 10 }, h: [["", 0, [["C1", 20, 1]]]], hid: [9], hstage: [0], hcc: [] },
  ...extra,
});

let attackerMain: Record<string, any>;
let nearOutpost: Record<string, any>;
let farOutpost: Record<string, any>;
let defenderMain: Record<string, any>;

beforeEach(() => {
  persisted.length = 0;
  flushed.mockClear();
  attackerMain = yard(1, "2000241207", ATTACKER, 60, {
    outposts: [
      [242, 207, "2000242207"],
      [100, 100, "2000100100"],
    ],
  });
  nearOutpost = { ...yard(2, "2000242207", ATTACKER, 30), type: "outpost", academy: {} };
  farOutpost = { ...yard(3, "2000100100", ATTACKER, 30), type: "outpost", academy: {} };
  defenderMain = yard(4, "2000241208", DEFENDER, 45);
  rows = [attackerMain, nearOutpost, farOutpost, defenderMain];
});

const user = () => ({ userid: ATTACKER, save: attackerMain }) as never;

describe("catchUpArmiesForAttack", () => {
  test("catches up and writes the defender and the attacker's yards in reach, and records entryHoused", async () => {
    const { defender, entryHoused } = await catchUpArmiesForAttack({
      user: user(),
      defender: defenderMain as never,
      cell: { x: 241, y: 208 },
      mapversion: MapRoomVersion.V2,
    });

    // 45 s at 15 s each: 3 more at the defender; 60 s → 4 at the attacker; 30 s → 2 at the outpost.
    expect((defender as any).monsters.housed).toEqual({ C1: 13 });
    expect(defenderMain.savetime).toBeGreaterThanOrEqual(now() - 1);
    expect(attackerMain.monsters.housed).toEqual({ C1: 14 });
    expect(nearOutpost.monsters.housed).toEqual({ C1: 12 });
    expect(persisted).toContain(nearOutpost);

    // The far outpost cannot reach the target: untouched, not recorded.
    expect(farOutpost.monsters.housed).toEqual({ C1: 10 });
    expect(entryHoused).toEqual({ "2000241207": { C1: 14 }, "2000242207": { C1: 12 } });
  });

  test("an attacker whose own yard is under attack is measured, not written", async () => {
    attackerMain.attackid = 7;
    attackerMain.attacks = [{ starttime: now() - 10 }];
    const before = structuredClone(attackerMain.monsters);

    const { entryHoused } = await catchUpArmiesForAttack({
      user: user(),
      defender: defenderMain as never,
      cell: { x: 241, y: 208 },
      mapversion: MapRoomVersion.V2,
    });

    expect(attackerMain.monsters).toEqual(before);
    expect(entryHoused?.["2000241207"]).toEqual({ C1: 14 });
  });

  test("outside Map Room 2 only the defender is caught up, and no entryHoused is kept", async () => {
    const { entryHoused } = await catchUpArmiesForAttack({
      user: user(),
      defender: defenderMain as never,
      cell: { x: 241, y: 208 },
      mapversion: MapRoomVersion.V3,
    });

    expect(entryHoused).toBeUndefined();
    expect(defenderMain.monsters.housed).toEqual({ C1: 13 });
    expect(attackerMain.monsters.housed).toEqual({ C1: 10 });
  });
});

describe("monstersForMap", () => {
  test("the map read equals what the next write stores, and writes nothing", async () => {
    const before = structuredClone(attackerMain);
    const read = await monstersForMap(1, async () => attackerMain as never, now());

    expect(attackerMain).toEqual(before);
    catchUpYard(attackerMain as never, now());
    expect(read).toEqual(attackerMain.monsters);
  });

  test("an outpost's read uses its owner's academy levels", async () => {
    nearOutpost.academy = {};
    attackerMain.academy = { C1: { level: 6 } };
    const read = await monstersForMap(2, async () => attackerMain as never, now());

    // Level 6 Pokeys hatch in 5 s: 30 s → 6.
    expect(read?.housed).toEqual({ C1: 16 });
  });
});
