import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import type { HistoryEntry } from "../../chat/chatProtocol.js";
import { AllianceMessageType } from "../../enums/Alliance.js";
import ormConfig from "../../mikro-orm.config.js";
import { recordChatReport } from "../chat/chatReports.js";
import { actOnCase, awardReporters, getChatCase, listChatCases, parseCaseAction, parseCaseAward, SNAPSHOT_AFTER } from "./chatCases.js";
import type { ModerationEffects } from "./moderation.js";

/**
 * Chat report cases against a real Postgres: reports of the same line, and
 * a player's other lines while the case is open, make one case; each line
 * keeps a text copy of the room, which outlives the chat log; the owner's
 * step closes the case once, through the moderation tools; reporters get
 * Shiny once per case.
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * Players are `casetest_*`, account numbers from 996101; everything is
 * deleted afterwards.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

const OFFENDER = 996101;
const REPORTER_A = 996102;
const REPORTER_B = 996103;
const REPORTER_C = 996104;
const BYSTANDER = 996105;
const OWNER = 996109;
const ALL = [OFFENDER, REPORTER_A, REPORTER_B, REPORTER_C, BYSTANDER, OWNER];
const LIST = ALL.join(",");
const ROOM = "chat:test-cases";
const START_SHINY = 100;
const T0 = Date.parse("2026-11-04T09:00:00Z");
/** A minute ago: reports are stamped with the database clock, so the owner acts just before them. */
const NOW = new Date(Date.now() - 60_000);

describe.skipIf(!dbName)("chat report cases on a real database", () => {
  let orm: MikroORM;
  const calls: string[] = [];
  const effects: ModerationEffects = {
    endSessions: async (user) => void calls.push(`endSessions ${user.userid}`),
    kickFromChat: async (userid) => void calls.push(`kick ${userid}`),
    muteInChat: async (userid, until) => void calls.push(`mute ${userid} ${until}`),
    nudge: async (userid) => void calls.push(`nudge ${userid}`),
  };
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);

  /** A chat log line said at `T0 + i` seconds. */
  const say = (userid: number, i: number, message: string) =>
    sql(`INSERT INTO bym.chat_log (userid, channel, message, shown, flagged, created_at) VALUES (?, ?, ?, ?, NULL, ?)`, [
      userid,
      ROOM,
      message,
      message.replace(/rude/g, "****"),
      new Date(T0 + i * 1000),
    ]);
  const report = (reporter: number, i: number, message = `line ${i}`, history: HistoryEntry[] = []) =>
    recordChatReport(orm.em.fork(), { reporter, reported: OFFENDER, channel: ROOM, message, ts: T0 + i * 1000 }, history);
  const entry = (userid: number, i: number, body: string): HistoryEntry => ({
    userId: userid,
    displayName: `casetest_${userid}`,
    picSquare: null,
    allianceImage: null,
    body,
    messageType: AllianceMessageType.MESSAGE,
    ts: T0 + i * 1000,
  });
  const open = async () => (await listChatCases(orm.em.fork(), { status: "open" }, NOW)).cases.filter((c) => c.reported.userid === OFFENDER);
  const credits = async (userid: number) =>
    Number((await sql<{ credits: number }>(`SELECT credits FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]))[0]!.credits);

  const reset = async () => {
    await sql(`DELETE FROM bym.chat_case_message WHERE reported_id IN (${LIST})`);
    await sql(`DELETE FROM bym.chat_case WHERE reported_id IN (${LIST})`);
    await sql(`DELETE FROM bym.chat_report WHERE reporter_id IN (${LIST}) OR reported_id IN (${LIST})`);
    await sql(`DELETE FROM bym.chat_log WHERE channel = ?`, [ROOM]);
    await sql(`DELETE FROM bym.chat_flag WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.moderation_action WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.shiny_award WHERE userid IN (${LIST})`);
    await sql(`UPDATE bym.thread SET last_message_id = NULL WHERE userid IN (${LIST}) OR targetid IN (${LIST})`);
    await sql(`DELETE FROM bym.message WHERE userid IN (${LIST}) OR targetid IN (${LIST})`);
    await sql(`DELETE FROM bym.thread WHERE userid IN (${LIST}) OR targetid IN (${LIST})`);
    await sql(`UPDATE bym."user" SET banned = false, ban_until = NULL, ban_reason = NULL, mute_until = NULL WHERE userid IN (${LIST})`);
    await sql(`UPDATE bym.save SET credits = ? WHERE userid IN (${LIST})`, [START_SHINY]);
    calls.length = 0;
  };

  const savedAdmins = process.env.ADMIN_USER_IDS;

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DASHBOARD_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    for (const userid of ALL) {
      const name = `casetest_${userid}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, name, `${name}@test.invalid`],
      );
      const [existing] = await sql<{ basesaveid: number }>(`SELECT basesaveid FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]);
      const basesaveid =
        existing?.basesaveid ??
        (
          await sql<{ basesaveid: number }>(
            `INSERT INTO bym.save (userid, saveuserid, baseid, type, points, basevalue, createtime, name, credits, attacks,
                                   takeover_date, created_at, lastupdate_at)
             VALUES (?, ?, ?, 'main', '0', '0', 0, 'yard', ?, '[]', now(), now(), now()) RETURNING basesaveid`,
            [userid, userid, `${userid}00`, START_SHINY],
          )
        )[0]!.basesaveid;
      await sql(`UPDATE bym."user" SET save_basesaveid = ? WHERE userid = ?`, [basesaveid, userid]);
    }
  });

  beforeEach(async () => {
    process.env.ADMIN_USER_IDS = String(OWNER);
    await reset();
  });

  afterEach(() => {
    if (savedAdmins === undefined) delete process.env.ADMIN_USER_IDS;
    else process.env.ADMIN_USER_IDS = savedAdmins;
  });

  afterAll(async () => {
    if (!orm) return;
    await reset();
    await sql(`UPDATE bym."user" SET save_basesaveid = NULL WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.save WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await orm.close();
  });

  test("three reports of one line make one case with three reporters, first one marked", async () => {
    await say(OFFENDER, 20, "you are rude");
    await report(REPORTER_A, 20);
    await report(REPORTER_B, 20);
    await report(REPORTER_C, 20);
    const cases = await open();
    expect(cases).toHaveLength(1);
    const [only] = cases;
    expect(only!.messages).toHaveLength(1);
    expect(only!.messages[0]!.reporters).toEqual([REPORTER_A, REPORTER_B, REPORTER_C]);
    expect(only!.reports).toBe(3);
    expect(only!.reporters.map((r) => [r.userid, r.first])).toEqual([
      [REPORTER_A, true],
      [REPORTER_B, false],
      [REPORTER_C, false],
    ]);
    expect(only!.suggest).toEqual({ action: "warn", hours: null });
  });

  test("a second reported line of the same player joins the open case and suggests a pause", async () => {
    await report(REPORTER_A, 20);
    await report(REPORTER_B, 40);
    const cases = await open();
    expect(cases).toHaveLength(1);
    expect(cases[0]!.messages.map((m) => m.ts)).toEqual([T0 + 20_000, T0 + 40_000]);
    expect(cases[0]!.suggest).toEqual({ action: "mute", hours: 24 });
  });

  test("the copy of the room: 10 lines before and the own words from the chat log, completed while open, kept after the log goes", async () => {
    for (let i = 0; i < 12; i++) await say(i % 2 ? BYSTANDER : REPORTER_A, i, `before ${i}`);
    await say(OFFENDER, 20, "you are rude");
    await say(BYSTANDER, 21, "after 1");
    await say(REPORTER_A, 22, "after 2");
    await report(REPORTER_A, 20);

    let [only] = await open();
    let lines = only!.messages[0]!.snapshot.lines;
    expect(only!.messages[0]!.snapshot.source).toBe("log");
    expect(lines).toHaveLength(13);
    expect(lines[0]!.text).toBe("before 2");
    expect(lines[10]).toMatchObject({ userid: OFFENDER, text: "you are rude", reported: true, name: `casetest_${OFFENDER}` });
    expect(lines.filter((l) => l.reported)).toHaveLength(1);

    for (let i = 23; i < 30; i++) await say(BYSTANDER, i, `later ${i}`);
    [only] = await open();
    lines = only!.messages[0]!.snapshot.lines;
    expect(lines).toHaveLength(10 + 1 + SNAPSHOT_AFTER);
    expect(lines.at(-1)!.text).toBe("later 25");

    await sql(`DELETE FROM bym.chat_log WHERE channel = ?`, [ROOM]);
    [only] = await open();
    expect(only!.messages[0]!.snapshot.lines).toHaveLength(16);
  });

  test("with the line not in the chat log yet, the copy comes from the room's own lines, starred out", async () => {
    const history = [entry(BYSTANDER, 18, "hi"), entry(OFFENDER, 20, "you are ****"), entry(REPORTER_A, 21, "hey!")];
    await report(REPORTER_A, 20, "you are rude", history);
    const [only] = await open();
    expect(only!.messages[0]!.snapshot).toEqual({
      source: "room",
      lines: [
        { userid: BYSTANDER, name: `casetest_${BYSTANDER}`, text: "hi", at: T0 + 18_000 },
        { userid: OFFENDER, name: `casetest_${OFFENDER}`, text: "you are ****", at: T0 + 20_000, reported: true },
        { userid: REPORTER_A, name: `casetest_${REPORTER_A}`, text: "hey!", at: T0 + 21_000 },
      ],
    });
    // Once the log has the line, the own words replace it.
    await say(OFFENDER, 20, "you are rude");
    const [after] = await open();
    expect(after!.messages[0]!.snapshot.source).toBe("log");
    expect(after!.messages[0]!.snapshot.lines[0]!.text).toBe("you are rude");
  });

  test("warn and pause chat: one step through the moderation tools, logged, linked to the first report; the case closes once", async () => {
    await report(REPORTER_B, 20);
    await report(REPORTER_A, 20);
    const [only] = await open();
    const action = parseCaseAction({ action: "mute", hours: 24, reason: "Keep chat friendly." });
    if (!action.ok) throw new Error(action.message);
    const done = await actOnCase(orm.em.fork(), only!.id, action.value, OWNER, effects, NOW);
    expect(done.outcome).toBe("done");
    if (done.outcome !== "done") return;
    expect(done.case.status).toBe("actioned");
    expect(done.case.closed).toMatchObject({ outcome: "mute", hours: 24, note: "Keep chat friendly.", by: OWNER });

    const [step] = await sql<{ action: string; reason: string; chat_report_id: string; id: string }>(
      `SELECT id, action, reason, chat_report_id FROM bym.moderation_action WHERE userid = ?`,
      [OFFENDER],
    );
    const [first] = await sql<{ id: string }>(`SELECT min(id) AS id FROM bym.chat_report WHERE reported_id = ?`, [OFFENDER]);
    expect(step).toMatchObject({ action: "mute", reason: "Keep chat friendly." });
    expect(Number(step!.chat_report_id)).toBe(Number(first!.id));
    const [user] = await sql<{ mute_until: Date }>(`SELECT mute_until FROM bym."user" WHERE userid = ?`, [OFFENDER]);
    expect(new Date(user!.mute_until).getTime()).toBe(NOW.getTime() + 24 * 3600_000);
    expect(calls).toEqual([`mute ${OFFENDER} ${NOW.getTime() + 24 * 3600_000}`, `nudge ${OFFENDER}`]);

    // A second press finds it closed and does nothing more.
    expect((await actOnCase(orm.em.fork(), only!.id, action.value, OWNER, effects, NOW)).outcome).toBe("closed");
    expect(await sql(`SELECT id FROM bym.moderation_action WHERE userid = ?`, [OFFENDER])).toHaveLength(1);
    expect(await open()).toHaveLength(0);

    // A late report of the same line joins the closed case; a new line opens a new case,
    // which counts the earlier case and pause.
    await report(REPORTER_C, 20);
    const late = await getChatCase(orm.em.fork(), only!.id, NOW);
    expect(late!.reporters.find((r) => r.userid === REPORTER_C)?.late).toBe(true);
    await report(REPORTER_A, 50);
    const [next] = await open();
    expect(next!.id).not.toBe(only!.id);
    expect(next!.history).toMatchObject({ cases: 1, mutes: 1, warnings: 0 });
    expect(next!.suggest).toEqual({ action: "mute", hours: 72 });
  });

  test("a game team account's case stays open; dismiss closes with the owner's note and touches no account", async () => {
    await recordChatReport(orm.em.fork(), { reporter: REPORTER_A, reported: OWNER, channel: ROOM, message: "hi", ts: T0 }, []);
    const all = (await listChatCases(orm.em.fork(), { status: "open" }, NOW)).cases;
    const team = all.find((c) => c.reported.userid === OWNER)!;
    expect(team.reported.gameTeam).toBe(true);
    const warn = parseCaseAction({ action: "warn", reason: "x" });
    if (!warn.ok) throw new Error(warn.message);
    expect((await actOnCase(orm.em.fork(), team.id, warn.value, OWNER, effects, NOW)).outcome).toBe("gameTeam");
    expect((await getChatCase(orm.em.fork(), team.id, NOW))!.status).toBe("open");

    const dismiss = parseCaseAction({ action: "dismiss", note: "Banter between friends" });
    if (!dismiss.ok) throw new Error(dismiss.message);
    const done = await actOnCase(orm.em.fork(), team.id, dismiss.value, OWNER, effects, NOW);
    expect(done.outcome === "done" && done.case.closed).toMatchObject({ outcome: "dismiss", note: "Banter between friends" });
    expect(await sql(`SELECT id FROM bym.moderation_action WHERE userid = ?`, [OWNER])).toHaveLength(0);
    const closed = (await listChatCases(orm.em.fork(), { status: "closed" }, NOW)).cases;
    expect(closed.some((c) => c.id === team.id)).toBe(true);
  });

  test("award: ticked reporters get Shiny and a mail once per case; a second award gives nothing; others are refused", async () => {
    await report(REPORTER_A, 20);
    await report(REPORTER_B, 20);
    await report(REPORTER_C, 20);
    const [only] = await open();
    const request = parseCaseAward({
      awards: [
        { userid: REPORTER_A, amount: 50 },
        { userid: REPORTER_B, amount: 25 },
        { userid: BYSTANDER, amount: 25 },
      ],
    });
    if (!request.ok) throw new Error(request.message);
    const first = await awardReporters(orm.em.fork(), only!.id, request.value, OWNER, NOW);
    if (first.outcome !== "done") throw new Error(first.outcome);
    expect(first.given).toEqual([
      { userid: REPORTER_A, amount: 50 },
      { userid: REPORTER_B, amount: 25 },
    ]);
    expect(first.failed).toEqual([{ userid: BYSTANDER, reason: "notReporter" }]);
    expect(first.case.reporters.map((r) => r.award?.amount ?? null)).toEqual([50, 25, null]);
    expect(await credits(REPORTER_A)).toBe(START_SHINY + 50);
    expect(await credits(REPORTER_C)).toBe(START_SHINY);
    expect(await credits(BYSTANDER)).toBe(START_SHINY);
    const mail = await sql<{ subject: string }>(`SELECT subject FROM bym.message WHERE targetid = ?`, [REPORTER_A]);
    expect(mail.map((m) => m.subject)).toEqual(["A gift of 50 Shiny"]);

    const again = parseCaseAward({ awards: [{ userid: REPORTER_A, amount: 500 }, { userid: REPORTER_C, amount: 25 }] });
    if (!again.ok) throw new Error(again.message);
    const second = await awardReporters(orm.em.fork(), only!.id, again.value, OWNER, NOW);
    if (second.outcome !== "done") throw new Error(second.outcome);
    expect(second.already).toEqual([REPORTER_A]);
    expect(second.given).toEqual([{ userid: REPORTER_C, amount: 25 }]);
    expect(await credits(REPORTER_A)).toBe(START_SHINY + 50);
    expect(await credits(REPORTER_C)).toBe(START_SHINY + 25);
    expect((await awardReporters(orm.em.fork(), 999_999_999, again.value, OWNER, NOW)).outcome).toBe("notFound");
  });
});
