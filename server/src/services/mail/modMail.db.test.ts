import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import {
  isMailModerator,
  listModMail,
  logModMail,
  MOD_MAIL_LIMIT_TEXT,
  MOD_MAIL_LIMITS,
  modNewThreadRefusal,
  parseModMailQuery,
  type ModMailEntry,
} from "./modMail.js";
import { readMailStatus } from "./mailStatus.js";

/**
 * Moderator mail against a real Postgres (migration 20261111_AddModMailLog):
 * the moderators list read on every check, the log written and searched by
 * moderator or recipient, kept when the message, its thread and both
 * accounts are deleted, the new-conversation cap counted from it, and the
 * live mail check's newest unread message.
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
const NOW = new Date("2026-11-11T10:00:00Z");

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

  test("logs a moderator's mail and finds it by moderator name or recipient number", async () => {
    await logModMail(orm.em.fork(), entry(), NOW);
    await logModMail(orm.em.fork(), entry({ recipientId: PLAYER, recipientName: `modmtest_${PLAYER}`, subject: "Two" }), NOW);
    const byModerator = await listModMail(orm.em.fork(), parseModMailQuery({ moderator: `ModMTest_${MOD}` }));
    expect(byModerator.mails.map((m) => m.subject)).toEqual(["Two", "About chat"]);
    const byRecipient = await listModMail(orm.em.fork(), parseModMailQuery({ recipient: `#${STRANGER}` }));
    expect(byRecipient.mails).toHaveLength(1);
    expect(byRecipient.mails[0]).toMatchObject({
      moderatorId: MOD,
      moderatorName: `modmtest_${MOD}`,
      recipientId: STRANGER,
      recipientName: `modmtest_${STRANGER}`,
      threadid: THREAD,
      newThread: true,
      subject: "About chat",
      message: "Please keep chat friendly.",
      sentAt: NOW.toISOString(),
    });
    const both = await listModMail(orm.em.fork(), parseModMailQuery({ moderator: String(MOD), recipient: `${PLAYER}` }));
    expect(both.mails.map((m) => m.subject)).toEqual(["Two"]);
  });

  test("pages newest first", async () => {
    for (const subject of ["a", "b", "c"]) await logModMail(orm.em.fork(), entry({ subject }), NOW);
    const first = await listModMail(orm.em.fork(), parseModMailQuery({ moderator: String(MOD), limit: "2" }));
    expect(first.mails.map((m) => m.subject)).toEqual(["c", "b"]);
    expect(first.next).not.toBeNull();
    const second = await listModMail(
      orm.em.fork(),
      parseModMailQuery({ moderator: String(MOD), limit: "2", before: String(first.next) }),
    );
    expect(second.mails.map((m) => m.subject)).toEqual(["a"]);
    expect(second.next).toBeNull();
  });

  test("the log is kept when the message, its thread and both accounts are deleted", async () => {
    await sql(`INSERT INTO bym.thread (id, threadid, userid, targetid, messagecount, created_at) VALUES (gen_random_uuid(), ?, ?, ?, 1, now())`, [
      THREAD,
      MOD,
      STRANGER,
    ]);
    await addMessage("00000000-0000-4000-8000-997201000001", MOD, STRANGER, 100, "Please keep chat friendly.");
    await logModMail(orm.em.fork(), entry(), NOW);

    await sql(`DELETE FROM bym.message WHERE threadid = ?`, [THREAD]);
    await sql(`DELETE FROM bym.thread WHERE threadid = ?`, [THREAD]);
    await sql(`DELETE FROM bym.chat_moderator WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${MOD}, ${STRANGER})`);

    const kept = await listModMail(orm.em.fork(), parseModMailQuery({ recipient: `modmtest_${STRANGER}` }));
    expect(kept.mails).toHaveLength(1);
    expect(kept.mails[0]).toMatchObject({ moderatorName: `modmtest_${MOD}`, message: "Please keep chat friendly." });
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
      notice: 0,
    });
    const blocking = await readMailStatus(orm.em.fork(), STRANGER, [MOD]);
    expect(blocking.latest).toMatchObject({ from: PLAYER, mod: 0 });
    expect((await readMailStatus(orm.em.fork(), MOD, [])).mod).toBe(1);
  });
});
