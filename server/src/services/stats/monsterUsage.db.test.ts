import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";

/**
 * The dashboard's monster counts on a real Postgres: the row a landing writes
 * (`monsterUsage.ts`, written once per attack), and the Monsters tab's
 * numbers read back (`monsterUsageStats.ts`).
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * It empties `bym.monster_usage`. Account numbers from 996201; everything is
 * deleted afterwards.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

let orm: MikroORM;
mock.module("../../server.js", () => ({
  postgres: {
    get em() {
      return orm.em;
    },
  },
}));

const { insertUsageRow } = await import("./monsterUsageStore.js");
const { usageRow } = await import("./monsterUsage.js");
const { championOwnership, monsterStatsFor, periodDays } = await import("./monsterUsageStats.js");

const ANN = 996201;
const BEN = 996202;
const CAT = 996203;
const TESTER = 996204;
const IDLE = 996205;
const ALL = [ANN, BEN, CAT, TESTER, IDLE];

const NOW = Date.parse("2026-12-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (daysAgo: number) => NOW / 1000 - daysAgo * 86_400;

let attackId = 1;
const land = (userid: number, daysAgo: number, monsters: Record<string, [level: number, flung: number]>, more: Record<string, unknown> = {}) =>
  insertUsageRow(
    usageRow({
      session: { attackerid: userid, attackid: attackId++, startedat: at(daysAgo) - 60 },
      arena: "mr2",
      mode: "player",
      battle: {
        flung: Object.fromEntries(Object.entries(monsters).map(([id, [, flung]]) => [id, flung])),
        destroyed: 0,
        attackers: Object.entries(monsters).map(([monsterId, [level, sent]]) => ({
          monsterId,
          champion: false,
          level,
          sent,
          spawned: 0,
          lost: 0,
          buildingDamage: 0,
        })),
      },
      now: at(daysAgo),
      ...more,
    })
  );

describe.skipIf(!dbName)("monster counts on a real database", () => {
  const sql = <R = Record<string, unknown>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);

  const reset = async () => {
    await sql(`DELETE FROM bym.monster_usage`);
    await sql(`DELETE FROM bym.save WHERE userid IN (${ALL.join(",")})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${ALL.join(",")})`);
  };

  const player = async (userid: number, username: string, seenDaysAgo: number, champion: unknown[]) => {
    await sql(
      `INSERT INTO bym."user" (userid, username, email, password, blocked_users, terms_accepted_at, last_seen_at)
       VALUES (?, ?, ?, 'x', '[]', now(), ?)`,
      [userid, username, `${username}@test.com`, new Date(NOW - seenDaysAgo * DAY)]
    );
    await sql(
      `INSERT INTO bym.save (userid, saveuserid, baseid, type, points, basevalue, createtime, name, credits, attacks,
                             takeover_date, created_at, lastupdate_at, champion)
       VALUES (?, ?, ?, 'main', '0', '0', 0, 'yard', 0, '[]', now(), now(), now(), ?::jsonb)`,
      [userid, userid, String(9_000_000 + userid), JSON.stringify(champion)]
    );
  };

  beforeAll(async () => {
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false });
  });

  beforeEach(async () => {
    await reset();
    await player(ANN, "monstat_ann", 1, [{ t: 1, l: 6 }, { t: 5, l: 2 }]);
    await player(BEN, "monstat_ben", 2, [{ t: 2, l: 3 }]);
    await player(CAT, "monstat_cat", 3, []);
    await player(TESTER, "zz_monstat", 1, [{ t: 1, l: 1 }]);
    await player(IDLE, "monstat_idle", 90, [{ t: 3, l: 1 }]);
  });

  afterAll(async () => {
    await reset();
    await orm.close(true);
  });

  test("the same attack written twice is one row", async () => {
    const row = usageRow({
      session: { attackerid: ANN, attackid: 77, startedat: at(0) - 30 },
      arena: "mr2",
      mode: "camp",
      battle: null,
      flung: { C1: 3 },
      now: at(0),
    });
    await insertUsageRow(row);
    await insertUsageRow(row);
    expect(await sql(`SELECT monsters, mode, day::text AS day FROM bym.monster_usage WHERE attacker_userid = ?`, [ANN])).toEqual([
      { monsters: { C1: { l: 1, f: 3 } }, mode: "camp", day: "2026-12-20" },
    ]);
  });

  test("before the first attack there is nothing, and no day", async () => {
    const stats = await monsterStatsFor(orm.em.fork(), "30", NOW);
    expect(stats).toMatchObject({ since: null, daysCounted: 0, days: [], assumed: 0 });
    expect(stats.players.attacks).toBe(0);
    expect(stats.players.monsters).toHaveLength(26);
  });

  test("day 1: one day counted, every period the same day", async () => {
    await land(ANN, 0, { C1: [3, 40] });
    for (const period of ["7", "30", "all"] as const) {
      const stats = await monsterStatsFor(orm.em.fork(), period, NOW);
      expect(stats).toMatchObject({ since: "2026-12-20", daysCounted: 1, days: ["2026-12-20"] });
      expect(stats.players.daily).toEqual([40]);
    }
  });

  test("players, levels, shares and days; test accounts and assumed Inferno attacks left out", async () => {
    await land(ANN, 0, { C1: [3, 40], C5: [6, 4] });
    await land(ANN, 1, { C1: [4, 10] });
    await land(BEN, 1, { C1: [3, 5], IC2: [2, 7] });
    await land(CAT, 3, { C9: [1, 2] }, { mode: "camp", tribe: "kozu", campLevel: 34 });
    await land(CAT, 3, { C9: [1, 2] }, { mode: "camp", tribe: "kozu", campLevel: 38, repeat: true });
    await land(BEN, 2, { C2: [1, 1] }, { arena: "inferno", mode: "camp", tribe: "moloch", campLevel: 9 });
    // The practice camp has no level.
    await land(ANN, 2, { C1: [3, 1] }, { arena: "mr1", mode: "camp", tribe: "practice", campLevel: null });
    // A test account's attack, and one 40 days back (outside 30 days).
    await land(TESTER, 0, { C1: [1, 999] });
    await land(ANN, 40, { C1: [1, 1000] });
    // An Inferno attack landed as its whole army.
    await land(BEN, 0, { IC1: [1, 50] }, { arena: "inferno", battle: null, flung: { IC1: 50 }, assumed: true });
    // Champions and bombs are never in the monster list.
    await land(BEN, 0, { G2: [3, 1] });

    const stats = await monsterStatsFor(orm.em.fork(), "30", NOW);
    expect(stats.since).toBe(periodDays("all", stats.since, NOW)[0]!);
    expect(stats.daysCounted).toBe(41);
    expect(stats.days).toHaveLength(30);
    expect(stats.assumed).toBe(1);

    const players = stats.players;
    // Ann twice, Ben twice (one only a champion); the assumed one left out.
    expect(players).toMatchObject({ attacks: 4, players: 2, flung: 66 });
    const pokey = players.monsters.find((monster) => monster.id === "C1")!;
    expect(pokey).toMatchObject({ name: "Pokey", kind: "normal", maxLevel: 6, flung: 55, attacks: 3, players: 2 });
    expect(pokey.levels[2]).toEqual({ level: 3, flung: 45, attacks: 2, players: 2 });
    expect(pokey.levels[3]).toEqual({ level: 4, flung: 10, attacks: 1, players: 1 });
    expect(pokey.daily.slice(-3)).toEqual([0, 15, 40]);
    expect(players.monsters.find((monster) => monster.id === "IC2")).toMatchObject({ kind: "inferno", flung: 7 });
    expect(players.monsters.find((monster) => monster.id === "C15")!.maxLevel).toBe(5);
    expect(players.monsters.some((monster) => monster.id === "G2")).toBe(false);
    expect(players.daily.slice(-3)).toEqual([0, 22, 44]);

    // Camps: Repeat attacks counted with them; per tribe and level.
    expect(stats.camps).toMatchObject({ attacks: 4, players: 3, flung: 6 });
    expect(stats.camps.tribes.find((tribe) => tribe.key === "mr1:practice")).toMatchObject({ attacks: 1, players: 1, levels: [], range: null });
    const kozu = stats.camps.tribes.find((tribe) => tribe.key === "mr2:kozu")!;
    expect(kozu).toMatchObject({ name: "Kozu", where: "Map Room 2", attacks: 2, players: 1, only: [30, 34, 38, 42] });
    expect(kozu.levels).toEqual([
      { level: 34, attacks: 1, players: 1 },
      { level: 38, attacks: 1, players: 1 },
    ]);
    expect(stats.camps.tribes.find((tribe) => tribe.key === "inferno:moloch")).toMatchObject({ attacks: 1, range: [1, 59] });
    expect(stats.camps.tribes.find((tribe) => tribe.key === "descent:descent")).toMatchObject({ attacks: 0, range: [1, 13] });

    // 7 days and all time.
    expect((await monsterStatsFor(orm.em.fork(), "7", NOW)).days).toHaveLength(7);
    const all = await monsterStatsFor(orm.em.fork(), "all", NOW);
    expect(all.days).toHaveLength(41);
    expect(all.players.monsters.find((monster) => monster.id === "C1")!.flung).toBe(1055);
  });

  test("champions owned: by type, the players with none, active or every account", async () => {
    // The copy has other players: compare with ours taken away.
    const before = await championOwnership(orm.em.fork(), NOW);
    await sql(`DELETE FROM bym.save WHERE userid IN (${ALL.join(",")})`);
    const without = await championOwnership(orm.em.fork(), NOW);
    const diff = (scope: "active" | "every") => ({
      players: before[scope].players - without[scope].players,
      none: before[scope].none - without[scope].none,
      owned: before[scope].owned.map((one, index) => one.count - without[scope].owned[index]!.count),
    });
    // Active: Ann (Gorgo, Krallen), Ben (Drull), Cat (none); the test account never, the idle one not.
    expect(diff("active")).toEqual({ players: 3, none: 1, owned: [1, 1, 0, 0, 1] });
    expect(diff("every")).toEqual({ players: 4, none: 1, owned: [1, 1, 1, 0, 1] });
    expect(before.active.byCount[0]! - (without.active.byCount[0] ?? 0)).toBe(1);
    expect(before.active.byCount[1]! - (without.active.byCount[1] ?? 0)).toBe(1);
  });
});
