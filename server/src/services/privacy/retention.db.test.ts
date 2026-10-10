import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import { randomUUID } from "node:crypto";

import ormConfig from "../../mikro-orm.config.js";
import type { RetentionConfig } from "../../config/RetentionConfig.js";
import { RETENTION_JOB, runDailyRetention, runRetentionCleanup } from "./retention.js";

/**
 * The daily privacy clean-up against a real Postgres: mail, battle records
 * and chat reports older than their limits go, in batches, and newer rows
 * stay.
 *
 * Opt-in, like the bot database tests: runs only when PRIVACY_TEST_DB names a
 * throwaway database with the `bym` schema (`bun run db:init` against it),
 * and refuses the shared `bym`. Its rows use player ids from 990001 and
 * thread ids from 990001, and it deletes only those.
 */
const dbName = process.env.PRIVACY_TEST_DB;

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-10T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY);

const A = 990001;
const B = 990002;
const CONFIG: RetentionConfig = { logDays: 30, mailDays: 365, attackLogDays: 365, chatReportDays: 365 };

describe.skipIf(!dbName)("the daily privacy clean-up (retention.ts)", () => {
  let orm: MikroORM;

  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) =>
    orm.em.fork().execute<R[]>(query, params);

  const reset = async () => {
    await sql(`DELETE FROM bym.thread WHERE threadid >= 990001`);
    await sql(`DELETE FROM bym.message WHERE threadid >= 990001`);
    await sql(`DELETE FROM bym.attack_logs WHERE attacker_userid IN (?, ?)`, [A, B]);
    await sql(`DELETE FROM bym.chat_report WHERE reporter_id IN (?, ?)`, [A, B]);
    await sql(`DELETE FROM bym.job_run WHERE job = ?`, [RETENTION_JOB]);
  };

  /** A message in a thread, sent `days` ago. */
  const message = async (threadid: number, days: number, text = "hi") => {
    const id = randomUUID();
    await sql(
      `INSERT INTO bym.message (id, threadid, updatetime, userid, targetid, messagetype, user_unread, target_unread, message, subject, created_at)
       VALUES (?, ?, ?, ?, ?, 'message', 0, 1, ?, 'subject', ?)`,
      [id, threadid, Math.floor(ago(days).getTime() / 1000), A, B, text, ago(days)]
    );
    return id;
  };

  /** A thread whose messages were sent the given numbers of days ago, oldest first; the last is its last message. */
  const thread = async (threadid: number, ...days: number[]) => {
    const ids: string[] = [];
    for (const d of days) ids.push(await message(threadid, d, `${d} days old`));
    await sql(
      `INSERT INTO bym.thread (id, threadid, userid, targetid, last_message_id, messagecount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), threadid, A, B, ids.at(-1), ids.length, ago(days[0]!)]
    );
    return ids;
  };

  const threadRow = async (threadid: number) =>
    (await sql<{ messagecount: number; last_message_id: string | null }>(
      `SELECT messagecount, last_message_id FROM bym.thread WHERE threadid = ?`,
      [threadid]
    ))[0];

  const messagesIn = async (threadid: number) =>
    (await sql<{ message: string }>(`SELECT message FROM bym.message WHERE threadid = ? ORDER BY created_at`, [threadid])).map(
      (row) => row.message
    );

  const attackLog = (days: number) =>
    sql(
      `INSERT INTO bym.attack_logs (attacker_userid, attacker_username, defender_userid, defender_username, type, attackreport, attacktime)
       VALUES (?, 'zz_ret_a', ?, 'zz_ret_b', 'main', '{}', ?)`,
      [A, B, ago(days)]
    );

  const attackLogAges = async () =>
    (await sql<{ attacktime: Date }>(`SELECT attacktime FROM bym.attack_logs WHERE attacker_userid = ? ORDER BY attacktime`, [A])).map(
      (row) => Math.round((NOW - new Date(row.attacktime).getTime()) / DAY)
    );

  const chatReport = (days: number) =>
    sql(
      `INSERT INTO bym.chat_report (reporter_id, reported_id, channel, message, message_ts, verified, created_at)
       VALUES (?, ?, 'chat:mr2-global', 'rude', ?, true, ?)`,
      [A, B, ago(days).getTime(), ago(days)]
    );

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("PRIVACY_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
  });

  beforeEach(reset);

  afterAll(async () => {
    await reset();
    await orm.close();
  });

  const run = (overrides: Partial<Parameters<typeof runRetentionCleanup>[1]> = {}) =>
    runRetentionCleanup(orm.em, { now: NOW, config: CONFIG, pauseMs: 0, ...overrides });

  test("a thread whose mail is all past the limit goes with its messages", async () => {
    await thread(990001, 500, 400);

    const result = await run();

    expect(result.messages).toBe(2);
    expect(result.threads).toBe(1);
    expect(await threadRow(990001)).toBeUndefined();
    expect(await messagesIn(990001)).toEqual([]);
  });

  test("a thread still in use keeps its newer mail, recounted", async () => {
    await thread(990002, 400, 10);

    const result = await run();

    expect(result).toMatchObject({ messages: 1, threads: 0 });
    expect(await messagesIn(990002)).toEqual(["10 days old"]);
    expect(await threadRow(990002)).toMatchObject({ messagecount: 1 });
  });

  test("a thread whose last message went points at the newest one left", async () => {
    const [recent] = await thread(990003, 5, 400);

    await run();

    expect(await threadRow(990003)).toEqual({ messagecount: 1, last_message_id: recent! });
  });

  test("mail inside the limit is left alone", async () => {
    await thread(990004, 300, 1);

    expect(await run()).toMatchObject({ messages: 0, threads: 0 });
    expect(await messagesIn(990004)).toEqual(["300 days old", "1 days old"]);
    expect(await threadRow(990004)).toMatchObject({ messagecount: 2 });
  });

  test("battle records and chat reports past their limits go, newer ones stay", async () => {
    for (const days of [800, 366, 364, 3]) await attackLog(days);
    for (const days of [400, 100]) await chatReport(days);

    const result = await run();

    expect(result).toMatchObject({ attackLogs: 2, chatReports: 1 });
    expect(await attackLogAges()).toEqual([364, 3]);
    const reports = await sql(`SELECT 1 FROM bym.chat_report WHERE reporter_id = ?`, [A]);
    expect(reports.length).toBe(1);
  });

  test("each limit is its own setting", async () => {
    await thread(990005, 40);
    await attackLog(40);
    await chatReport(40);

    const result = await run({ config: { ...CONFIG, mailDays: 30 } });

    expect(result).toMatchObject({ messages: 1, threads: 1, attackLogs: 0, chatReports: 0 });
  });

  test("many old rows go in several small batches", async () => {
    for (let i = 0; i < 7; i++) await attackLog(400 + i);
    await thread(990006, 500, 499, 498, 497, 496);

    const result = await run({ batchSize: 2 });

    expect(result).toMatchObject({ messages: 5, threads: 1, attackLogs: 7 });
    expect(await attackLogAges()).toEqual([]);
  });

  test("the daily run happens once per UTC day", async () => {
    await attackLog(400);

    expect(await runDailyRetention(orm.em, { now: NOW, config: CONFIG, pauseMs: 0 })).toMatchObject({ attackLogs: 1 });

    await attackLog(400);
    expect(await runDailyRetention(orm.em, { now: NOW + 60 * 60 * 1000, config: CONFIG, pauseMs: 0 })).toBeNull();
    expect(await runDailyRetention(orm.em, { now: NOW + DAY, config: CONFIG, pauseMs: 0 })).toMatchObject({ attackLogs: 1 });
  });
});
