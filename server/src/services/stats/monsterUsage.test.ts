import { describe, expect, mock, test } from "bun:test";

/**
 * The dashboard's monster counts (`monsterUsage.ts`): the row a landing
 * writes, built only from the server's own figures, and a write that fails
 * never reaching the landing.
 */

let failWith: Error | null = null;
const written: unknown[] = [];
mock.module("./monsterUsageStore.js", () => ({
  insertUsageRow: async (row: unknown) => {
    if (failWith) throw failWith;
    written.push(row);
  },
}));

const { recordMonsterUsage, rowFacts, usageRow } = await import("./monsterUsage.js");

const session = { attackerid: 2503, attackid: 4242, startedat: 1_795_000_000, attackerAcademy: { C1: 3, C5: 6, IC2: 2 } };
const NOW = Date.parse("2026-11-24T10:00:00Z") / 1000;

const report = (monsterId: string, level: number, sent: number, lost: number, champion = false) => ({
  monsterId,
  champion,
  level,
  sent,
  spawned: 0,
  lost,
  buildingDamage: 0,
});

describe("the row of a landed attack", () => {
  test("from a battle: each type's level and losses from the replay, champions with their level", () => {
    const row = usageRow({
      session,
      arena: "mr2",
      mode: "player",
      baseType: "main",
      defenderUserid: 77,
      battle: {
        flung: { C1: 40, C5: 6 },
        destroyed: 0,
        attackers: [report("C1", 4, 40, 31), report("C5", 6, 6, 6), report("G2", 5, 1, 0, true)],
      },
      damageBefore: 10,
      damageAfter: 63,
      now: NOW,
    });
    expect(row).toMatchObject({
      day: "2026-11-24",
      attackerUserid: 2503,
      attackStarted: 1_795_000_000,
      attackId: 4242,
      mode: "player",
      arena: "mr2",
      defenderUserid: 77,
      monsters: { C1: { l: 4, f: 40, x: 31 }, C5: { l: 6, f: 6, x: 6 } },
      champions: [{ c: "G2", l: 5 }],
      damageBefore: 10,
      damageAfter: 63,
      flattened: false,
      replayed: true,
      assumed: false,
      repeat: false,
    });
  });

  test("a yard the battle flattened is marked", () => {
    const row = usageRow({ session, arena: "mr2", mode: "camp", battle: { flung: { C1: 1 }, destroyed: 1, attackers: [] }, now: NOW });
    expect(row.flattened).toBe(true);
    // No battle row for the type: the level the attack froze at its start.
    expect(row.monsters).toEqual({ C1: { l: 3, f: 1 } });
  });

  test("with no battle: the spent monsters at the frozen academy levels, champions from the log, no losses", () => {
    const row = usageRow({
      session,
      arena: "descent",
      mode: "camp",
      tribe: "descent",
      campLevel: 4,
      battle: null,
      flung: { C5: 3, C9: 2, C2: 0 },
      log: {
        v: 1,
        seed: 1,
        events: [{ kind: "fling", t: 10, x: 1, y: 1, r: 100, monsters: { C5: 3 }, champion: { t: 3, l: 4 } }],
      },
      now: NOW,
    });
    expect(row.monsters).toEqual({ C5: { l: 6, f: 3 }, C9: { l: 1, f: 2 } });
    expect(row.replayed).toBe(false);
    expect(row.campLevel).toBe(4);
  });

  test("a camp's row names no defender", () => {
    const row = usageRow({ session, arena: "mr2", mode: "camp", defenderUserid: 1, battle: null, flung: {}, now: NOW });
    expect(row.defenderUserid).toBeNull();
  });

  test("an Inferno attack landed as its whole army is stored as assumed", () => {
    const row = usageRow({ session, arena: "inferno", mode: "player", battle: null, flung: { IC2: 12 }, assumed: true, now: NOW });
    expect(row).toMatchObject({ assumed: true, replayed: false, monsters: { IC2: { l: 2, f: 12 } } });
  });
});

describe("where a yard with a row was attacked", () => {
  test("a Map Room 2 camp: its tribe and level", () => {
    expect(rowFacts({ type: "tribe", wmid: 11, level: 34, saveuserid: 1 }, 2)).toEqual({
      arena: "mr2",
      mode: "camp",
      baseType: "tribe",
      defenderUserid: null,
      tribe: "kozu",
      campLevel: 34,
    });
  });

  test("a player's yard or outpost, on Map Room 1 or 2", () => {
    expect(rowFacts({ type: "main", saveuserid: 9 }, 1)).toMatchObject({ arena: "mr1", mode: "player", defenderUserid: 9 });
    expect(rowFacts({ type: "outpost", saveuserid: 9 }, 2)).toMatchObject({ arena: "mr2", mode: "player", baseType: "outpost" });
  });

  test("Map Room 3 (switched off, no replay) is not counted", () => {
    expect(rowFacts({ type: "main", saveuserid: 9 }, 3)).toBeNull();
  });
});

describe("recording", () => {
  test("writes the row", async () => {
    written.length = 0;
    await recordMonsterUsage({ session, arena: "mr2", mode: "player", battle: { flung: { C1: 2 }, destroyed: 0, attackers: [] }, now: NOW });
    expect(written).toHaveLength(1);
  });

  test("a write that fails is swallowed", async () => {
    failWith = new Error("database gone");
    try {
      await expect(
        recordMonsterUsage({ session, arena: "mr2", mode: "player", battle: null, flung: { C1: 2 }, now: NOW })
      ).resolves.toBeUndefined();
    } finally {
      failWith = null;
    }
  });

  test("so is a landing that hands it nonsense", async () => {
    await expect(recordMonsterUsage(null as never)).resolves.toBeUndefined();
  });
});
