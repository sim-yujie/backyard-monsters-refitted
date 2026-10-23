import { positiveNumber } from "./BotConfig.js";

/**
 * Telegram alerts to the owner (`services/alerts/`, docs/alerts.md).
 *
 * - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — the bot that sends and the chat
 *   it sends to. Alerts are off unless both are set.
 * - `ADMIN_DASHBOARD_URL` — where each alert links. Unset: `WEB_URL` + `/admin`
 *   (the hidden dashboard page on the game page).
 * - `ALERT_DISK_PERCENT` — a disk this full (default 90) is "nearly full".
 * - `ALERT_BACKUP_HOURS` — no new backup for this long (default 26: one a day,
 *   with slack) is a missed nightly backup.
 * - `ALERT_ERRORS_MIN`, `ALERT_ERRORS_FACTOR` — a "sudden jump in errors" is at
 *   least ERRORS_MIN server errors in 10 minutes and at least FACTOR times the
 *   usual 10 minutes over the past day (defaults 20 and 5).
 *
 * Read on each call rather than once at import, so tests can change them.
 */

export const DEFAULT_DISK_PERCENT = 90;
export const DEFAULT_BACKUP_HOURS = 26;
export const DEFAULT_ERRORS_MIN = 20;
export const DEFAULT_ERRORS_FACTOR = 5;

/** A problem still not fixed is said again this often. */
export const ALERT_REMINDER_MS = 12 * 60 * 60 * 1000;

/** At most this many new-bug-report messages an hour; the rest wait for the dashboard. */
export const BUG_REPORT_ALERTS_PER_HOUR = 10;

/** host.json older than this means deploy/host-status.sh has stopped running. */
export const HOST_STATUS_STALE_MS = 10 * 60 * 1000;

export interface AlertConfig {
  readonly telegram: { readonly token: string; readonly chatId: string } | null;
  /** The dashboard page, without a section; null when neither setting names one. */
  readonly dashboardUrl: string | null;
  readonly diskPercent: number;
  readonly backupHours: number;
  readonly errorsMin: number;
  readonly errorsFactor: number;
}

/** The alert settings as the environment sets them now. */
export const alertConfig = (env: Record<string, string | undefined> = process.env): AlertConfig => {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatId = env.TELEGRAM_CHAT_ID?.trim() ?? "";
  const webUrl = env.WEB_URL?.trim().replace(/\/+$/, "");
  return {
    telegram: token && chatId ? { token, chatId } : null,
    dashboardUrl: env.ADMIN_DASHBOARD_URL?.trim() || (webUrl ? `${webUrl}/admin` : null),
    diskPercent: Math.min(positiveNumber(env.ALERT_DISK_PERCENT, DEFAULT_DISK_PERCENT), 100),
    backupHours: positiveNumber(env.ALERT_BACKUP_HOURS, DEFAULT_BACKUP_HOURS),
    errorsMin: positiveNumber(env.ALERT_ERRORS_MIN, DEFAULT_ERRORS_MIN),
    errorsFactor: positiveNumber(env.ALERT_ERRORS_FACTOR, DEFAULT_ERRORS_FACTOR),
  };
};

/** The dashboard sections alerts link to; the admin page answers to each `#name`. */
export type DashboardSection = "health" | "errors" | "bugs" | "backups";

/** The link to one dashboard section, or null when there is no dashboard address. */
export const dashboardLink = (section: DashboardSection, config: AlertConfig = alertConfig()): string | null =>
  config.dashboardUrl ? `${config.dashboardUrl}#${section}` : null;
