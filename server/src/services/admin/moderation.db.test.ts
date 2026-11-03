import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { SUPPORT_SENDER } from "../mail/systemSender.js";
import {
  MUTE_SUBJECT,
  WARNING_SUBJECT,
  banAtSignIn,
  listChatReports,
  markNoticeSeen,
  moderate,
  parseModeration,
  pendingNotice,
  playerModeration,
  type ModerationEffects,
  type ModerationKind,
} from "./moderation.js";
import { TEAM_NOTICE } from "./supportMail.js";

/**
 * The dashboard's moderation tools against a real Postgres: warnings, mutes
 * and bans change the player's account, land in the log, send the mail, and
 * ask for the right effects outside the database (sessions ended, chat
 * closed, the game nudged); a timed ban lifts itself at sign-in; chat
 * reports list newest first with what was done from them.
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * Players are `modtest_*`, account numbers from 997001; everything is
 * deleted afterwards.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

const PLAYER = 997001;
const REPORTER = 997002;
const OWNER = 997009;
const ALL = [PLAYER, REPORTER, OWNER];
const LIST = ALL.join(",");
const NOW = new Date("2026-11-04T10:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!dbName)("the dashboard's moderation on a real database", () => {
  let orm: MikroORM;
  const calls: string[] = [];
  const effects: ModerationEffects = {
    endSessions: async (user) => void calls.push(`endSessions ${user.userid} ${user.email}`),
    kickFromChat: async (userid, until, text) => void calls.push(`kick ${userid} ${until} ${text}`),
    muteInChat: async (userid, until) => void calls.push(`mute ${userid} ${until}`),
    nudge: async (userid) => void calls.push(`nudge ${userid}`),
  };

  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);
  const account = async (userid: number) =>
    (await sql<{ banned: boolean; ban_until: Date | null; ban_reason: string | null; mute_until: Date | null }>(
      `SELECT banned, ban_until, ban_reason, mute_until FROM bym."user" WHERE userid = ?`,
      [userid]
    ))[0]!;
  const act = async (kind: ModerationKind, body: Record<string, unknown>, userid = PLAYER, at = NOW) => {
    const request = parseModeration(kind, body);
    if (!request.ok) throw new Error(request.message);
    return moderate(orm.em.fork(), userid, request.value, OWNER, effects, at);
  };
  const mailTo = (userid: number) =>
    sql<{ userid: number; messagetype: string; subject: string; message: string; target_unread: number }>(
      `SELECT userid, messagetype, subject, message, target_unread FROM bym.message WHERE targetid = ? ORDER BY created_at`,
      [userid]
    );

  const reset = async () => {
    await sql(`DELETE FROM bym.moderation_action WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.chat_report WHERE reporter_id IN (${LIST}) OR reported_id IN (${LIST})`);
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
      const name = `modtest_${userid}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, name, `${name}@test.invalid`]
      );
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
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await orm.close();
  });

  test("a warning is mailed from the game team, logged, and waits as a pop-up until closed", async () => {
    expect(await act("warn", { reason: "Please keep chat friendly. Next time it's a ban." })).toEqual({ outcome: "done", until: null });

    const mail = await mailTo(PLAYER);
    expect(mail).toEqual([
      {
        userid: SUPPORT_SENDER,
        messagetype: TEAM_NOTICE,
        subject: WARNING_SUBJECT,
        message: "Please keep chat friendly. Next time it's a ban.",
        target_unread: 1,
      },
    ]);
    expect(calls).toEqual([`nudge ${PLAYER}`]);

    const notice = await pendingNotice(orm.em.fork(), PLAYER, NOW);
    expect(notice).toMatchObject({ kind: "warn", text: "Please keep chat friendly. Next time it's a ban.", until: null });
    expect(await markNoticeSeen(orm.em.fork(), REPORTER, notice!.id)).toBe(false);
    expect(await markNoticeSeen(orm.em.fork(), PLAYER, notice!.id)).toBe(true);
    expect(await pendingNotice(orm.em.fork(), PLAYER, NOW)).toBeNull();

    const view = await playerModeration(orm.em.fork(), PLAYER, NOW);
    expect(view!.log).toHaveLength(1);
    expect(view!.log[0]).toMatchObject({ action: "warn", by: OWNER, byName: `modtest_${OWNER}` });
    expect(view!.log[0]!.seenAt).not.toBeNull();
  });

  test("a ban signs the player out, closes chat, refuses sign-in until it ends, then lifts itself", async () => {
    const done = await act("ban", { reason: "Swearing in chat", days: 3 });
    const until = new Date(NOW.getTime() + 3 * DAY_MS);
    expect(done).toEqual({ outcome: "done", until });

    expect(await account(PLAYER)).toMatchObject({ banned: true, ban_reason: "Swearing in chat" });
    expect(new Date((await account(PLAYER)).ban_until!).getTime()).toBe(until.getTime());
    expect(calls).toEqual([
      `endSessions ${PLAYER} modtest_${PLAYER}@test.invalid`,
      `kick ${PLAYER} ${until.getTime()} Your account is banned until 2026-11-07 10:00 UTC. Reason: Swearing in chat`,
    ]);
    expect(await mailTo(PLAYER)).toEqual([]);

    expect(await banAtSignIn(orm.em.fork(), PLAYER, NOW)).toEqual({ until, reason: "Swearing in chat" });
    expect(await banAtSignIn(orm.em.fork(), PLAYER, new Date(until.getTime() + 1))).toBeNull();
    expect(await account(PLAYER)).toMatchObject({ banned: false, ban_until: null, ban_reason: null });
  });

  test("a ban for good has no end; unban lifts it; both are logged", async () => {
    await act("ban", { reason: "Cheating", days: null });
    expect(await banAtSignIn(orm.em.fork(), PLAYER, new Date(NOW.getTime() + 999 * DAY_MS))).toEqual({ until: null, reason: "Cheating" });

    expect(await act("unban", {})).toEqual({ outcome: "done", until: null });
    expect(await account(PLAYER)).toMatchObject({ banned: false, ban_until: null });
    expect(await act("unban", {})).toEqual({ outcome: "notBanned" });

    const view = await playerModeration(orm.em.fork(), PLAYER, NOW);
    expect(view!.log.map((entry) => entry.action)).toEqual(["unban", "ban"]);
  });

  test("a mute pauses chat for its hours, mails and nudges; unmute ends it", async () => {
    const done = await act("mute", { reason: "Please stop spamming.", hours: 24 });
    const until = new Date(NOW.getTime() + DAY_MS);
    expect(done).toEqual({ outcome: "done", until });
    expect(calls).toEqual([`mute ${PLAYER} ${until.getTime()}`, `nudge ${PLAYER}`]);
    expect((await mailTo(PLAYER))[0]).toMatchObject({ subject: MUTE_SUBJECT, message: "You can't use chat for 24 hours. Please stop spamming." });
    expect((await playerModeration(orm.em.fork(), PLAYER, NOW))!.muteUntil).toBe(until.toISOString());
    expect(await pendingNotice(orm.em.fork(), PLAYER, NOW)).toMatchObject({ kind: "mute", until: until.toISOString() });
    // An ended mute is no longer shown.
    expect(await pendingNotice(orm.em.fork(), PLAYER, new Date(until.getTime() + 1))).toBeNull();

    calls.length = 0;
    expect(await act("unmute", {})).toMatchObject({ outcome: "done" });
    expect(calls).toEqual([`mute ${PLAYER} 0`]);
    expect((await account(PLAYER)).mute_until).toBeNull();
    expect(await act("unmute", {})).toEqual({ outcome: "notMuted" });
  });

  test("the game team's accounts cannot be warned, muted or banned; a missing player is refused", async () => {
    expect(await act("ban", { reason: "x", days: 1 }, OWNER)).toEqual({ outcome: "gameTeam" });
    expect(await act("warn", { reason: "x" }, OWNER)).toEqual({ outcome: "gameTeam" });
    expect(await act("warn", { reason: "x" }, 997999)).toEqual({ outcome: "noPlayer" });
    expect(calls).toEqual([]);
  });

  test("chat reports list newest first, with names, counts and what was done from them", async () => {
    const report = async (ts: number, verified: boolean) =>
      Number(
        (
          await sql<{ id: string }>(
            `INSERT INTO bym.chat_report (reporter_id, reported_id, channel, message, message_ts, verified, created_at)
             VALUES (?, ?, 'chat:mr2-global', 'bad words', ?, ?, now()) RETURNING id`,
            [REPORTER, PLAYER, ts, verified]
          )
        )[0]!.id
      );
    const first = await report(1, true);
    const second = await report(2, false);
    await act("warn", { reason: "Be nice.", chatReportId: second });

    const page = await listChatReports(orm.em.fork(), { limit: 1 }, NOW);
    expect(page.reports.map((r) => r.id)).toEqual([second]);
    expect(page.reports[0]).toMatchObject({
      reporter: { userid: REPORTER, username: `modtest_${REPORTER}` },
      reported: { userid: PLAYER, username: `modtest_${PLAYER}`, banned: false, muted: false },
      verified: false,
      reportsAgainst: 2,
      actions: ["warn"],
    });
    const next = await listChatReports(orm.em.fork(), { before: page.nextBefore!, limit: 1 }, NOW);
    expect(next.reports.map((r) => r.id)).toEqual([first]);
    expect(next.reports[0]!.actions).toEqual([]);
    expect((await playerModeration(orm.em.fork(), PLAYER, NOW))!.reportsAgainst).toBe(2);
  });
});
