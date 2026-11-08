import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { parseAttackLogQuery, playerAttackLog, type AttackLogQuery } from "./attackLogAdmin.js";

/**
 * The dashboard's Attack log against a real Postgres: attacks a player made
 * and attacks on them, newest first and paged, the range, the summary (who
 * they attack most, who attacks them most), bots marked, a renamed player
 * shown by their name now, an attack on themselves listed once, a gone
 * account still readable, and every read on one side's index.
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * Players are `atklogtest_*`, account numbers from 997201; everything is
 * deleted afterwards.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

const ME = 997201;
const BULLY = 997202;
const FRIEND = 997203;
const BOT = 997204;
const GONE = 997205;
const USERS = [ME, BULLY, FRIEND, BOT];
const ALL = [...USERS, GONE];
const LIST = ALL.join(",");
const NOW = new Date("2026-11-08T12:00:00Z");
const HOUR = 60 * 60 * 1000;

const query = (over: Partial<AttackLogQuery> = {}): AttackLogQuery => ({
  userid: ME,
  side: "both",
  range: "all",
  limit: 50,
  before: null,
  ...over,
});

describe.skipIf(!dbName)("the dashboard's attack log on a real database", () => {
  let orm: MikroORM;
  const sql = <R = Record<string, any>>(text: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(text, params);

  const attack = (attacker: number, attackerName: string, defender: number, defenderName: string, hoursAgo: number, type = "main") =>
    sql(
      `INSERT INTO bym.attack_logs (attacker_userid, attacker_username, defender_userid, defender_username, type, x, y, loot, attackreport, attacktime)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?)`,
      [
        attacker,
        attackerName,
        defender,
        defenderName,
        type,
        type === "outpost" ? 120 : null,
        type === "outpost" ? 45 : null,
        "{}",
        "{}",
        new Date(NOW.getTime() - hoursAgo * HOUR),
      ],
    );

  const clean = async () => {
    await sql(`DELETE FROM bym.attack_logs WHERE attacker_userid IN (${LIST}) OR defender_userid IN (${LIST})`);
    await sql(`DELETE FROM bym.bot WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DASHBOARD_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    await clean();
    for (const userid of USERS) {
      const name = `atklogtest_${userid}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]')`,
        [userid, name, `${name}@test.invalid`],
      );
    }
    await sql(`INSERT INTO bym.bot (userid, seed, persona, level, level_since, state) VALUES (?, 1, 'army', 10, now(), 'active')`, [BOT]);

    // The bully hits ME six times in the last two days (once on an outpost, and
    // once under an old name); ME hits the friend twice and the bot once; the
    // bot hits ME once; a gone account hit ME 40 days ago; ME once attacked
    // their own yard.
    for (let i = 0; i < 6; i++) {
      await attack(BULLY, i === 5 ? "old_bully_name" : `atklogtest_${BULLY}`, ME, `atklogtest_${ME}`, 1 + i * 5, i === 2 ? "outpost" : "main");
    }
    await attack(ME, `atklogtest_${ME}`, FRIEND, `atklogtest_${FRIEND}`, 3);
    await attack(ME, `atklogtest_${ME}`, FRIEND, `atklogtest_${FRIEND}`, 30);
    await attack(ME, `atklogtest_${ME}`, BOT, `atklogtest_${BOT}`, 50);
    await attack(BOT, `atklogtest_${BOT}`, ME, `atklogtest_${ME}`, 2);
    await attack(GONE, "long_gone", ME, `atklogtest_${ME}`, 40 * 24);
    await attack(ME, `atklogtest_${ME}`, ME, `atklogtest_${ME}`, 4);
  });

  afterAll(async () => {
    if (!orm) return;
    await clean();
    await orm.close();
  });

  test("both sides, newest first, with the summary for the whole range", async () => {
    const log = (await playerAttackLog(orm.em.fork(), query(), NOW, 365))!;
    expect(log.player).toEqual({ userid: ME, username: `atklogtest_${ME}`, bot: false, gone: false });
    // 6 bully + 1 bot + 1 gone + 1 self received; 2 friend + 1 bot + 1 self made.
    expect(log.summary).toMatchObject({ made: 4, received: 9, targets: 3, attackers: 4 });
    expect(log.summary.topAttackers[0]).toMatchObject({ userid: BULLY, count: 6, bot: false, username: `atklogtest_${BULLY}` });
    expect(log.summary.topAttackers.find((t) => t.userid === BOT)).toMatchObject({ bot: true, count: 1 });
    expect(log.summary.topAttackers.find((t) => t.userid === GONE)).toMatchObject({ gone: true, username: "long_gone" });
    expect(log.summary.topTargets[0]).toMatchObject({ userid: FRIEND, count: 2 });

    // The attack on themselves is listed once: 12 rows, not 13.
    expect(log.attacks).toHaveLength(12);
    const times = log.attacks.map((a) => Date.parse(a.time));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(log.attacks.filter((a) => a.other.userid === ME)).toHaveLength(1);
    expect(log.next).toBeNull();

    const outpost = log.attacks.find((a) => a.type === "outpost")!;
    expect(outpost).toMatchObject({ direction: "received", x: 120, y: 45, loot: {}, report: {} });
    const renamed = log.attacks.find((a) => a.otherLoggedName === "old_bully_name")!;
    expect(renamed.other).toMatchObject({ userid: BULLY, username: `atklogtest_${BULLY}` });
    expect(log.attacks.find((a) => a.other.userid === BOT)).toMatchObject({ other: { bot: true } });
  });

  test("one side only, and the range", async () => {
    const made = (await playerAttackLog(orm.em.fork(), query({ side: "made" }), NOW, 365))!;
    expect(made.attacks.map((a) => a.direction)).toEqual(["made", "made", "made", "made"]);
    const received = (await playerAttackLog(orm.em.fork(), query({ side: "received", range: "24h" }), NOW, 365))!;
    expect(received.attacks.every((a) => a.direction === "received")).toBe(true);
    // In the last day: the bully at 1, 6, 11, 16 and 21 h, the bot at 2 h, ME at 4 h.
    expect(received.attacks).toHaveLength(7);
    expect(received.summary.received).toBe(7);
    expect(received.summary.made).toBe(2);
  });

  test("pages through the log with the cursor, nothing twice and nothing missed", async () => {
    const seen: number[] = [];
    let before: AttackLogQuery["before"] = null;
    for (let page = 0; page < 10; page++) {
      const log = (await playerAttackLog(orm.em.fork(), query({ limit: 5, before }), NOW, 365))!;
      seen.push(...log.attacks.map((a) => a.id));
      if (!log.next) break;
      // The cursor goes back through the query string as the page sends it.
      const parsed = parseAttackLogQuery(String(ME), { beforeTime: log.next.time, beforeId: String(log.next.id), limit: "5" });
      expect(parsed.ok).toBe(true);
      before = parsed.ok ? parsed.value.before : null;
    }
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  test("a gone account's log is still readable; an unknown number is null", async () => {
    const gone = (await playerAttackLog(orm.em.fork(), query({ userid: GONE }), NOW, 365))!;
    expect(gone.player).toEqual({ userid: GONE, username: "long_gone", bot: false, gone: true });
    expect(gone.attacks).toHaveLength(1);
    expect(await playerAttackLog(orm.em.fork(), query({ userid: 997299 }), NOW, 365)).toBeNull();
  });

  test("the reads use the attacker and defender indexes", async () => {
    // Plans with sequential scans off: any read that could not use an index would still show a Seq Scan.
    await orm.em.fork().transactional(async (em) => {
    await em.execute("SET LOCAL enable_seqscan = off");
    for (const column of ["attacker_userid", "defender_userid"]) {
      const plan = await em.execute<{ "QUERY PLAN": string }[]>(
        `EXPLAIN SELECT id FROM bym.attack_logs WHERE ${column} = ? AND attacktime >= ? ORDER BY attacktime DESC, id DESC LIMIT 51`,
        [ME, new Date(NOW.getTime() - 7 * 24 * HOUR)],
      );
      const text = plan.map((row) => row["QUERY PLAN"]).join("\n");
      expect(text).not.toContain("Seq Scan");
      expect(text).toContain(column);
    }
    });
  });
});
