import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { getBugReport, listBugReports, updateBugReportTicket, type BugReportFilter } from "../admin/bugReportsAdmin.js";
import { acceptClientErrors } from "../errors/clientErrors.js";
import { errorTotals, listErrors, recordErrors, USERIDS_KEPT } from "../errors/errorStore.js";
import type { ActivityRedis } from "./activity.js";
import { computeDays, fillDailyStats, getDailySummary, readDailyStats, statsOverview, TRACKING_JOB } from "./dailyStats.js";

/**
 * The owner's dashboard against a real Postgres: tickets on bug reports, the
 * error store, and the daily numbers (who counts as a player, where each
 * number comes from).
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * Test accounts named `zz_*` are left out of every count by design, so the
 * players here have ordinary names (`dashtest_*`) and `@test.com` emails, and
 * account numbers from 997001; everything is deleted afterwards. The days used
 * are in January 2026, before any other test data.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

const P1 = 997001;
const P2 = 997002;
const P3 = 997003;
const TEST_ACCOUNT = 997004;
const BOT = 997005;
const OWNER = 997006;
const SEEDED = 997007;
const ALL = [P1, P2, P3, TEST_ACCOUNT, BOT, OWNER, SEEDED];

const at = (iso: string) => new Date(iso);
const NOW = Date.parse("2026-01-12T10:00:00Z");

/** The Redis reads the daily count makes, in memory. */
const fakeRedis = (sets: Record<string, string[]> = {}, counters: Record<string, number> = {}): ActivityRedis => ({
  sadd: async () => 0,
  smembers: async (key) => [...(sets[key] ?? [])],
  incrby: async () => 0,
  get: async (key) => (key in counters ? String(counters[key]) : null),
  expire: async () => 1,
});

describe.skipIf(!dbName)("the owner's dashboard on a real database", () => {
  let orm: MikroORM;
  let logDir: string;

  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);

  const reset = async () => {
    const list = ALL.join(",");
    await sql(`DELETE FROM bym.bug_report WHERE userid IN (${list}) OR message LIKE 'dashtest%'`);
    await sql(`DELETE FROM bym.event_progress WHERE userid IN (${list})`);
    await sql(`DELETE FROM bym.bot WHERE userid IN (${list})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${list})`);
    await sql(`DELETE FROM bym.app_error WHERE fingerprint LIKE 'dashtest-%' OR message LIKE 'dashtest%'`);
    await sql(`DELETE FROM bym.daily_stat WHERE day < '2026-02-01'`);
    await sql(`DELETE FROM bym.job_run WHERE job = ?`, [TRACKING_JOB]);
  };

  const player = async (userid: number, username: string, joined: string, email = `${username}@test.com`) =>
    sql(
      `INSERT INTO bym."user" (userid, username, email, password, blocked_users, terms_accepted_at, last_seen_at)
       VALUES (?, ?, ?, 'x', '[]', ?, ?)`,
      [userid, username, email, at(joined), at(joined)]
    );

  const report = async (message: string, createdAt: string, userid: number | null = null) => {
    const [row] = await sql<{ id: string }>(
      `INSERT INTO bym.bug_report (userid, message, created_at) VALUES (?, ?, ?) RETURNING id`,
      [userid, message, at(createdAt)]
    );
    return Number(row!.id);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DASHBOARD_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    logDir = mkdtempSync(join(tmpdir(), "bymr-dashtest-"));
  });

  beforeEach(reset);

  afterAll(async () => {
    await reset();
    await orm.close();
    rmSync(logDir, { recursive: true, force: true });
  });

  describe("bug report tickets", () => {
    test("a new report is `new` with no notes and no changes", async () => {
      const id = await report("dashtest broken button", "2026-01-10T08:00:00Z");
      const detail = await getBugReport(orm.em.fork(), id);
      expect(detail).toMatchObject({ status: "new", statusChangedAt: null, ownerNotes: "", notesChangedAt: null, hasNotes: false, changes: [] });
    });

    test("status and notes change, each change kept with its time; repeats write nothing", async () => {
      const id = await report("dashtest crash on load", "2026-01-10T08:00:00Z");

      const working = await updateBugReportTicket(orm.em.fork(), id, { status: "working" }, OWNER);
      expect(working).toMatchObject({ status: "working", ownerNotes: "" });
      expect(working!.statusChangedAt).not.toBeNull();

      const noted = await updateBugReportTicket(orm.em.fork(), id, { status: "working", notes: "seen on Safari only" }, OWNER);
      expect(noted).toMatchObject({ status: "working", ownerNotes: "seen on Safari only", hasNotes: true });
      expect(noted!.statusChangedAt).toBe(working!.statusChangedAt);

      const fixed = await updateBugReportTicket(orm.em.fork(), id, { status: "fixed" }, OWNER);
      await updateBugReportTicket(orm.em.fork(), id, { status: "fixed", notes: "seen on Safari only" }, OWNER);

      expect(fixed!.changes.map(({ status, notes, by }) => ({ status, notes, by }))).toEqual([
        { status: { from: "new", to: "working" }, notes: null, by: OWNER },
        { status: null, notes: "seen on Safari only", by: OWNER },
        { status: { from: "working", to: "fixed" }, notes: null, by: OWNER },
      ]);
      expect(fixed!.changes.every((change) => !Number.isNaN(Date.parse(change.at)))).toBe(true);
      const [{ n }] = (await sql<{ n: string }>(`SELECT count(*) AS n FROM bym.bug_report_change WHERE bug_report_id = ?`, [id])) as [
        { n: string },
      ];
      expect(Number(n)).toBe(3);
    });

    test("an unknown report answers null and writes nothing", async () => {
      expect(await updateBugReportTicket(orm.em.fork(), 99_999_999, { status: "fixed" }, OWNER)).toBeNull();
    });

    test("the list filters by open, closed or one status, and its changes go with the report", async () => {
      const a = await report("dashtest a", "2026-01-10T08:00:00Z");
      const b = await report("dashtest b", "2026-01-10T09:00:00Z");
      const c = await report("dashtest c", "2026-01-10T10:00:00Z");
      await updateBugReportTicket(orm.em.fork(), b, { status: "working" }, OWNER);
      await updateBugReportTicket(orm.em.fork(), c, { status: "wontfix", notes: "works as intended" }, OWNER);

      const ids = async (filter: BugReportFilter) =>
        (await listBugReports(orm.em.fork(), { filter })).reports.map((r) => r.id).filter((id) => [a, b, c].includes(id));
      expect(await ids("all")).toEqual([c, b, a]);
      expect(await ids("open")).toEqual([b, a]);
      expect(await ids("closed")).toEqual([c]);
      expect(await ids("new")).toEqual([a]);
      expect(await ids("wontfix")).toEqual([c]);
      const listed = (await listBugReports(orm.em.fork(), { filter: "closed" })).reports.find((r) => r.id === c)!;
      expect(listed).toMatchObject({ status: "wontfix", hasNotes: true, preview: "dashtest c" });

      await sql(`DELETE FROM bym.bug_report WHERE id = ?`, [c]);
      expect(await sql(`SELECT 1 FROM bym.bug_report_change WHERE bug_report_id = ?`, [c])).toEqual([]);
    });
  });

  describe("the error store", () => {
    test("one row per kind: counted, last seen moved on, a few recent account numbers kept", async () => {
      const entry = (count: number, atIso: string, userid: number | null) => ({
        source: "browser" as const,
        fingerprint: "dashtest-kind-1",
        message: "dashtest boom",
        place: "/static/index.js:1:2",
        stack: "",
        count,
        at: at(atIso),
        gameVersion: "2.0.0-beta.4",
        screen: "yard",
        userid,
      });
      await recordErrors(orm.em.fork(), [entry(2, "2026-01-10T08:00:00Z", 11)]);
      for (let i = 12; i < 12 + USERIDS_KEPT + 2; i++) await recordErrors(orm.em.fork(), [entry(1, "2026-01-10T09:00:00Z", i)]);
      await recordErrors(orm.em.fork(), [entry(1, "2026-01-10T07:00:00Z", null)]);

      const [group] = (await listErrors(orm.em.fork(), { source: "browser" })).filter((g) => g.message === "dashtest boom");
      expect(group).toMatchObject({ count: 2 + USERIDS_KEPT + 2 + 1, firstSeen: "2026-01-10T08:00:00.000Z", lastSeen: "2026-01-10T09:00:00.000Z" });
      expect(group!.userids).toHaveLength(USERIDS_KEPT);
      expect(group!.userids[0]).toBe(12 + USERIDS_KEPT + 1);
      expect((await errorTotals(orm.em.fork())).browser.kinds).toBeGreaterThanOrEqual(1);
    });

    test("a browser batch is cleaned and merged by kind before it is kept", async () => {
      const kept = await acceptClientErrors(
        orm.em.fork(),
        {
          errors: [
            { kind: "error", message: "dashtest no building 41 for me@mail.com", place: "https://x.test/static/index-AAAAAAAA.js:1:5", stack: "", count: 2 },
            { kind: "error", message: "dashtest no building 7 for me@mail.com", place: "https://x.test/static/index-BBBBBBBB.js:1:9", stack: "", count: 1 },
          ],
          gameVersion: "v",
          screen: "map",
        },
        P1,
        at("2026-01-10T08:00:00Z")
      );
      expect(kept).toBe(1);
      const rows = await sql<{ message: string; count: number; userids: number[] }>(
        `SELECT message, count, userids FROM bym.app_error WHERE message LIKE 'dashtest no building%'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.message).toBe("dashtest no building 41 for [email]");
      expect(Number(rows[0]!.count)).toBe(3);
    });
  });

  describe("the daily numbers", () => {
    const seed = async () => {
      await player(P1, "dashtest_one", "2026-01-05T10:00:00Z");
      await player(P2, "dashtest_two", "2026-01-08T23:30:00Z");
      await player(P3, "dashtest_three", "2026-01-09T00:30:00Z");
      // None of these is a player: a test account by its email, a bot, and a
      // seeded Map Room 2 dev player (a person to the game, but nobody plays it).
      await player(TEST_ACCOUNT, "dashtest_four", "2026-01-09T01:00:00Z", "four@test.invalid");
      await player(BOT, "dashtest_bot", "2026-01-09T02:00:00Z");
      await sql(`INSERT INTO bym.bot (userid, seed, persona, level, level_since, created_at) VALUES (?, 1, '{}', 1, now(), now())`, [BOT]);
      await player(SEEDED, "dashtest_seeded", "2026-01-09T03:00:00Z");
      await sql(
        `INSERT INTO bym.bot (userid, seed, persona, level, level_since, state, created_at) VALUES (?, 1, '{}', 1, now(), 'seeded', now())`,
        [SEEDED]
      );
      await sql(`INSERT INTO bym.event_progress (userid, event_id, counter, created_at) VALUES (?, 'dash-event', 1, ?)`, [P1, at("2026-01-09T05:00:00Z")]);
      await sql(`INSERT INTO bym.event_progress (userid, event_id, counter, created_at) VALUES (?, 'dash-event', 1, ?)`, [TEST_ACCOUNT, at("2026-01-09T05:00:00Z")]);
      await report("dashtest day report", "2026-01-09T12:00:00Z");
      // The dashboard started on 10 January.
      await sql(`INSERT INTO bym.job_run (job, period, ran_at) VALUES (?, 'start', ?)`, [TRACKING_JOB, at("2026-01-10T06:00:00Z")]);
      // The log file of the 9th (before the dashboard): sign-ins and a raid.
      const line = (iso: string, properties: Record<string, unknown>) => JSON.stringify({ "@timestamp": iso, properties });
      writeFileSync(
        join(logDir, "bymr-2026-01-09.jsonl"),
        [
          line("2026-01-09T03:00:00Z", { event: "login", userid: P1 }),
          line("2026-01-09T04:00:00Z", { event: "login", userid: P3 }),
          line("2026-01-09T04:30:00Z", { event: "login", userid: TEST_ACCOUNT }),
          line("2026-01-09T05:00:00Z", { event: "wild-raid", userid: P1, id: "r1" }),
        ].join("\n")
      );
    };

    const redis = fakeRedis(
      {
        "stats:active:2026-01-10": [String(P1), String(TEST_ACCOUNT)],
        "stats:active:2026-01-11": [String(P1), String(P2), String(BOT)],
        "stats:eventids:2026-01-11": ["dash-event"],
        "stats:event:2026-01-11:dash-event": [String(P1), String(TEST_ACCOUNT)],
        "stats:active:2026-01-12": [String(P3)],
      },
      { "stats:raids:2026-01-11": 3, "stats:errors:2026-01-11:browser": 5 }
    );

    test("each day from the right source, players only", async () => {
      await seed();
      const days = await computeDays({ em: orm.em.fork(), redis, logDir, logBase: "bymr" }, ["2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11"], "2026-01-10");
      const [d8, d9, d10, d11] = days;

      expect(d8).toMatchObject({ newPlayers: 1, activePlayers: null, activeSource: null, tribeRaids: null, eventPlayers: null, browserErrors: null });
      expect(d9).toMatchObject({
        newPlayers: 1,
        activePlayers: 2,
        activeSource: "logs",
        tribeRaids: 1,
        eventNewPlayers: { "dash-event": 1 },
        bugReports: 1,
        eventPlayers: null,
      });
      expect(d9!.totalPlayers - d8!.totalPlayers).toBe(1);
      // The dashboard's first day, with no log file: only part of it was recorded.
      expect(d10).toMatchObject({ activePlayers: 1, activeSource: "partial", tribeRaids: 0, browserErrors: 0 });
      expect(d11).toMatchObject({
        activePlayers: 2,
        activeSource: "tracked",
        tribeRaids: 3,
        eventPlayers: { "dash-event": 1 },
        browserErrors: 5,
        serverErrors: 0,
      });
    });

    test("finished days are stored once; the summary and the front page read them", async () => {
      await seed();
      const deps = { em: orm.em.fork(), redis, logDir, logBase: "bymr" };
      const written = await fillDailyStats(deps, NOW);
      expect(written).toEqual(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11"]);
      expect(await fillDailyStats(deps, NOW)).toEqual([]);
      const stored = await readDailyStats(orm.em.fork(), "2026-01-09", "2026-01-11");
      expect(stored.map((d) => d.activePlayers)).toEqual([2, 1, 2]);

      const summary = await getDailySummary("2026-01-09", deps, NOW);
      expect(summary.stat).toMatchObject({ day: "2026-01-09", newPlayers: 1, bugReports: 1 });
      expect(summary.bugReports.map((r) => r.text)).toEqual(["dashtest day report"]);
      expect(Object.keys(summary.bugReports[0]!).sort()).toEqual(["id", "text"]);
      expect(summary.openBugReports).toBeGreaterThanOrEqual(1);
      expect(summary.players.total).toBeGreaterThanOrEqual(3);
      await expect(getDailySummary("2026-01-12", deps, NOW)).rejects.toThrow(/not over/);

      const overview = await statsOverview(deps, 7, NOW);
      expect(overview.today).toMatchObject({ day: "2026-01-12", activePlayers: 1, activeSource: "tracked" });
      expect(overview.days.map((d) => d.day)).toEqual(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11"]);
    });
  });
});
