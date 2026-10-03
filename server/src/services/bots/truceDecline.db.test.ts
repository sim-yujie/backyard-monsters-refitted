import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import type { BotConfig } from "../../config/BotConfig.js";
import { Message } from "../../database/models/message.model.js";
import { Save } from "../../database/models/save.model.js";
import { Thread } from "../../database/models/thread.model.js";
import { Truce } from "../../database/models/truce.model.js";
import { User } from "../../database/models/user.model.js";
import { TruceStatus } from "../../enums/TruceStatus.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { TRUCE_RETRY_AFTER_REJECTION } from "../mail/truceTimes.js";
import { createBots, deleteBots } from "./factory.js";
import { REBALANCE_JOB, runBotSweep } from "./sweep.js";
import { bookTruceDecline, DECLINE_TRUCE_HOURS, TRUCE_REJECT_TEXT } from "./truceDecline.js";

/**
 * A truce request to a bot, answered by the bot sweep (issue #245) against a
 * real Postgres: the job is booked 2-8 hours on, nothing happens before it is
 * due, and when due the sweep claims it, rejects the request in its thread
 * and deletes the job.
 *
 * Opt-in, like `sweep.db.test.ts`: runs only when BOTS_TEST_DB names a
 * throwaway database with the `bym` schema, and refuses the shared `bym`.
 */
const dbName = process.env.BOTS_TEST_DB;

const NOW = Math.floor(Date.now() / 1000);
const HOUR = 60 * 60;
const T = 3;
const PLAYER = "wp12truce";

describe.skipIf(!dbName)("a bot declines a truce through the sweep (issue #245)", () => {
  let orm: MikroORM;

  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);

  const config = (): BotConfig => ({ fill: false, brain: true, revenge: false, total: 1, daysPerLevel: T });

  const pass = (at: number) => runBotSweep({ em: orm.em, now: () => at, config, rng: mulberry32(at).float });

  const removePlayer = async () => {
    const users = await sql<{ userid: number }>(`SELECT userid FROM bym."user" WHERE username = ?`, [PLAYER]);
    for (const { userid } of users) {
      await sql(`DELETE FROM bym.message WHERE userid = ? OR targetid = ?`, [userid, userid]);
      await sql(`DELETE FROM bym.thread WHERE userid = ? OR targetid = ?`, [userid, userid]);
      await sql(`DELETE FROM bym.truce WHERE initiator_userid = ? OR recipient_userid = ?`, [userid, userid]);
      await sql(`UPDATE bym."user" SET save_basesaveid = NULL WHERE userid = ?`, [userid]);
      await sql(`DELETE FROM bym.save WHERE userid = ?`, [userid]);
      await sql(`DELETE FROM bym."user" WHERE userid = ?`, [userid]);
    }
  };

  const reset = async () => {
    await deleteBots(orm.em.fork(), "all");
    await removePlayer();
    await sql(`DELETE FROM bym.job_run WHERE job = ?`, [REBALANCE_JOB]);
  };

  /** A player who asks a bot for a truce from the map, as `requestTruce` writes it. */
  const askBot = async () => {
    const [bot] = await createBots(orm.em.fork(), [5], { rng: mulberry32(245), now: NOW, daysPerLevel: T });
    const em = orm.em.fork();
    const player = em.create(User, { username: PLAYER, email: `${PLAYER}@test.com`, password: "x" });
    await em.flush();
    await Save.createMainSave(em, player);

    const truce = em.create(Truce, {
      initiator_userid: player.userid,
      recipient_userid: bot!.userid,
      status: TruceStatus.REQUESTED,
      created_at: new Date(NOW * 1000),
    });
    await em.flush();
    const [last] = await em.find(Thread, {}, { orderBy: { threadid: "DESC" }, limit: 1 });
    const thread = em.create(Thread, {
      threadid: (last?.threadid ?? 0) + 1,
      userid: player.userid,
      targetid: bot!.userid,
      messagecount: 1,
      truce_id: truce.id,
      trucestate: TruceStatus.REQUESTED,
      createdAt: new Date(NOW * 1000),
    });
    thread.lastMessage = em.create(Message, {
      threadid: thread.threadid,
      userid: player.userid,
      targetid: bot!.userid,
      messagetype: "trucerequest",
      userUnread: 0,
      targetUnread: 1,
      subject: `Truce Request from ${PLAYER}`,
      message: "Accept my truce.",
      updatetime: NOW,
    });
    await em.flush();

    expect(await bookTruceDecline(em, truce, NOW, () => 0.5)).toBe(true);
    return { bot: bot!, player, truce, thread };
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("BOTS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
  });

  beforeEach(reset);

  afterAll(async () => {
    if (!orm) return;
    await reset();
    await orm.close(true);
  });

  test("booked 2-8 hours on; nothing before it is due; then a rejection in the thread, the job gone", async () => {
    const { bot, player, truce, thread } = await askBot();
    const [job] = await sql(`SELECT * FROM bym.bot_job WHERE bot_userid = ? AND kind = 'declineTruce'`, [bot.userid]);
    const due = new Date(job!.due_at).getTime() / 1000;
    expect(due).toBe(NOW + ((DECLINE_TRUCE_HOURS.min + DECLINE_TRUCE_HOURS.max) / 2) * HOUR);
    expect(Number(job!.target_userid)).toBe(player.userid);

    await pass(due - 60);
    const [stillWaiting] = await sql(`SELECT status FROM bym.truce WHERE id = ?`, [truce.id]);
    expect(stillWaiting!.status).toBe("requested");

    const report = await pass(due);
    expect(report!.ran.declineTruce).toBe(1);

    const [answered] = await sql(`SELECT status, expires_at FROM bym.truce WHERE id = ?`, [truce.id]);
    expect(answered).toEqual({ status: "rejected", expires_at: due + TRUCE_RETRY_AFTER_REJECTION });
    const [threadRow] = await sql(`SELECT trucestate, messagecount, last_message_id FROM bym.thread WHERE threadid = ?`, [
      thread.threadid,
    ]);
    expect(threadRow).toMatchObject({ trucestate: "rejected", messagecount: 2 });
    const [reply] = await sql(`SELECT * FROM bym.message WHERE id = ?`, [threadRow!.last_message_id]);
    expect(reply).toMatchObject({
      userid: bot.userid,
      targetid: player.userid,
      messagetype: "trucereject",
      message: TRUCE_REJECT_TEXT,
      subject: `Truce Request from ${PLAYER}`,
      user_unread: 0,
      target_unread: 1,
      updatetime: due,
    });
    const [save] = await sql(`SELECT unreadmessages FROM bym.save WHERE userid = ? AND type = 'main'`, [player.userid]);
    expect(save!.unreadmessages).toBe(1);
    // The bot read the request as it answered.
    const [request] = await sql(`SELECT target_unread FROM bym.message WHERE threadid = ? AND messagetype = 'trucerequest'`, [
      thread.threadid,
    ]);
    expect(request!.target_unread).toBe(0);
    const [botSave] = await sql(`SELECT unreadmessages FROM bym.save WHERE userid = ? AND type = 'main'`, [bot.userid]);
    expect(botSave!.unreadmessages).toBe(0);
    expect(await sql(`SELECT * FROM bym.bot_job WHERE kind = 'declineTruce'`)).toEqual([]);
  });

  test("a request answered before the job is due: the job only goes away", async () => {
    const { truce } = await askBot();
    await sql(`UPDATE bym.truce SET status = 'accepted', expires_at = ? WHERE id = ?`, [NOW + 7 * 24 * HOUR, truce.id]);

    const report = await pass(NOW + DECLINE_TRUCE_HOURS.max * HOUR);
    expect(report!.ran.declineTruce).toBe(1);
    const [row] = await sql(`SELECT status FROM bym.truce WHERE id = ?`, [truce.id]);
    expect(row!.status).toBe("accepted");
    expect(await sql(`SELECT * FROM bym.bot_job WHERE kind = 'declineTruce'`)).toEqual([]);
    expect(await sql(`SELECT * FROM bym.message WHERE messagetype = 'trucereject'`)).toEqual([]);
  });

  test("a request to a player books nothing", async () => {
    const em = orm.em.fork();
    const player = em.create(User, { username: PLAYER, email: `${PLAYER}@test.com`, password: "x" });
    await em.flush();
    expect(
      await bookTruceDecline(em, { id: 1, initiator_userid: player.userid, recipient_userid: player.userid }, NOW)
    ).toBe(false);
    expect(await sql(`SELECT * FROM bym.bot_job`)).toEqual([]);
  });
});
