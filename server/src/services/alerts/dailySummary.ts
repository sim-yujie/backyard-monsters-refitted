import { alertConfig, dashboardLink, type AlertConfig } from "../../config/AlertConfig.js";
import { logger } from "../../utils/logger.js";
import { utcDay } from "../stats/activity.js";
import type { DailySummary } from "../stats/dailyStats.js";
import { redisAlertStore, type AlertRedis, type AlertState } from "./alerts.js";
import { sendTelegram, type SendTelegram } from "./telegram.js";

/**
 * The daily summary on Telegram (docs/alerts.md): once a day, just after
 * midnight UTC (08:00 in Singapore), yesterday's numbers: new and active
 * players, attacks and tribe raids, event players, errors, problems still
 * open, and the day's bug reports with the first 80 characters of each.
 *
 * That bug report text is the only player-written text that goes to Telegram
 * (the owner's choice, 2026-10-23; listed in the Privacy Policy). The per-event
 * alerts stay text-free.
 *
 * Two servers sharing one Redis send it once: the first to claim the day's key
 * sends it. A failed send frees the key again after {@link RETRY_MS}.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** How often the server looks whether the summary is due. */
export const DAILY_SUMMARY_CHECK_MS = 5 * MINUTE_MS;

/** Not before 00:05 UTC, so the day's last errors and sign-ins are in. */
export const SEND_FROM_MS = 5 * MINUTE_MS;

/** Not after 12:00 UTC: a server that was down all morning skips the day rather than send it in the evening. */
export const SEND_UNTIL_MS = 12 * 60 * MINUTE_MS;

/** After a failed send, try again this much later. */
export const RETRY_MS = 15 * MINUTE_MS;

/** Kept three days, so a restart the same morning does not send it again. */
const SENT_TTL_SECONDS = 3 * 24 * 60 * 60;

/** The Redis key that says the summary for `day` went (or is going). */
export const dailySummaryKey = (day: string): string => `alerts:daily-summary:${day}`;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu 22 Oct" for `2026-10-22`. */
const dayName = (day: string): string => {
  const date = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
};

const count = (n: number | null): string => (n === null ? "?" : n.toLocaleString("en-US"));

/** The message for one day's summary and the problems open now. */
export const dailySummaryText = (summary: DailySummary, problems: readonly AlertState[], config: AlertConfig): string => {
  const { stat, players } = summary;
  const lines = [`BYMR daily summary, ${dayName(summary.day)} (UTC)`, ""];

  lines.push(`New players: ${count(stat.newPlayers)} (total ${count(players.total)})`);
  lines.push(`Active players: ${count(stat.activePlayers)} that day, ${count(players.active7)} in 7 days, ${count(players.active30)} in 30 days`);
  lines.push(`Attacks: ${count(stat.attacks)}, tribe raids: ${count(stat.tribeRaids)}`);

  const events = Object.entries(stat.eventPlayers ?? {}).filter(([, n]) => n > 0);
  if (events.length) lines.push(`Event players: ${events.map(([id, n]) => `${id} ${count(n)}`).join(", ")}`);

  const errorLine = `Errors: ${count(stat.browserErrors)} browser, ${count(stat.serverErrors)} server`;
  lines.push(summary.newErrors.length ? `${errorLine} (${summary.newErrors.length} new kind${summary.newErrors.length === 1 ? "" : "s"})` : errorLine);

  lines.push(problems.length ? `Problems open (${problems.length}): ${problems.map((p) => p.title).join("; ")}` : "Problems open: none");

  lines.push(`Bug reports: ${count(stat.bugReports)} that day, ${count(summary.openBugReports)} open in all`);
  for (const report of summary.bugReports) lines.push(`#${report.id} ${report.text || "(no text)"}`);
  if (stat.bugReports > summary.bugReports.length) lines.push(`and ${stat.bugReports - summary.bugReports.length} more`);

  const link = dashboardLink(summary.bugReports.length ? "bugs" : "health", config);
  if (link) lines.push("", link);
  return lines.join("\n");
};

export interface DailySummaryRedis extends AlertRedis {
  send(command: string, args: string[]): Promise<unknown>;
}

export interface DailySummaryDeps {
  readonly redis: DailySummaryRedis;
  /** `getDailySummary` for a finished day. */
  readonly summary: (day: string) => Promise<DailySummary>;
  /** Fakes for tests; the real settings and Telegram otherwise. */
  readonly config?: AlertConfig;
  readonly send?: SendTelegram;
}

export type DailySummaryRun =
  | { readonly sent: true; readonly day: string }
  | { readonly sent: false; readonly day: string | null; readonly reason: string };

/**
 * Sends yesterday's summary if it is due and not yet sent. Exported for tests
 * and the CLI.
 */
export const runDailySummary = async (deps: DailySummaryDeps, now: number = Date.now()): Promise<DailySummaryRun> => {
  const config = deps.config ?? alertConfig();
  if (!config.telegram) return { sent: false, day: null, reason: "Telegram is off" };

  const intoDay = now % DAY_MS;
  if (intoDay < SEND_FROM_MS || intoDay >= SEND_UNTIL_MS) return { sent: false, day: null, reason: "not due" };

  const day = utcDay(now - DAY_MS);
  const key = dailySummaryKey(day);
  const claimed = await deps.redis.send("SET", [key, String(now), "NX", "EX", String(SENT_TTL_SECONDS)]);
  if (claimed === null) return { sent: false, day, reason: "already sent" };

  let reason: string;
  try {
    const summary = await deps.summary(day);
    const problems = [...(await redisAlertStore(deps.redis).all()).values()];
    const outcome = await (deps.send ?? ((text: string) => sendTelegram(text, { config })))(dailySummaryText(summary, problems, config));
    if (outcome.sent) return { sent: true, day };
    reason = outcome.reason;
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }
  // Free the day again a little later, so the next check tries once more.
  await deps.redis.send("PEXPIRE", [key, String(RETRY_MS)]).catch(() => undefined);
  logger.warn(`Alerts: the daily summary for ${day} was not sent: ${reason}`);
  return { sent: false, day, reason };
};

/**
 * Starts the daily summary check, every {@link DAILY_SUMMARY_CHECK_MS}.
 * Returns the stop function, or null when Telegram is off.
 */
export const startDailySummary = (deps: DailySummaryDeps): (() => void) | null => {
  if (!(deps.config ?? alertConfig()).telegram) return null;

  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      await runDailySummary(deps);
    } catch (err) {
      logger.error(`Alerts: the daily summary check failed: ${err}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(check, DAILY_SUMMARY_CHECK_MS);
  return () => clearInterval(timer);
};
