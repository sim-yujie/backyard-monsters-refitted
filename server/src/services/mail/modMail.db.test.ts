import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import {
  isMailModerator,
  listModConversations,
  logModConversation,
  logModMail,
  MOD_MAIL_LIMIT_TEXT,
  MOD_MAIL_LIMITS,
  modNewThreadRefusal,
  parseModMailQuery,
  readModConversation,
  type ModMailEntry,
  type SentMail,
} from "./modMail.js";
import { readMailStatus } from "./mailStatus.js";

/**
 * Moderator mail against a real Postgres (migrations 20261111_AddModMailLog,
 * 20261112_AddModMailReplies): the moderators list read on every check, both
 * sides of a moderator's conversation logged, listed one row per
 * conversation and searched by moderator or player, read whole in order,
 * kept when the messages, the thread and both accounts are deleted, the
 * new-conversation cap counted from the moderator's own rows, and the live
 * mail check's newest unread message.
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * Players are `modmtest_*`, account numbers from 997201; everything is
 * deleted afterwards.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

const MOD = 997201;
const PLAYER = 997202;
const STRANGER = 997203;
const ALL = [MOD, PLAYER, STRANGER];
const LIST = ALL.join(",");
const THREAD = 997201;
const THREAD_2 = 997202;
const NOW = new Date("2026-11-11T10:00:00Z");

/** A message sent in THREAD, for `logModConversation`. */
const sent = (from: number, to: number, message: string, over: Partial<SentMail> = {}): SentMail => ({
  threadid: THREAD,
  newThread: false,
  senderId: from,
  senderName: `modmtest_${from}`,
  recipientId: to,
  recipientName: `modmtest_${to}`,
  senderIsModerator: from === MOD,
  messagetype: "message",
  subject: "About chat",
  message,
  written: null,
  ...over,
});

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

const entry = (over: Partial<ModMailEntry> = {}): ModMailEntry => ({
  moderatorId: MOD,
  moderatorName: `modmtest_${MOD}`,
  recipientId: STRANGER,
  recipientName: `modmtest_${STRANGER}`,
  threadid: THREAD,
  newThread: true,
  messagetype: "message",
  subject: "About chat",
  message: "Please keep chat friendly.",
  written: null,
  ...over,
});

describe.skipIf(!dbName)("moderator mail on a real database", () => {
  let orm: MikroORM;
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);
  const cleanUp = async () => {
    await sql(`DELETE FROM bym.mod_mail_log WHERE moderator_id IN (${LIST}) OR recipient_id IN (${LIST})`);
    await sql(`DELETE FROM bym.message WHERE userid IN (${LIST}) OR targetid IN (${LIST})`);
    await sql(`DELETE FROM bym.thread WHERE userid IN (${LIST}) OR targetid IN (${LIST})`);
    await sql(`DELETE FROM bym.chat_moderator WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
  };
  const addUsers = async () => {
    for (const userid of ALL) {
      const name = `modmtest_${userid}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, name, `${name}@test.invalid`],
      );
    }
    await sql(`INSERT INTO bym.chat_moderator (userid, added_by) VALUES (?, 1) ON CONFLICT DO NOTHING`, [MOD]);
  };
  const addMessage = async (id: string, from: number, to: number, time: number, text: string) => {
    await sql(
      `INSERT INTO bym.message (id, threadid, updatetime, userid, targetid, messagetype, user_unread, target_unread, subject, message, created_at)
       VALUES (?, ?, ?, ?, ?, 'message', 0, 1, 'Hi', ?, now())`,
      [id, THREAD, time, from, to, text],
    );
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DASHBOARD_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
  });

  beforeEach(async () => {
    await cleanUp();
    await addUsers();
  });

  afterAll(async () => {
    if (!orm) return;
    await cleanUp();
    await orm.close();
  });

  test("reads the moderators list on every check", async () => {
    expect(await isMailModerator(orm.em.fork(), MOD)).toBe(true);
    expect(await isMailModerator(orm.em.fork(), PLAYER)).toBe(false);
    await sql(`DELETE FROM bym.chat_moderator WHERE userid = ?`, [MOD]);
    expect(await isMailModerator(orm.em.fork(), MOD)).toBe(false);
  });

  test("logs both sides of a moderator's conversation and lists it as one row", async () => {
    await logModConversation(orm.em.fork(), sent(MOD, STRANGER, "Please keep chat friendly.", { newThread: true }), at(0));
    await logModConversation(orm.em.fork(), sent(STRANGER, MOD, "Sorry, I will."), at(1));
    await logModConversation(orm.em.fork(), sent(MOD, STRANGER, "Thanks!", { written: "Thanks d*mn | Thanks!" }), at(2));
    // Two players with no moderator: never logged.
    await logModConversation(orm.em.fork(), sent(PLAYER, STRANGER, "hi", { threadid: 997299 }), at(3));

    const { conversations, next } = await listModConversations(orm.em.fork(), parseModMailQuery({ moderator: String(MOD) }));
    expect(conversations).toHaveLength(1);
    expect((await sql(`SELECT 1 FROM bym.mod_mail_log WHERE threadid = 997299`)).length).toBe(0);
    expect(conversations[0]).toMatchObject({
      threadid: THREAD,
      moderatorId: MOD,
      moderatorName: `modmtest_${MOD}`,
      playerId: STRANGER,
      playerName: `modmtest_${STRANGER}`,
      messages: 3,
      fromModerator: 2,
      startedAt: at(0).toISOString(),
      lastAt: at(2).toISOString(),
      lastSender: "moderator",
      lastMessage: "Thanks!",
    });
    expect(next).toBeNull();

    const whole = await readModConversation(orm.em.fork(), THREAD);
    expect(whole).toMatchObject({ moderatorId: MOD, playerId: STRANGER, cut: false });
    expect(whole!.messages.map((m) => [m.sender, m.senderId, m.senderName, m.message, m.newThread])).toEqual([
      ["moderator", MOD, `modmtest_${MOD}`, "Please keep chat friendly.", true],
      ["player", STRANGER, `modmtest_${STRANGER}`, "Sorry, I will.", false],
      ["moderator", MOD, `modmtest_${MOD}`, "Thanks!", false],
    ]);
    expect(whole!.messages[2]!.written).toBe("Thanks d*mn | Thanks!");
    expect(await readModConversation(orm.em.fork(), 997298)).toBeNull();
  });

  test("a player's mail to a moderator is logged as the player's, and does not count against the moderator's cap", async () => {
    await logModConversation(orm.em.fork(), sent(PLAYER, MOD, "Someone is spamming.", { newThread: true }), at(0));
    const whole = await readModConversation(orm.em.fork(), THREAD);
    expect(whole!.messages.map((m) => [m.sender, m.senderId])).toEqual([["player", PLAYER]]);
    expect(whole).toMatchObject({ moderatorId: MOD, playerId: PLAYER });
    const [row] = await sql(`SELECT new_thread, sender FROM bym.mod_mail_log WHERE threadid = ?`, [THREAD]);
    expect(row).toMatchObject({ new_thread: true, sender: "player" });
    const minuteAgo = new Date(NOW.getTime() - 60_000);
    for (let i = 0; i < MOD_MAIL_LIMITS.perHour; i += 1) {
      await logModConversation(orm.em.fork(), sent(PLAYER, MOD, "again", { threadid: 997210 + i, newThread: true }), minuteAgo);
    }
    expect(await modNewThreadRefusal(orm.em.fork(), MOD, NOW)).toBeNull();
  });

  test("finds conversations by moderator name or player number, either side's message matching", async () => {
    await logModConversation(orm.em.fork(), sent(MOD, STRANGER, "one", { newThread: true }), at(0));
    await logModConversation(orm.em.fork(), sent(STRANGER, MOD, "answer"), at(1));
    await logModConversation(orm.em.fork(), sent(MOD, PLAYER, "two", { threadid: THREAD_2, newThread: true }), at(2));
    const byModerator = await listModConversations(orm.em.fork(), parseModMailQuery({ moderator: `ModMTest_${MOD}` }));
    expect(byModerator.conversations.map((c) => c.threadid)).toEqual([THREAD_2, THREAD]);
    const byPlayer = await listModConversations(orm.em.fork(), parseModMailQuery({ recipient: `#${STRANGER}` }));
    expect(byPlayer.conversations.map((c) => [c.threadid, c.messages, c.lastSender])).toEqual([[THREAD, 2, "player"]]);
    const both = await listModConversations(orm.em.fork(), parseModMailQuery({ moderator: String(MOD), recipient: `${PLAYER}` }));
    expect(both.conversations.map((c) => c.threadid)).toEqual([THREAD_2]);
    const nobody = await listModConversations(orm.em.fork(), parseModMailQuery({ recipient: "modmtest_nobody" }));
    expect(nobody.conversations).toEqual([]);
  });

  test("pages conversations by their newest message", async () => {
    for (const [i, threadid] of [997231, 997232, 997233].entries()) {
      await logModConversation(orm.em.fork(), sent(MOD, STRANGER, `t${i}`, { threadid, newThread: true }), at(i));
    }
    // An answer brings the oldest conversation to the top.
    await logModConversation(orm.em.fork(), sent(STRANGER, MOD, "late answer", { threadid: 997231 }), at(5));
    const first = await listModConversations(orm.em.fork(), parseModMailQuery({ moderator: String(MOD), limit: "2" }));
    expect(first.conversations.map((c) => c.threadid)).toEqual([997231, 997233]);
    expect(first.next).not.toBeNull();
    const second = await listModConversations(
      orm.em.fork(),
      parseModMailQuery({ moderator: String(MOD), limit: "2", before: String(first.next) }),
    );
    expect(second.conversations.map((c) => c.threadid)).toEqual([997232]);
    expect(second.next).toBeNull();
  });

  test("both sides are kept when the messages, the thread and both accounts are deleted", async () => {
    await sql(`INSERT INTO bym.thread (id, threadid, userid, targetid, messagecount, created_at) VALUES (gen_random_uuid(), ?, ?, ?, 2, now())`, [
      THREAD,
      MOD,
      STRANGER,
    ]);
    await addMessage("00000000-0000-4000-8000-997201000001", MOD, STRANGER, 100, "Please keep chat friendly.");
    await logModConversation(orm.em.fork(), sent(MOD, STRANGER, "Please keep chat friendly.", { newThread: true }), at(0));
    await addMessage("00000000-0000-4000-8000-997201000004", STRANGER, MOD, 200, "Get lost.");
    await logModConversation(orm.em.fork(), sent(STRANGER, MOD, "Get lost."), at(1));

    await sql(`DELETE FROM bym.message WHERE threadid = ?`, [THREAD]);
    await sql(`DELETE FROM bym.thread WHERE threadid = ?`, [THREAD]);
    await sql(`DELETE FROM bym.chat_moderator WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${MOD}, ${STRANGER})`);

    const kept = await listModConversations(orm.em.fork(), parseModMailQuery({ recipient: `modmtest_${STRANGER}` }));
    expect(kept.conversations).toHaveLength(1);
    expect(kept.conversations[0]).toMatchObject({ moderatorName: `modmtest_${MOD}`, messages: 2, lastMessage: "Get lost." });
    const whole = await readModConversation(orm.em.fork(), THREAD);
    expect(whole!.messages.map((m) => [m.sender, m.message])).toEqual([
      ["moderator", "Please keep chat friendly."],
      ["player", "Get lost."],
    ]);
  });

  test("a row from before replies were logged reads as the moderator's", async () => {
    await sql(
      `INSERT INTO bym.mod_mail_log (moderator_id, moderator_name, recipient_id, recipient_name, threadid, messagetype, subject, message)
       VALUES (?, ?, ?, ?, ?, 'message', 'Old', 'Sent before the change')`,
      [MOD, `modmtest_${MOD}`, STRANGER, `modmtest_${STRANGER}`, THREAD],
    );
    const whole = await readModConversation(orm.em.fork(), THREAD);
    expect(whole!.messages.map((m) => [m.sender, m.senderId, m.message])).toEqual([["moderator", MOD, "Sent before the change"]]);
  });

  test("caps the new conversations a moderator starts, replies apart", async () => {
    expect(await modNewThreadRefusal(orm.em.fork(), MOD, NOW)).toBeNull();
    const minuteAgo = new Date(NOW.getTime() - 60_000);
    for (let i = 0; i < MOD_MAIL_LIMITS.perHour; i += 1) {
      await logModMail(orm.em.fork(), entry({ newThread: i % 2 === 0 }), minuteAgo);
    }
    // Only half were new conversations: under the cap.
    expect(await modNewThreadRefusal(orm.em.fork(), MOD, NOW)).toBeNull();
    for (let i = 0; i < MOD_MAIL_LIMITS.perHour / 2; i += 1) await logModMail(orm.em.fork(), entry(), minuteAgo);
    expect(await modNewThreadRefusal(orm.em.fork(), MOD, NOW)).toBe(MOD_MAIL_LIMIT_TEXT.hour);
    // Two hours on, the hour's count is clear.
    expect(await modNewThreadRefusal(orm.em.fork(), MOD, new Date(NOW.getTime() + 7_200_000))).toBeNull();
  });

  test("the mail check gives the newest unread message, its sender's Mod badge, and leaves out blocked senders", async () => {
    await addMessage("00000000-0000-4000-8000-997201000002", PLAYER, STRANGER, 100, "older");
    await addMessage("00000000-0000-4000-8000-997201000003", MOD, STRANGER, 200, "Please keep chat friendly, thanks!");
    const status = await readMailStatus(orm.em.fork(), STRANGER, []);
    expect(status.unread).toBe(2);
    expect(status.mod).toBe(0);
    expect(status.latest).toMatchObject({
      id: "00000000-0000-4000-8000-997201000003",
      threadid: THREAD,
      from: MOD,
      name: `modmtest_${MOD}`,
      preview: "Please keep chat friendly, thanks!",
      time: 200,
      mod: 1,
      gm: 0,
      notice: 0,
    });
    const blocking = await readMailStatus(orm.em.fork(), STRANGER, [MOD]);
    expect(blocking.latest).toMatchObject({ from: PLAYER, mod: 0 });
    expect((await readMailStatus(orm.em.fork(), MOD, [])).mod).toBe(1);
  });
});
