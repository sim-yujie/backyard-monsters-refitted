import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { recordChatFlag } from "../chat/chatFlags.js";
import { recordChatReport } from "../chat/chatReports.js";
import { actOnCase } from "./chatCases.js";
import type { ModerationEffects } from "./moderation.js";
import { actOnInboxPlayer, listClosed, listInbox, moderatePlayer } from "./moderationInbox.js";

/**
 * The moderation inbox against a real Postgres: one row per player from
 * every source, and one step (wherever it is taken) closes everything open
 * against them: the chat case, its reports and their word-filter lines.
 * Evidence newer than what the owner was shown stays open.
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * Players are `inboxtest_*`, account numbers from 996201; everything is
 * deleted afterwards.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

const OFFENDER = 996201;
const SWEARER = 996202;
const REPORTER_A = 996203;
const REPORTER_B = 996204;
const OWNER = 996209;
const ALL = [OFFENDER, SWEARER, REPORTER_A, REPORTER_B, OWNER];
const LIST = ALL.join(",");
const ROOM = "chat:test-inbox";
const T0 = Date.parse("2026-11-08T09:00:00Z");

describe.skipIf(!dbName)("the moderation inbox on a real database", () => {
  let orm: MikroORM;
  const calls: string[] = [];
  const effects: ModerationEffects = {
    endSessions: async (user) => void calls.push(`endSessions ${user.userid}`),
    kickFromChat: async (userid) => void calls.push(`kick ${userid}`),
    muteInChat: async (userid) => void calls.push(`mute ${userid}`),
    nudge: async (userid) => void calls.push(`nudge ${userid}`),
  };
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);

  const report = (reporter: number, reported: number, i: number) =>
    recordChatReport(orm.em.fork(), { reporter, reported, channel: ROOM, message: `rude line ${i}`, ts: T0 + i * 1000 }, []);
  const flag = (userid: number, i: number, severity: "slur" | "swear" = "swear") =>
    recordChatFlag(orm.em.fork(), {
      userid,
      channel: ROOM,
      message: `bad word ${i}`,
      shown: "bad ****",
      words: ["word"],
      severity,
      rule: "word",
      ts: T0 + i * 1000,
    });
  const ours = async (source: "all" | "reports" | "filter" = "all") =>
    (await listInbox(orm.em.fork(), { source, limit: 100 })).players.filter((p) => ALL.includes(p.userid));
  const row = async (userid: number) => (await ours()).find((p) => p.userid === userid) ?? null;
  const openFlags = async (userid: number) =>
    Number((await sql<{ n: string }>(`SELECT count(*) AS n FROM bym.chat_flag WHERE userid = ? AND dismissed_at IS NULL`, [userid]))[0]!.n);
  const cases = (userid: number) =>
    sql<{ status: string; outcome: string | null; mute_hours: number | null; moderation_action_id: string | null }>(
      `SELECT status, outcome, mute_hours, moderation_action_id FROM bym.chat_case WHERE reported_id = ? ORDER BY id`,
      [userid],
    );
  const steps = (userid: number) =>
    sql<{ action: string; chat_report_id: string | null }>(
      `SELECT action, chat_report_id FROM bym.moderation_action WHERE userid = ? ORDER BY id`,
      [userid],
    );

  const reset = async () => {
    await sql(`DELETE FROM bym.chat_case_message WHERE reported_id IN (${LIST})`);
    await sql(`DELETE FROM bym.chat_case WHERE reported_id IN (${LIST})`);
    await sql(`DELETE FROM bym.chat_report WHERE reporter_id IN (${LIST}) OR reported_id IN (${LIST})`);
    await sql(`DELETE FROM bym.chat_flag WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.moderation_action WHERE userid IN (${LIST})`);
    await sql(`UPDATE bym.thread SET last_message_id = NULL WHERE userid IN (${LIST}) OR targetid IN (${LIST})`);
    await sql(`DELETE FROM bym.message WHERE userid IN (${LIST}) OR targetid IN (${LIST})`);
    await sql(`DELETE FROM bym.thread WHERE userid IN (${LIST}) OR targetid IN (${LIST})`);
    await sql(`UPDATE bym."user" SET banned = false, ban_until = NULL, ban_reason = NULL, mute_until = NULL WHERE userid IN (${LIST})`);
    calls.length = 0;
  };

  const savedAdmins = process.env.ADMIN_USER_IDS;

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DASHBOARD_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    for (const userid of ALL) {
      const name = `inboxtest_${userid}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, name, `${name}@test.invalid`],
      );
    }
  });

  beforeEach(async () => {
    process.env.ADMIN_USER_IDS = String(OWNER);
    await reset();
  });

  afterAll(async () => {
    if (savedAdmins === undefined) delete process.env.ADMIN_USER_IDS;
    else process.env.ADMIN_USER_IDS = savedAdmins;
    if (!orm) return;
    await reset();
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await orm.close();
  });

  test("one row per player, counting reported lines, reports, reporters and filter lines, slurs first", async () => {
    await report(REPORTER_A, OFFENDER, 1);
    await report(REPORTER_B, OFFENDER, 1);
    await report(REPORTER_A, OFFENDER, 2);
    await flag(OFFENDER, 3);
    await flag(OFFENDER, 4);
    await flag(SWEARER, 5, "slur");

    const players = await ours();
    expect(players.map((p) => p.userid)).toEqual([SWEARER, OFFENDER]);
    const offender = players[1]!;
    expect(offender.caseId).not.toBeNull();
    expect(offender).toMatchObject({ reportedMessages: 2, reports: 3, uniqueReporters: 2, filterLines: 2, slurs: 0, previousActions: 0 });
    expect(offender.suggest).toEqual({ action: "mute", hours: 24 });
    expect(players[0]).toMatchObject({ caseId: null, reports: 0, filterLines: 1, slurs: 1 });

    expect((await ours("reports")).map((p) => p.userid)).toEqual([OFFENDER]);
    // Each player is in one list: the offender was reported, so not under Word filter too.
    expect((await ours("filter")).map((p) => p.userid)).toEqual([SWEARER]);
  });

  describe("a line both reported and caught by the word filter is one item, counted once (owner, 8 Nov 2026)", () => {
    const counts = async () => (await listInbox(orm.em.fork(), { limit: 100 })).counts;

    test("in the lists and every count", async () => {
      const before = await counts();
      // Line 1: reported by two players AND caught by the filter (same chat stamp).
      await report(REPORTER_A, OFFENDER, 1);
      await report(REPORTER_B, OFFENDER, 1);
      await flag(OFFENDER, 1);

      const offender = (await row(OFFENDER))!;
      expect(offender).toMatchObject({
        reportedMessages: 1,
        reports: 2,
        uniqueReporters: 2,
        filterLines: 1,
        alsoReported: 1,
        filterOnlyLines: 0,
        messages: 1,
      });
      // Under Player reports, never under Word filter as well.
      expect((await ours("reports")).map((p) => p.userid)).toEqual([OFFENDER]);
      expect((await ours("filter")).map((p) => p.userid)).toEqual([]);
      const after = await counts();
      expect(after.all - before.all).toBe(1);
      expect(after.reports - before.reports).toBe(1);
      expect(after.filter - before.filter).toBe(0);
      expect(after.reports + after.filter).toBe(after.all);
    });

    test("a reported line, the same line caught, and another caught line make two lines", async () => {
      await report(REPORTER_A, OFFENDER, 1);
      await flag(OFFENDER, 1);
      await flag(OFFENDER, 2);
      expect(await row(OFFENDER)).toMatchObject({
        reportedMessages: 1,
        filterLines: 2,
        alsoReported: 1,
        filterOnlyLines: 1,
        messages: 2,
      });
      expect((await ours("filter")).map((p) => p.userid)).toEqual([]);
    });

    test("closing says the caught copy of a reported line was not a second item", async () => {
      await report(REPORTER_A, OFFENDER, 1);
      await report(REPORTER_B, OFFENDER, 1);
      await flag(OFFENDER, 1);
      await flag(OFFENDER, 2);
      const seen = (await row(OFFENDER))!;
      const done = await actOnInboxPlayer(
        orm.em.fork(),
        OFFENDER,
        { kind: "warn", reason: "Be nice" },
        { caseId: seen.caseId, reports: seen.reports, flagsUpTo: seen.flagsUpTo },
        OWNER,
        effects,
      );
      expect(done).toMatchObject({ outcome: "done", closed: { reports: 2, filterLines: 2, filterOnlyLines: 1 } });
    });

    test("the Closed list shows the decision once, its lines counted once", async () => {
      await report(REPORTER_A, OFFENDER, 1);
      await flag(OFFENDER, 1);
      await flag(OFFENDER, 2);
      const seen = (await row(OFFENDER))!;
      await actOnInboxPlayer(
        orm.em.fork(),
        OFFENDER,
        { kind: "dismiss", note: "Banter" },
        { caseId: seen.caseId, reports: seen.reports, flagsUpTo: seen.flagsUpTo },
        OWNER,
        effects,
      );
      const closed = await listClosed(orm.em.fork(), { userid: OFFENDER });
      expect(closed.count).toBe(1);
      expect(closed.decisions).toHaveLength(1);
      expect(closed.decisions[0]).toMatchObject({
        userid: OFFENDER,
        caseId: seen.caseId,
        outcome: "dismiss",
        note: "Banter",
        closedBy: OWNER,
        reportedMessages: 1,
        reports: 1,
        alsoReported: 1,
        filterOnlyLines: 1,
        messages: 2,
      });
      expect(closed.decisions[0]!.flagLines.map((l) => l.ts)).toEqual([T0 + 1000, T0 + 2000]);
    });

    test("word-filter lines closed on their own are a decision with the step taken", async () => {
      await flag(SWEARER, 3);
      const seen = (await row(SWEARER))!;
      await actOnInboxPlayer(
        orm.em.fork(),
        SWEARER,
        { kind: "mute", reason: "Language", hours: 24 },
        { caseId: null, reports: 0, flagsUpTo: seen.flagsUpTo },
        OWNER,
        effects,
      );
      const closed = await listClosed(orm.em.fork(), { userid: SWEARER });
      expect(closed.decisions).toEqual([
        expect.objectContaining({ caseId: null, outcome: "mute", hours: 24, note: "Language", messages: 1, filterOnlyLines: 1, reports: 0 }),
      ]);
    });
  });

  test("acting on a chat case also sets the player's word-filter lines aside", async () => {
    await report(REPORTER_A, OFFENDER, 1);
    await flag(OFFENDER, 2);
    await flag(OFFENDER, 3);
    const caseId = (await row(OFFENDER))!.caseId!;
    const done = await actOnCase(orm.em.fork(), caseId, { kind: "mute", reason: "Be nice", hours: 24 }, OWNER, effects);
    expect(done.outcome).toBe("done");
    expect(await openFlags(OFFENDER)).toBe(0);
    expect(await row(OFFENDER)).toBeNull();
  });

  test("a warning from the player's own panel closes their open case and their filter lines", async () => {
    await report(REPORTER_A, OFFENDER, 1);
    await report(REPORTER_B, OFFENDER, 1);
    await flag(OFFENDER, 2);
    const { done, closed } = await moderatePlayer(
      orm.em.fork(),
      OFFENDER,
      { kind: "warn", reason: "Keep chat friendly", length: null, chatReportId: null },
      OWNER,
      effects,
    );
    expect(done.outcome).toBe("done");
    expect(closed).toMatchObject({ reports: 2, filterLines: 1 });
    const [closedCase] = await cases(OFFENDER);
    expect(closedCase).toMatchObject({ status: "actioned", outcome: "warn" });
    expect(closedCase!.moderation_action_id).not.toBeNull();
    // The step is linked to the case's first report.
    const [step] = await steps(OFFENDER);
    expect(step!.action).toBe("warn");
    expect(step!.chat_report_id).not.toBeNull();
    expect(await row(OFFENDER)).toBeNull();
  });

  test("lifting a pause closes nothing", async () => {
    await sql(`UPDATE bym."user" SET mute_until = now() + interval '1 hour' WHERE userid = ?`, [OFFENDER]);
    await report(REPORTER_A, OFFENDER, 1);
    const { done, closed } = await moderatePlayer(
      orm.em.fork(),
      OFFENDER,
      { kind: "unmute", reason: "", length: null, chatReportId: null },
      OWNER,
      effects,
    );
    expect(done.outcome).toBe("done");
    expect(closed).toBeNull();
    expect((await row(OFFENDER))?.caseId).not.toBeNull();
  });

  test("warn + pause from the inbox closes the case and the lines shown; a newer line stays open", async () => {
    await report(REPORTER_A, OFFENDER, 1);
    await flag(OFFENDER, 2);
    const shown = (await row(OFFENDER))!;
    await flag(OFFENDER, 3);

    const done = await actOnInboxPlayer(
      orm.em.fork(),
      OFFENDER,
      { kind: "mute", reason: "Be nice", hours: 24 },
      { caseId: shown.caseId, reports: shown.reports, flagsUpTo: shown.flagsUpTo },
      OWNER,
      effects,
    );
    expect(done.outcome).toBe("done");
    if (done.outcome !== "done") return;
    expect(done.closed).toMatchObject({ caseId: shown.caseId, reports: 1, filterLines: 1 });
    expect(done.player).toMatchObject({ caseId: null, filterLines: 1 });
    expect((await cases(OFFENDER))[0]).toMatchObject({ status: "actioned", outcome: "mute", mute_hours: 24 });
    expect(calls).toEqual([`mute ${OFFENDER}`, `nudge ${OFFENDER}`]);
  });

  test("a report that came in while the owner was reading is not closed under the older decision", async () => {
    await report(REPORTER_A, OFFENDER, 1);
    const shown = (await row(OFFENDER))!;
    await report(REPORTER_B, OFFENDER, 1);
    const done = await actOnInboxPlayer(
      orm.em.fork(),
      OFFENDER,
      { kind: "warn", reason: "Be nice" },
      { caseId: shown.caseId, reports: shown.reports, flagsUpTo: shown.flagsUpTo },
      OWNER,
      effects,
    );
    expect(done.outcome).toBe("changed");
    expect(await steps(OFFENDER)).toEqual([]);
    expect((await cases(OFFENDER))[0]!.status).toBe("open");
  });

  test("dismissing closes everything with nothing done to the player; a second press does nothing", async () => {
    await report(REPORTER_A, OFFENDER, 1);
    await flag(OFFENDER, 2);
    const shown = (await row(OFFENDER))!;
    const seen = { caseId: shown.caseId, reports: shown.reports, flagsUpTo: shown.flagsUpTo };
    const done = await actOnInboxPlayer(orm.em.fork(), OFFENDER, { kind: "dismiss", note: "Banter" }, seen, OWNER, effects);
    expect(done.outcome).toBe("done");
    expect((await cases(OFFENDER))[0]).toMatchObject({ status: "dismissed", outcome: "dismiss", moderation_action_id: null });
    expect(await openFlags(OFFENDER)).toBe(0);
    expect(await steps(OFFENDER)).toEqual([]);
    expect(calls).toEqual([]);

    const again = await actOnInboxPlayer(orm.em.fork(), OFFENDER, { kind: "dismiss", note: null }, seen, OWNER, effects);
    expect(again.outcome).toBe("nothingOpen");
  });

  test("a ban from the inbox closes a filter-only player's lines, and a case with outcome ban", async () => {
    await flag(SWEARER, 1, "slur");
    const swearer = (await row(SWEARER))!;
    const banned = await actOnInboxPlayer(
      orm.em.fork(),
      SWEARER,
      { kind: "ban", reason: "Slurs", days: 7 },
      { caseId: null, reports: 0, flagsUpTo: swearer.flagsUpTo },
      OWNER,
      effects,
    );
    expect(banned.outcome).toBe("done");
    expect(await openFlags(SWEARER)).toBe(0);
    expect(calls).toEqual([`endSessions ${SWEARER}`, `kick ${SWEARER}`]);

    await report(REPORTER_A, OFFENDER, 1);
    const offender = (await row(OFFENDER))!;
    const done = await actOnInboxPlayer(
      orm.em.fork(),
      OFFENDER,
      { kind: "ban", reason: "Threats", days: null },
      { caseId: offender.caseId, reports: offender.reports, flagsUpTo: null },
      OWNER,
      effects,
    );
    expect(done.outcome).toBe("done");
    expect((await cases(OFFENDER))[0]).toMatchObject({ status: "actioned", outcome: "ban" });
  });

  test("a game team account is refused and nothing is closed", async () => {
    await report(REPORTER_A, OWNER, 1);
    const owner = (await row(OWNER))!;
    expect(owner.gameTeam).toBe(true);
    const done = await actOnInboxPlayer(
      orm.em.fork(),
      OWNER,
      { kind: "warn", reason: "x" },
      { caseId: owner.caseId, reports: owner.reports, flagsUpTo: null },
      OWNER,
      effects,
    );
    expect(done.outcome).toBe("gameTeam");
    expect((await cases(OWNER))[0]!.status).toBe("open");
  });
});
