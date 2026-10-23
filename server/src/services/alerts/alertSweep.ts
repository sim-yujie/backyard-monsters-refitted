import { alertConfig } from "../../config/AlertConfig.js";
import { logger } from "../../utils/logger.js";
import { healthSummary, type HealthDeps } from "../health/healthSummary.js";
import type { ReadHostStatus } from "../health/hostStatus.js";
import { findProblems, redisAlertStore, runAlertRules, type AlertRedis, type ErrorRate } from "./alerts.js";
import { serverErrorRate } from "./errorRate.js";
import { sendTelegram, type SendTelegram } from "./telegram.js";

/**
 * The alert check (`server.ts`): once a minute it builds the health summary,
 * finds what is wrong (`alerts.ts`) and tells the owner on Telegram. It runs
 * only when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set. Two servers
 * sharing one Redis (a second development server) take turns through a
 * short Redis lock, so a problem is never said twice.
 */

export const ALERT_CHECK_MS = 60 * 1000;

/** Held by the server running a check; it lapses before the next one is due. */
export const ALERT_LOCK_KEY = "alerts:check-lock";

/**
 * Where the "sudden jump in errors" check reads its counts: the server's own
 * 10-minute counter (`errorRate.ts`), fed by the error store's flush
 * (`services/errors/errorStore.ts`). Before the first flush the rate reads as
 * unknown, the error check is skipped and an open error problem is left as it is.
 */
export type ErrorRateSource = (now: number) => Promise<ErrorRate | null>;

export const defaultErrorRateSource: ErrorRateSource = async (now) => serverErrorRate.rate(now);

let errorRateSource: ErrorRateSource = defaultErrorRateSource;

/** Points the error check somewhere else (tests). */
export const setErrorRateSource = (source: ErrorRateSource): void => {
  errorRateSource = source;
};

export interface AlertSweepDeps {
  readonly redis: AlertRedis & { send(command: string, args: string[]): Promise<unknown> };
  readonly sql: HealthDeps["sql"];
  /** Fakes for tests; the real Telegram and host.json otherwise. */
  readonly send?: SendTelegram;
  readonly readHostStatus?: ReadHostStatus;
}

/** One check: summary, problems, messages. Exported for tests and the CLI. */
export const runAlertCheck = async ({ redis, sql, send, readHostStatus }: AlertSweepDeps, now: number = Date.now()) => {
  const config = alertConfig();
  if (!config.telegram) return null;

  const locked = await redis.send("SET", [ALERT_LOCK_KEY, String(now), "NX", "PX", String(ALERT_CHECK_MS - 5000)]);
  if (locked === null) return null;

  const health = await healthSummary({ sql, redisSend: (command, args) => redis.send(command, args), readHostStatus, now });
  const errors = await errorRateSource(now).catch((err) => {
    logger.warn(`Alerts: the error count could not be read: ${err}`);
    return null;
  });
  const store = redisAlertStore(redis);
  const open = new Set((await store.all()).keys());
  const run = await runAlertRules(findProblems(health, errors, config, open), {
    store,
    send: send ?? ((text) => sendTelegram(text, { config })),
    config,
    now,
  });
  if (run.failed.length) logger.warn(`Alerts: ${run.failed.length} Telegram message(s) failed; trying again next minute`);
  return run;
};

/**
 * Starts the alert check, once a minute. A check still running when the next
 * is due is not doubled. Returns the stop function, or null when alerts are off.
 */
export const startAlertSweep = (deps: AlertSweepDeps): (() => void) | null => {
  if (!alertConfig().telegram) {
    logger.info("Telegram alerts: off (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set)");
    return null;
  }
  logger.info("Telegram alerts: on");

  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      await runAlertCheck(deps);
    } catch (err) {
      logger.error(`Alerts: the check failed: ${err}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(check, ALERT_CHECK_MS);
  // The first check waits a minute, so a restart is not mistaken for problems still settling.
  return () => clearInterval(timer);
};
