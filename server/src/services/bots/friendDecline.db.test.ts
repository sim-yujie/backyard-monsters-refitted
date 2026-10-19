import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import type { BotConfig } from "../../config/BotConfig.js";
import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { memoryRedis } from "../../testing/memoryRedis.js";
import { createBots, deleteBots } from "./factory.js";
import { REBALANCE_JOB, runBotSweep } from "./sweep.js";
import { DECLINE_FRIEND_HOURS } from "./friendDecline.js";

/**
 * A friend request covered by the §6.2 rule (`docs/design/friends.md`, issue
 * #368), answered by the bot sweep against a real Postgres: the request is
 * made as any other, a job is booked 2-8 hours on, nothing happens before it
 * is due, and when due the sweep declines the request and deletes the job.
 * The sender then gets what any decline gives: the 7-day wait.
 *
 * Opt-in, like `truceDecline.db.test.ts`: runs only when BOTS_TEST_DB names a
 * throwaway database with the `bym` schema, and refuses the shared `bym`.
 */
const dbName = process.env.BOTS_TEST_DB;

mock.module("../../server.js", () => ({ postgres: { em: null }, redis: memoryRedis() }));
const { sendFriendRequest } = await import("../friends/friendships.js");

const NOW = Math.floor(Date.now() / 1000);
const HOUR = 60 * 60;
const T = 3;
const PLAYER = "wp1friend";

describe.skipIf(!dbName)("a friend request under the §6.2 rule is declined through the sweep (issue #368)", () => {
  let orm: MikroORM;

  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);

  const config = (): BotConfig => ({ fill: false, brain: true, revenge: false, total: 1, daysPerLevel: T });

  const pass = (at: number) => runBotSweep({ em: orm.em, now: () => at, config, rng: mulberry32(at).float });

  const removePlayer = async () => {
    const users = await sql<{ userid: number }>(`SELECT userid FROM bym."user" WHERE username = ?`, [PLAYER]);
    for (const { userid } of users) {
      await sql(`DELETE FROM bym.friend_request WHERE from_userid = ? OR to_userid = ?`, [userid, userid]);
      await sql(`DELETE FROM bym.notification WHERE userid = ?`, [userid]);
      await sql(`UPDATE bym."user" SET save_basesaveid = NULL WHERE userid = ?`, [userid]);
      await sql(`DELETE FROM bym.save WHERE userid = ?`, [userid]);
      await sql(`DELETE FROM bym."user" WHERE userid = ?`, [userid]);
    }
  };

  const reset = async () => {
    await removePlayer();
    await deleteBots(orm.em.fork(), "all");
    await sql(`DELETE FROM bym.job_run WHERE job = ?`, [REBALANCE_JOB]);
  };

  /** A player who asks the account for friendship, as `POST /bm/friends/request` does. */
  const ask = async () => {
    const [bot] = await createBots(orm.em.fork(), [5], { rng: mulberry32(368), now: NOW, daysPerLevel: T });
    const em = orm.em.fork();
    const player = em.create(User, { username: PLAYER, email: `${PLAYER}@test.com`, password: "x" });
    await em.flush();
    await Save.createMainSave(em, player);

    const outcome = await sendFriendRequest(orm.em.fork(), player.userid, { userid: bot!.userid }, NOW);
    expect(outcome.request).toMatchObject({ userid: bot!.userid, status: "pending" });
    return { bot: bot!, player, requestid: outcome.request.requestid };
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

  test("booked 2-8 hours on; nothing before it is due; then declined, the job gone, and the 7-day wait", async () => {
    const { bot, player, requestid } = await ask();
    const [job] = await sql(`SELECT * FROM bym.bot_job WHERE bot_userid = ? AND kind = 'declineFriend'`, [bot.userid]);
    const due = Math.round(new Date(job!.due_at).getTime() / 1000);
    expect(due).toBeGreaterThanOrEqual(NOW + DECLINE_FRIEND_HOURS.min * HOUR);
    expect(due).toBeLessThanOrEqual(NOW + DECLINE_FRIEND_HOURS.max * HOUR);
    expect(Number(job!.target_userid)).toBe(player.userid);
    expect(job!.payload).toEqual({ request: requestid });

    await pass(due - 60);
    const [stillWaiting] = await sql(`SELECT status FROM bym.friend_request WHERE id = ?`, [requestid]);
    expect(stillWaiting!.status).toBe("pending");

    const report = await pass(due + 1);
    expect(report!.ran.declineFriend).toBe(1);
    const [answered] = await sql(`SELECT status, answered_at FROM bym.friend_request WHERE id = ?`, [requestid]);
    expect(answered!.status).toBe("declined");
    expect(Math.round(new Date(answered!.answered_at).getTime() / 1000)).toBe(due + 1);
    expect(await sql(`SELECT * FROM bym.bot_job WHERE kind = 'declineFriend'`)).toEqual([]);

    // Asking again is held back, as after any decline.
    let reason: unknown = "not refused";
    try {
      await sendFriendRequest(orm.em.fork(), player.userid, { userid: bot.userid }, due + HOUR);
    } catch (err) {
      reason = (err as { data?: { reason?: string } }).data?.reason;
    }
    expect(reason).toBe("declinedRecently");
  });

  test("a request cancelled before the job is due: the job only goes away", async () => {
    const { requestid } = await ask();
    await sql(`UPDATE bym.friend_request SET status = 'cancelled', answered_at = now() WHERE id = ?`, [requestid]);

    const report = await pass(NOW + DECLINE_FRIEND_HOURS.max * HOUR + 1);
    expect(report!.ran.declineFriend).toBe(1);
    const [row] = await sql(`SELECT status FROM bym.friend_request WHERE id = ?`, [requestid]);
    expect(row!.status).toBe("cancelled");
    expect(await sql(`SELECT * FROM bym.bot_job WHERE kind = 'declineFriend'`)).toEqual([]);
  });
});
