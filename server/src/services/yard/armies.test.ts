import { beforeEach, describe, expect, mock, test } from "bun:test";
import { MapRoomVersion } from "../../enums/MapRoom.js";

/**
 * The row-touching half of the army catch-up: attack entry and the map read,
 * against a stand-in ORM. Real time is used (`getCurrentDateTime`), so every
 * row is dated relative to `Date.now()`.
 */

const now = () => Math.floor(Date.now() / 1000);

let rows: Record<string, any>[];
let finds = 0;
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
  // The yards' own reads, scoped to the attacker, and the flinger-level read (`flingerLevelsNow`), not scoped;
  // the map's batched army read (`monstersForMapMany`) by save id.
  find: async (_entity: unknown, where: { baseid?: { $in: string[] }; basesaveid?: { $in: number[] }; saveuserid?: number }) => {
    finds++;
    return rows.filter(
      (row) =>
        (where.basesaveid ? where.basesaveid.$in.includes(row.basesaveid) : where.baseid!.$in.includes(row.baseid)) &&
        (where.saveuserid === undefined || row.saveuserid === where.saveuserid)
    );
  },
  persist: (row: unknown) => persisted.push(row),
  flush: flushed,
};

mock.module("../../server.js", () => ({ redis: {}, postgres: { em } }));

const { armyQuestEvents, catchUpArmiesForAttack, catchUpTransferYards, monstersForMap, monstersForMapMany, settleAttackArmies } =
  await import("./armies.js");
const { catchUpYard } = await import("./catchUp.js");
const { jobQuestEvents } = await import("../quests/hooks.js");
const { recordQuests, readQuests } = await import("../quests/state.js");

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
    homebase: ["241", "207"],
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

  test("returns the outposts' hatches for the hatch quest; the main yards' locked catch-ups count their own", async () => {
    const { attackerHatched, defenderHatched } = await catchUpArmiesForAttack({
      user: user(),
      defender: defenderMain as never,
      cell: { x: 241, y: 208 },
      mapversion: MapRoomVersion.V2,
    });

    // The near outpost's 2 Pokeys; the main yard's 4 went on its quests in the locked catch-up.
    expect(attackerHatched).toEqual({ hatch: 2, "hatch:C1": 2 });
    expect(defenderHatched).toEqual({});
    expect(readQuests(attackerMain.dailyquests).daily).not.toBeNull();
  });

  test("a defending outpost's hatches are its owner's", async () => {
    const defenderOutpost = { ...yard(6, "2000241209", DEFENDER, 30), type: "outpost", academy: {} };
    rows.push(defenderOutpost);

    const { defenderHatched } = await catchUpArmiesForAttack({
      user: user(),
      defender: defenderOutpost as never,
      cell: { x: 241, y: 209 },
      mapversion: MapRoomVersion.V2,
    });

    expect(defenderOutpost.monsters.housed).toEqual({ C1: 12 });
    expect(defenderHatched).toEqual({ hatch: 2, "hatch:C1": 2 });
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

  test("leaves out an outpost in the sweep box that its own flinger cannot reach (Repeat attack, 15 Nov)", async () => {
    // Three cells from the target, a level 2 outpost flinger reaches two.
    const boxOutpost = { ...yard(5, "2000244208", ATTACKER, 30), type: "outpost", academy: {}, flinger: 2 };
    rows.push(boxOutpost);
    attackerMain.outposts.push([244, 208, "2000244208"]);

    const { entryHoused } = await catchUpArmiesForAttack({
      user: user(),
      defender: defenderMain as never,
      cell: { x: 241, y: 208 },
      mapversion: MapRoomVersion.V2,
    });

    expect(Object.keys(entryHoused ?? {}).sort()).toEqual(["2000241207", "2000242207"]);
    expect(boxOutpost.monsters.housed).toEqual({ C1: 10 });
    expect(persisted).not.toContain(boxOutpost);
  });

  test("leaves out the main yard when only an outpost reaches the target", async () => {
    // A level 1 main flinger reaches four cells; the target is eleven away.
    attackerMain.homebase = ["230", "208"];
    attackerMain.flinger = 1;

    const { entryHoused } = await catchUpArmiesForAttack({
      user: user(),
      defender: defenderMain as never,
      cell: { x: 241, y: 208 },
      mapversion: MapRoomVersion.V2,
    });

    expect(entryHoused).toEqual({ "2000242207": { C1: 12 } });
    // Still caught up and written, as every attack entry does the main yard.
    expect(attackerMain.monsters.housed).toEqual({ C1: 14 });
  });

  test("a Map Room 1 attack records the main yard's housing only, even with an outpost in reach (#132)", async () => {
    const { entryHoused } = await catchUpArmiesForAttack({
      user: user(),
      defender: defenderMain as never,
      cell: { x: 241, y: 208 },
      mapversion: MapRoomVersion.V1,
    });

    expect(entryHoused).toEqual({ "2000241207": { C1: 14 } });
    expect(attackerMain.monsters.housed).toEqual({ C1: 14 });
    expect(nearOutpost.monsters.housed).toEqual({ C1: 10 });
    expect(persisted).not.toContain(nearOutpost);
  });

  test("a Map Room 3 attack catches up only the defender, and keeps no entryHoused", async () => {
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

  test("many cells in one query give each cell's own answer; the owner is read once; a gone row is left out", async () => {
    nearOutpost.academy = {};
    attackerMain.academy = { C1: { level: 6 } };
    const at = now();
    const one = [await monstersForMap(1, async () => attackerMain as never, at), await monstersForMap(2, async () => attackerMain as never, at)];

    finds = 0;
    let ownerReads = 0;
    const many = await monstersForMapMany([1, 2, 2, 999], async () => (ownerReads++, attackerMain as never), at);

    expect(finds).toBe(1);
    expect(ownerReads).toBe(1); // only the outpost needs it; the main yard is its own owner
    expect(many.get(1)).toEqual(one[0]);
    expect(many.get(2)).toEqual(one[1]);
    expect(many.has(999)).toBe(false);
  });
});

/** A daily set holding one "hatch N of `monster`" quest at 0. */
const hatchQuest = (monster: string, need: number) => ({
  v: 1,
  daily: {
    period: new Date(now() * 1000).toISOString().slice(0, 10),
    swaps: 0,
    bonus: false,
    quests: [{ slot: 0, kind: "hatchMonster", variant: monster, need, have: 0, claimed: false, rewards: [] }],
  },
});

describe("settleAttackArmies (Slimeattikus hatch quest, 17 Nov 2026)", () => {
  test("monsters that hatch during an attack count for the hatch quest exactly once", async () => {
    // Entry caught the yard up 60 s ago (savetime and the production clock);
    // four Pokeys hatch while the attack runs, none is flung.
    attackerMain.dailyquests = hatchQuest("C1", 4);

    const hatched = await settleAttackArmies({
      userSave: attackerMain as never,
      entries: [{ baseid: attackerMain.baseid, m: { housed: { C1: 10 } } }],
      entryHoused: { [attackerMain.baseid]: { C1: 10 } },
      logged: null,
      now: now(),
    });

    // The settle wrote them, production clock and all ...
    expect(attackerMain.monsters.housed).toEqual({ C1: 14 });
    expect(attackerMain.monsters.saved).toBeGreaterThanOrEqual(now() - 1);
    // ... so it hands back the hatches for the landing to count ...
    expect(hatched).toEqual({ hatch: 4, "hatch:C1": 4 });

    // ... and the owner's next full catch-up finds none of them again.
    const later = catchUpYard(attackerMain as never, now());
    expect(jobQuestEvents(later)).toEqual({});

    const quests = readQuests(recordQuests(attackerMain as never, now(), hatched));
    expect(quests.daily?.quests[0]).toMatchObject({ kind: "hatchMonster", variant: "C1", have: 4 });
  });

  test("an outpost that flung in the attack hands back its hatches too", async () => {
    const hatched = await settleAttackArmies({
      userSave: attackerMain as never,
      entries: [
        { baseid: attackerMain.baseid, m: { housed: { C1: 10 } } },
        { baseid: nearOutpost.baseid, m: { housed: { C1: 10 } } },
      ],
      entryHoused: { [attackerMain.baseid]: { C1: 10 }, [nearOutpost.baseid]: { C1: 10 } },
      logged: null,
      now: now(),
    });

    // 60 s on the main yard, 30 s on the outpost, at 15 s a Pokey.
    expect(hatched).toEqual({ hatch: 6, "hatch:C1": 6 });
    expect(persisted).toContain(nearOutpost);
  });
});

describe("armyQuestEvents / catchUpTransferYards", () => {
  test("a transfer's catch-up hands back both yards' hatches", () => {
    const hatched = catchUpTransferYards([attackerMain, nearOutpost] as never, attackerMain as never, now());
    expect(hatched).toEqual({ hatch: 6, "hatch:C1": 6 });
    expect(catchUpTransferYards([attackerMain, nearOutpost] as never, attackerMain as never, now())).toEqual({});
  });

  test("the Inferno's hatches never count for the surface's quests", () => {
    const jobs = (id: string) => [{ kind: "hatch", id, t: null, at: now(), detail: { count: 3 } }] as never;
    expect(armyQuestEvents({ type: "inferno" }, jobs("IC1"))).toEqual({});
    expect(armyQuestEvents({ type: "outpost" }, jobs("C17"))).toEqual({ hatch: 3, "hatch:C17": 3 });
  });
});
