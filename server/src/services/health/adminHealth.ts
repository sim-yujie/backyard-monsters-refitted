import { alertConfig } from "../../config/AlertConfig.js";
import { findProblems, redisAlertStore, type AlertRedis, type AlertState, type Problem } from "../alerts/alerts.js";
import { defaultErrorRateSource } from "../alerts/alertSweep.js";
import { healthSummary, type HealthDeps, type HealthSummary } from "./healthSummary.js";

/**
 * What the dashboard's health section shows, in one call
 * (docs/design/admin-dashboard-api.md, "Health"): the health summary, what is
 * wrong now by the same rules the Telegram alerts use, and which alerts are
 * open (already said). The owner-only route returns it as it is; so does
 * `bun run alerts:check`.
 */

export interface AdminHealthReport {
  readonly health: HealthSummary;
  /** What is wrong now. */
  readonly problems: readonly Problem[];
  /** Checks that could not run this time (no host.json, no error count). */
  readonly unchecked: readonly string[];
  /** Problems already sent to Telegram and not yet fixed, by key. */
  readonly openAlerts: Readonly<Record<string, AlertState>>;
  /** Whether the server sends Telegram alerts at all. */
  readonly telegram: boolean;
}

export interface AdminHealthDeps extends Pick<HealthDeps, "readHostStatus" | "containerDisk"> {
  readonly sql: HealthDeps["sql"];
  readonly redis: AlertRedis & { send(command: string, args: string[]): Promise<unknown> };
  readonly now?: number;
}

/** Builds the report; never rejects (a part that fails says so). */
export const adminHealthReport = async ({ sql, redis, readHostStatus, containerDisk, now = Date.now() }: AdminHealthDeps): Promise<AdminHealthReport> => {
  const config = alertConfig();
  const health = await healthSummary({ sql, redisSend: (command, args) => redis.send(command, args), readHostStatus, containerDisk, now });
  const open = await redisAlertStore(redis)
    .all()
    .catch(() => new Map<string, AlertState>());
  const errors = await defaultErrorRateSource(now).catch(() => null);
  const { problems, unchecked } = findProblems(health, errors, config, new Set(open.keys()));
  return { health, problems, unchecked, openAlerts: Object.fromEntries(open), telegram: config.telegram !== null };
};
