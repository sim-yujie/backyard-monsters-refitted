import type { EntityManager } from "@mikro-orm/postgresql";

import { retentionConfig, type RetentionConfig } from "../../config/RetentionConfig.js";
import { logger } from "../../utils/logger.js";

/**
 * The daily privacy clean-up: deletes in-game mail, battle records
 * (`attack_logs`) and chat reports older than their limits
 * (`config/RetentionConfig.ts`, the Privacy Policy, section 4). Log files are
 * pruned by the logger itself (`utils/logFiles.ts`).
 *
 * Every delete goes in batches of {@link RETENTION_BATCH} rows, each its own
 * short statement (mail: its own short transaction), so no table is ever
 * locked for long and players' saves and mail carry on while it runs.
 */

/** The clean-up's `bym.job_run` name; its period is the UTC day. */
export const RETENTION_JOB = "privacy-retention";

/** Rows deleted per statement. */
export const RETENTION_BATCH = 1000;

/** How often the sweep checks whether today's clean-up has run. */
const CHECK_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What one clean-up deleted. */
export interface RetentionResult {
  messages: number;
  threads: number;
  attackLogs: number;
  chatReports: number;
}

export interface RetentionOptions {
  /** Epoch milliseconds; defaults to now. */
  now?: number;
  config?: RetentionConfig;
  batchSize?: number;
  /** A pause between batches, milliseconds, so a big first clean-up shares the database. */
  pauseMs?: number;
}

const pause = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/** The moment `days` days before `now`: anything older goes. */
const cutoff = (now: number, days: number): Date => new Date(now - days * DAY_MS);

/**
 * Deletes one table's old rows a batch at a time until none are left.
 *
 * @param {string} table - The table, unquoted, in schema `bym`.
 * @param {string} key - Its primary key column.
 * @param {string} timeColumn - The column the age is read from.
 * @returns {Promise<number>} How many rows went.
 */
const deleteOldRows = async (
  em: EntityManager,
  table: string,
  key: string,
  timeColumn: string,
  before: Date,
  batchSize: number,
  pauseMs: number
): Promise<number> => {
  let total = 0;
  for (;;) {
    const rows = await em.fork().execute<{ id: unknown }[]>(
      `DELETE FROM bym.${table} WHERE ${key} IN (
         SELECT ${key} FROM bym.${table} WHERE ${timeColumn} < ? ORDER BY ${timeColumn} LIMIT ?
       ) RETURNING ${key} AS id`,
      [before, batchSize]
    );
    total += rows.length;
    if (rows.length < batchSize) return total;
    await pause(pauseMs);
  }
};

/**
 * Deletes mail older than the limit, a batch of messages at a time. A thread
 * left with no messages goes too. A thread that still has some gets its
 * message count recounted and, if its last message went, the newest one left
 * as its last message (the mail list shows a thread only with one).
 *
 * @returns {Promise<{ messages: number; threads: number }>} How many messages and threads went.
 */
const deleteOldMail = async (
  em: EntityManager,
  before: Date,
  batchSize: number,
  pauseMs: number
): Promise<{ messages: number; threads: number }> => {
  const total = { messages: 0, threads: 0 };
  for (;;) {
    const batch = await em.fork().transactional(async (tx) => {
      const gone = await tx.execute<{ threadid: number }[]>(
        `DELETE FROM bym.message WHERE id IN (
           SELECT id FROM bym.message WHERE created_at < ? ORDER BY created_at LIMIT ?
         ) RETURNING threadid`,
        [before, batchSize]
      );
      const threadIds = [...new Set(gone.map((row) => Number(row.threadid)))].filter(Number.isInteger);
      if (threadIds.length === 0) return { messages: gone.length, threads: 0 };

      // Whole numbers read back from the database, so safe to inline.
      const touched = `(${threadIds.join(",")})`;
      const emptied = await tx.execute<{ threadid: number }[]>(
        `DELETE FROM bym.thread t WHERE t.threadid IN ${touched}
           AND NOT EXISTS (SELECT 1 FROM bym.message m WHERE m.threadid = t.threadid)
         RETURNING t.threadid`
      );
      await tx.execute(
        `UPDATE bym.thread t SET
           messagecount = (SELECT count(*) FROM bym.message m WHERE m.threadid = t.threadid),
           last_message_id = COALESCE(t.last_message_id, (
             SELECT m.id FROM bym.message m WHERE m.threadid = t.threadid
             ORDER BY m.updatetime DESC, m.created_at DESC LIMIT 1
           ))
         WHERE t.threadid IN ${touched}`
      );
      return { messages: gone.length, threads: emptied.length };
    });

    total.messages += batch.messages;
    total.threads += batch.threads;
    if (batch.messages < batchSize) return total;
    await pause(pauseMs);
  }
};

/**
 * Runs the clean-up once, whatever the day.
 *
 * @returns {Promise<RetentionResult>} How many rows of each kind went.
 */
export const runRetentionCleanup = async (
  em: EntityManager,
  { now = Date.now(), config = retentionConfig(), batchSize = RETENTION_BATCH, pauseMs = 50 }: RetentionOptions = {}
): Promise<RetentionResult> => {
  const mail = await deleteOldMail(em, cutoff(now, config.mailDays), batchSize, pauseMs);
  const attackLogs = await deleteOldRows(
    em,
    "attack_logs",
    "id",
    "attacktime",
    cutoff(now, config.attackLogDays),
    batchSize,
    pauseMs
  );
  const chatReports = await deleteOldRows(
    em,
    "chat_report",
    "id",
    "created_at",
    cutoff(now, config.chatReportDays),
    batchSize,
    pauseMs
  );
  return { messages: mail.messages, threads: mail.threads, attackLogs, chatReports };
};

/**
 * Runs the clean-up if no server has run it yet today (UTC): the day is
 * claimed in `bym.job_run` first, so two servers sharing a database run it
 * once between them. A failed run gives the claim back, so the next check
 * tries again.
 *
 * @returns {Promise<RetentionResult | null>} What went, or null when today was already claimed.
 */
export const runDailyRetention = async (
  em: EntityManager,
  options: RetentionOptions = {}
): Promise<RetentionResult | null> => {
  const now = options.now ?? Date.now();
  const period = new Date(now).toISOString().slice(0, 10);
  const claimed = await em.fork().execute<{ job: string }[]>(
    `INSERT INTO bym.job_run (job, period, ran_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING job`,
    [RETENTION_JOB, period, new Date(now)]
  );
  if (claimed.length === 0) return null;

  try {
    return await runRetentionCleanup(em, { ...options, now });
  } catch (err) {
    // Let the next hourly check try again; what was deleted stays deleted.
    await em.fork().execute(`DELETE FROM bym.job_run WHERE job = ? AND period = ?`, [RETENTION_JOB, period]);
    throw err;
  }
};

/**
 * Starts the daily clean-up (`server.ts`): a check at boot, then every hour,
 * that runs it once per UTC day. A check still running when the next is due
 * is not doubled. Returns the stop function.
 */
export const startRetentionSweep = (em: EntityManager): (() => void) => {
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runDailyRetention(em);
      if (result) {
        logger.info(
          "Privacy clean-up: deleted {messages} mail messages ({threads} empty threads), {attackLogs} battle records, {chatReports} chat reports",
          { ...result }
        );
      }
    } catch (err) {
      logger.error(`Privacy clean-up failed: ${err}`);
    } finally {
      running = false;
    }
  };

  void check();
  const timer = setInterval(check, CHECK_MS);
  return () => clearInterval(timer);
};
