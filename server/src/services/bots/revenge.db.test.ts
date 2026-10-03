import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import type { BotConfig } from "../../config/BotConfig.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { BUSY_RETRY_MINUTES, PROTECTED_RETRY_HOURS, SLOT_RETRY_MINUTES, type RevengeOutcome } from "./revenge.js";
import { createBots, deleteBots } from "./factory.js";
import { backoffMinutes, REBALANCE_JOB, runBotSweep, type RevengeRunner } from "./sweep.js";

/**
 * The sweep's `revenge` job against a real Postgres (issue #244): the switch,
 * the checks read fresh from the rows (bot, the player's yard, truces, bots'
 * attack logs), what waits and what is given up, and what the runner's answer
 * does to the job. The attack itself is stood in for here
 * (`revengeRun.db.test.ts` fights it for real).
 *
 * Opt-in, like `sweep.db.test.ts`: runs only when BOTS_TEST_DB names a
 * throwaway database with the `bym` schema, and refuses the shared `bym`
 * database.
 */
const dbName = process.env.BOTS_TEST_DB;

const NOW = Math.floor(Date.now() / 1000);
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const at = (seconds: number) => new Date(seconds * 1000);

describe.skipIf(!dbName)("the revenge job on a real database (issue #244)", () => {
  let orm: MikroORM;
  let bot = 0;
  let otherBot = 0;
  let player = 0;

  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);

  const dropPlayer = async (userid: number) => {
    await sql(`DELETE FROM bym.truce WHERE initiator_userid = ? OR recipient_userid = ?`, [userid, userid]);
    await sql(`DELETE FROM bym.attack_logs WHERE attacker_userid = ? OR defender_userid = ?`, [userid, userid]);
    await sql(`DELETE FROM bym.maproom WHERE userid = ?`, [userid]);
    await sql(`DELETE FROM bym."user" WHERE userid = ?`, [userid]);
    await sql(`DELETE FROM bym.save WHERE userid = ?`, [userid]);
  };

  /** Calls the runner received, and what it answers. */
  let calls: { bot: number; target: number; now: number }[] = [];
  let answer: () => Promise<RevengeOutcome> = async () => ({ status: "landed", damageBefore: 0, damageAfter: 40 });
  let online = new Set<number>();
  const runner: RevengeRunner = {
    isOnline: async (userid) => online.has(userid),
    attack: async (input) => {
      calls.push(input);
      return answer();
    },
  };

  const config =
    (revenge = true): (() => BotConfig) =>
    () => ({ fill: false, brain: true, revenge, total: 3, daysPerLevel: 3 });

  const pass = (options: { revenge?: boolean; runner?: RevengeRunner | null; when?: number; draw?: number } = {}) =>
    runBotSweep({
      em: orm.em,
      now: () => options.when ?? NOW,
      config: config(options.revenge ?? true),
      rng: () => options.draw ?? 0.5,
      revenge: options.runner === null ? undefined : (options.runner ?? runner),
    });

  /** A revenge booked `hoursAgo` hours after the attack that triggered it, due now. */
  const book = async (options: { by?: number; hoursAgo?: number } = {}) => {
    const triggered = NOW - (options.hoursAgo ?? 10) * HOUR;
    const [row] = await sql<{ id: number }>(
      `INSERT INTO bym.bot_job (bot_userid, kind, target_userid, due_at, giveup_at, created_at)
       VALUES (?, 'revenge', ?, ?, ?, ?) RETURNING id`,
      [options.by ?? bot, player, at(NOW - MINUTE), at(triggered + 72 * HOUR), at(triggered)]
    );
    return Number(row!.id);
  };
  const job = async (id: number) => (await sql(`SELECT * FROM bym.bot_job WHERE id = ?`, [id]))[0];
  const dueOf = async (id: number) => new Date((await job(id))!.due_at).getTime() / 1000;
  const attackLog = (attacker: number, when: number) =>
    sql(
      `INSERT INTO bym.attack_logs (attacker_userid, attacker_username, defender_userid, defender_username, type, attacktime)
       VALUES (?, 'a', ?, 'd', 'main', ?)`,
      [attacker, player, at(when)]
    );
  const setYard = (userid: number, fields: string, params: unknown[]) =>
    sql(`UPDATE bym.save SET ${fields} WHERE userid = ? AND type = 'main'`, [...params, userid]);

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("BOTS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 6 } });
  });

  beforeEach(async () => {
    await deleteBots(orm.em.fork(), "all");
    if (player) await dropPlayer(player);
    await sql(`DELETE FROM bym.job_run WHERE job = ?`, [REBALANCE_JOB]);
    // Two bots, and a player: a bot-made user and yard taken out of the bot table.
    const made = await createBots(orm.em.fork(), [10, 12, 11], { rng: mulberry32(244), now: NOW, daysPerLevel: 3 });
    [bot, otherBot, player] = made.map((one) => one.userid) as [number, number, number];
    await sql(`DELETE FROM bym.bot WHERE userid = ?`, [player]);
    // Today's rebalance is done, and both bots have their grows booked well ahead.
    await sql(`INSERT INTO bym.job_run (job, period, ran_at) VALUES (?, ?, now()) ON CONFLICT DO NOTHING`, [
      REBALANCE_JOB,
      at(NOW).toISOString().slice(0, 10),
    ]);
    await sql(`INSERT INTO bym.bot_job (bot_userid, kind, due_at) SELECT userid, 'grow', ? FROM bym.bot`, [
      at(NOW + 10 * HOUR),
    ]);
    await setYard(player, "protected = 0, attackid = 0", []);
    calls = [];
    online = new Set();
    answer = async () => ({ status: "landed", damageBefore: 0, damageAfter: 40 });
  });

  afterAll(async () => {
    if (!orm) return;
    await deleteBots(orm.em.fork(), "all");
    if (player) await dropPlayer(player);
    await sql(`DELETE FROM bym.job_run WHERE job = ?`, [REBALANCE_JOB]);
    await orm.close(true);
  });

  test("with BOTS_REVENGE off, a booked revenge is cancelled and nothing attacks", async () => {
    const id = await book();
    const report = (await pass({ revenge: false }))!;
    expect(calls).toEqual([]);
    expect(await job(id)).toBeUndefined();
    expect(report.revenge).toEqual({ "cancel:switchedOff": 1 });
  }, 30_000);

  test("with BOTS_REVENGE on but no runner, the revenge waits untouched", async () => {
    const id = await book();
    await pass({ runner: null });
    expect(calls).toEqual([]);
    expect(await dueOf(id)).toBe(NOW - MINUTE);
  }, 30_000);

  test("all clear: the runner attacks once, and a landed revenge ends the job", async () => {
    const id = await book();
    const report = (await pass())!;
    expect(calls).toEqual([{ bot, target: player, now: NOW }]);
    expect(await job(id)).toBeUndefined();
    expect(report.revenge).toEqual({ landed: 1 });
  }, 30_000);

  test("a revenge left to land from its checkpoint also ends the job", async () => {
    answer = async () => ({ status: "pending" });
    const id = await book();
    expect((await pass())!.revenge).toEqual({ pending: 1 });
    expect(await job(id)).toBeUndefined();
  }, 30_000);

  test("a protected player: again 1-6 hours after the protection ends", async () => {
    const until = NOW + 20 * HOUR;
    await setYard(player, "protected = ?", [until]);
    const id = await book();
    const report = (await pass({ draw: 0 }))!;
    expect(calls).toEqual([]);
    expect(await dueOf(id)).toBe(until + PROTECTED_RETRY_HOURS.min * HOUR);
    expect(report.revenge).toEqual({ "wait:protected": 1 });
  }, 30_000);

  test("protection that outlasts the give-up time: given up", async () => {
    await setYard(player, "protected = ?", [NOW + 70 * HOUR]);
    const id = await book({ hoursAgo: 10 });
    expect((await pass())!.revenge).toEqual({ "cancel:gaveUp": 1 });
    expect(await job(id)).toBeUndefined();
  }, 30_000);

  test("an online player, a player under attack, a bot under attack: again in 15-60 minutes", async () => {
    const id = await book();
    online.add(player);
    await pass({ draw: 0 });
    expect(await dueOf(id)).toBe(NOW + BUSY_RETRY_MINUTES.min * MINUTE);
    online.clear();

    await sql(`UPDATE bym.bot_job SET due_at = ? WHERE id = ?`, [at(NOW - MINUTE), id]);
    await setYard(player, "attackid = 7, attacks = ?", [JSON.stringify([{ starttime: NOW - 60 }])]);
    expect((await pass({ draw: 1 - 1e-9 }))!.revenge).toEqual({ "wait:underAttack": 1 });
    expect(await dueOf(id)).toBe(NOW + BUSY_RETRY_MINUTES.max * MINUTE - 1);
    await setYard(player, "attackid = 0", []);

    await sql(`UPDATE bym.bot_job SET due_at = ? WHERE id = ?`, [at(NOW - MINUTE), id]);
    await setYard(bot, "attackid = 9, attacks = ?", [JSON.stringify([{ starttime: NOW - 60 }])]);
    expect((await pass())!.revenge).toEqual({ "wait:botUnderAttack": 1 });
    expect(calls).toEqual([]);
  }, 30_000);

  test("a truce, a player off Map Room 1, a retired bot: no revenge", async () => {
    await sql(
      `INSERT INTO bym.truce (initiator_userid, recipient_userid, status, expires_at, created_at) VALUES (?, ?, 'accepted', ?, now())`,
      [player, bot, NOW + 7 * 24 * HOUR]
    );
    const truce = await book();
    expect((await pass())!.revenge).toEqual({ "cancel:truce": 1 });
    expect(await job(truce)).toBeUndefined();

    const moved = await book({ by: otherBot });
    await setYard(player, "mapversion = 2", []);
    expect((await pass())!.revenge).toEqual({ "cancel:targetGone": 1 });
    expect(await job(moved)).toBeUndefined();
    await setYard(player, "mapversion = 1", []);

    await sql(`DELETE FROM bym.truce WHERE initiator_userid = ?`, [player]);
    const retired = await book();
    await sql(`UPDATE bym.bot SET state = 'retired' WHERE userid = ?`, [bot]);
    expect((await pass())!.revenge).toEqual({ "cancel:botRetired": 1 });
    expect(await job(retired)).toBeUndefined();
    expect(calls).toEqual([]);
  }, 30_000);

  test("72 hours after the attack that booked it, the revenge gives up", async () => {
    const id = await book({ hoursAgo: 72 });
    expect((await pass())!.revenge).toEqual({ "cancel:gaveUp": 1 });
    expect(await job(id)).toBeUndefined();
    expect(calls).toEqual([]);
  }, 30_000);

  test("the caps: two bots' revenges in 24 hours make a third wait; this bot's own since the attack ends it", async () => {
    // Another bot's revenge 20 hours ago and a third's 2 hours ago: the first leaves the window in 4 hours.
    await attackLog(otherBot, NOW - 20 * HOUR);
    await attackLog(otherBot, NOW - 2 * HOUR);
    const id = await book({ hoursAgo: 10 });
    expect((await pass({ draw: 0 }))!.revenge).toEqual({ "wait:caps": 1 });
    expect(await dueOf(id)).toBe(NOW + 4 * HOUR + BUSY_RETRY_MINUTES.min * MINUTE);

    // This bot already attacked the player after the attack that booked it.
    await sql(`DELETE FROM bym.attack_logs WHERE defender_userid = ?`, [player]);
    await attackLog(bot, NOW - 5 * HOUR);
    await sql(`UPDATE bym.bot_job SET due_at = ? WHERE id = ?`, [at(NOW - MINUTE), id]);
    expect((await pass())!.revenge).toEqual({ "cancel:alreadyAvenged": 1 });
    expect(calls).toEqual([]);

    // A real player's attack never counts.
    await sql(`DELETE FROM bym.attack_logs WHERE defender_userid = ?`, [player]);
    await attackLog(991_244, NOW - HOUR);
    await attackLog(991_244, NOW - 2 * HOUR);
    await book();
    expect((await pass())!.revenge).toEqual({ landed: 1 });
  }, 30_000);

  test("the runner's answers: busy waits 5 minutes, refused 15-60, nothing to send ends it, a throw backs off", async () => {
    const id = await book();
    answer = async () => ({ status: "busy" });
    expect((await pass())!.revenge).toEqual({ "wait:busy": 1 });
    expect(await dueOf(id)).toBe(NOW + SLOT_RETRY_MINUTES * MINUTE);

    answer = async () => ({ status: "refused", reason: "online" });
    await sql(`UPDATE bym.bot_job SET due_at = ? WHERE id = ?`, [at(NOW - MINUTE), id]);
    expect((await pass({ draw: 0 }))!.revenge).toEqual({ "wait:refused": 1 });
    expect(await dueOf(id)).toBe(NOW + BUSY_RETRY_MINUTES.min * MINUTE);

    answer = async () => {
      throw new Error("worker fell over");
    };
    await sql(`UPDATE bym.bot_job SET due_at = ? WHERE id = ?`, [at(NOW - MINUTE), id]);
    const thrown = (await pass())!;
    expect(thrown.failed).toBe(1);
    expect((await job(id))!.attempts).toBe(1);
    expect(await dueOf(id)).toBe(NOW + backoffMinutes(1) * MINUTE);

    answer = async () => ({ status: "nothing" });
    await sql(`UPDATE bym.bot_job SET due_at = ? WHERE id = ?`, [at(NOW - MINUTE), id]);
    expect((await pass())!.revenge).toEqual({ "cancel:nothingToSend": 1 });
    expect(await job(id)).toBeUndefined();
    expect(calls).toHaveLength(4);
  }, 30_000);

  test("two sweeps at once run a revenge exactly once", async () => {
    await book();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    answer = async () => {
      await gate;
      return { status: "landed", damageBefore: 0, damageAfter: 40 };
    };
    const first = pass();
    // The second pass finds the job claimed and the bot locked.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const second = await pass();
    release();
    const report = await first;
    expect(calls).toHaveLength(1);
    expect(report!.revenge).toEqual({ landed: 1 });
    expect(second!.revenge).toEqual({});
  }, 30_000);
});
