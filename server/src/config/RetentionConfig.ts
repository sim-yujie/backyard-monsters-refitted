import { positiveNumber } from "./BotConfig.js";

/**
 * How long the server keeps personal data before deleting it on its own, in
 * days (the Privacy Policy, section 4). Each is one environment variable, so
 * the owner can change a limit without touching code; anything unset or not a
 * positive number falls back to the default.
 *
 * - `LOG_RETENTION_DAYS`         — the server's own log files (`logs/`), which
 *                                  hold IP addresses. Default 30.
 * - `MAIL_RETENTION_DAYS`        — in-game mail between players. Default 365.
 * - `ATTACK_LOG_RETENTION_DAYS`  — battle records (`attack_logs`). Default 365.
 * - `CHAT_REPORT_RETENTION_DAYS` — reports of chat lines (`chat_report`). Default 365.
 * - `BUG_REPORT_RETENTION_DAYS`  — bug reports sent from the game (`bug_report`). Default 180.
 * - `CHAT_LOG_RETENTION_DAYS`    — the dashboard's full log of World and country
 *                                  chat (`chat_log`), unmasked. Default 90.
 *
 * The automatic chat flags (`chat_flag`) and the dashboard's chat report cases
 * (`chat_case`, with their copies of the room; counted from the last report)
 * are kept as long as chat reports.
 *
 * The daily clean-up (`services/privacy/retention.ts`) deletes mail, battle
 * records, chat reports and flags, bug reports and chat log lines older than these; the log sink
 * (`utils/logFiles.ts`) deletes old log files. Read on each call rather than
 * once at import, so tests can change them.
 */

export const DEFAULT_LOG_RETENTION_DAYS = 30;
export const DEFAULT_MAIL_RETENTION_DAYS = 365;
export const DEFAULT_ATTACK_LOG_RETENTION_DAYS = 365;
export const DEFAULT_CHAT_REPORT_RETENTION_DAYS = 365;
export const DEFAULT_BUG_REPORT_RETENTION_DAYS = 180;
export const DEFAULT_CHAT_LOG_RETENTION_DAYS = 90;

export interface RetentionConfig {
  readonly logDays: number;
  readonly mailDays: number;
  readonly attackLogDays: number;
  readonly chatReportDays: number;
  readonly bugReportDays: number;
  readonly chatLogDays: number;
}

/** The retention limits as the environment sets them now. */
export const retentionConfig = (env: Record<string, string | undefined> = process.env): RetentionConfig => ({
  logDays: positiveNumber(env.LOG_RETENTION_DAYS, DEFAULT_LOG_RETENTION_DAYS),
  mailDays: positiveNumber(env.MAIL_RETENTION_DAYS, DEFAULT_MAIL_RETENTION_DAYS),
  attackLogDays: positiveNumber(env.ATTACK_LOG_RETENTION_DAYS, DEFAULT_ATTACK_LOG_RETENTION_DAYS),
  chatReportDays: positiveNumber(env.CHAT_REPORT_RETENTION_DAYS, DEFAULT_CHAT_REPORT_RETENTION_DAYS),
  bugReportDays: positiveNumber(env.BUG_REPORT_RETENTION_DAYS, DEFAULT_BUG_REPORT_RETENTION_DAYS),
  chatLogDays: positiveNumber(env.CHAT_LOG_RETENTION_DAYS, DEFAULT_CHAT_LOG_RETENTION_DAYS),
});
