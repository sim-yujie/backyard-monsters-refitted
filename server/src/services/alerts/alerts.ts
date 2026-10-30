import { ALERT_REMINDER_MS, dashboardLink, type AlertConfig, type DashboardSection } from "../../config/AlertConfig.js";
import type { HealthSummary } from "../health/healthSummary.js";
import type { SendTelegram } from "./telegram.js";

/**
 * Which problems the owner is told about on Telegram (docs/alerts.md), and the
 * rules that keep it to one message per problem:
 *
 * - A new problem is said once ("Problem: ..."), with a link to the dashboard
 *   section that shows it.
 * - While it lasts, it is said again only every 12 hours ("Still a problem").
 * - When it clears, one "Fixed: ..." message says how long it lasted.
 * - A message that could not be sent is tried again at the next check.
 *
 * What is open is kept in Redis (`redisAlertStore`), so a restart neither
 * repeats a problem nor forgets to say it was fixed.
 *
 * "Game server down" and "game page down" cannot be sent from here (a server
 * that is down sends nothing); the outside check in
 * `.github/workflows/uptime-check.yml` covers those.
 */

/** One thing wrong now. */
export interface Problem {
  /** Stable across checks; the same key is the same problem. */
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly section: DashboardSection;
}

/** An open problem, as kept between checks. */
export interface AlertState {
  readonly title: string;
  readonly section: DashboardSection;
  /** When it was first said, epoch milliseconds. */
  readonly since: number;
  /** When it was last said. */
  readonly lastSentAt: number;
}

/** Where open problems are kept, swappable in tests. */
export interface AlertStore {
  all(): Promise<Map<string, AlertState>>;
  put(key: string, state: AlertState): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Server errors per 10 minutes, for the "sudden jump in errors" check. */
export interface ErrorRate {
  /** Errors in the last 10 minutes. */
  readonly recent: number;
  /** The usual 10 minutes over the past day (an average). */
  readonly usual: number;
}

/** What the checks found: what is wrong, and which keys could not be checked this time. */
export interface CheckResult {
  readonly problems: readonly Problem[];
  /** Open problems under these keys are left as they are, neither repeated nor fixed. */
  readonly unchecked: readonly string[];
}

const GB = 1024 ** 3;

const size = (bytes: number | null): string => {
  if (bytes === null) return "?";
  return bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
};

/** "3 h 5 min", "40 min", "2 days 4 h". */
export const duration = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return `${days} day${days === 1 ? "" : "s"}${hours ? ` ${hours} h` : ""}`;
  if (hours) return `${hours} h${mins ? ` ${mins} min` : ""}`;
  return `${mins} min`;
};

/** The disk check stays open until a disk is this many points below the limit, so it does not flicker. */
const DISK_RECOVERY_MARGIN = 3;

/** The same for Redis's memory. */
const REDIS_RECOVERY_MARGIN = 5;

/**
 * Finds what is wrong in a health summary (and the error rate, when there is an
 * error count to read).
 *
 * @param {HealthSummary} health - From `healthSummary`.
 * @param {ErrorRate | null} errors - null while no error count is available.
 * @param {AlertConfig} config - The limits.
 * @param {ReadonlySet<string>} open - Keys open now (for the disk check's margin).
 */
export const findProblems = (
  health: HealthSummary,
  errors: ErrorRate | null,
  config: AlertConfig,
  open: ReadonlySet<string> = new Set()
): CheckResult => {
  const problems: Problem[] = [];
  const unchecked: string[] = [];

  if (!health.database.ok) {
    problems.push({
      key: "database",
      title: "The database is not answering",
      detail: `The game server cannot reach its database: ${health.database.error ?? "no answer"}. Players cannot load or save.`,
      section: "health",
    });
  }

  if (!health.redis.ok) {
    problems.push({
      key: "redis",
      title: "Redis is not answering",
      detail: `The game server cannot reach Redis: ${health.redis.error ?? "no answer"}. Logins and chat stop working.`,
      section: "health",
    });
  }

  // Redis's memory against its own cap (docker-compose.prod.yml: 160 MB,
  // volatile-lru). Near the cap it starts dropping keys that expire, the
  // sign-in back-off counts among them (security audit 2026-10-29).
  if (!health.redis.ok) {
    unchecked.push("redis-memory", "redis-evictions");
  } else {
    const { usedMemoryBytes: used, maxMemoryBytes: max, evictedKeys } = health.redis;
    if (used !== null && max) {
      const percent = Math.round((used / max) * 100);
      const limit = open.has("redis-memory") ? config.redisMemoryPercent - REDIS_RECOVERY_MARGIN : config.redisMemoryPercent;
      if (percent >= limit) {
        problems.push({
          key: "redis-memory",
          title: "Redis is nearly full",
          detail: `Redis holds ${size(used)} of its ${size(max)} cap (${percent}%). When full it drops keys that expire (caches, presence, sign-in back-off counts) to make room.`,
          section: "health",
        });
      }
    }
    if ((evictedKeys ?? 0) > 0) {
      problems.push({
        key: "redis-evictions",
        title: "Redis has dropped keys to save memory",
        detail: `Redis has dropped ${evictedKeys} key${evictedKeys === 1 ? "" : "s"} to stay under its cap since it last started. Raise maxmemory in docker-compose.prod.yml, or find what is filling it; the count goes back to 0 when Redis restarts.`,
        section: "health",
      });
    }
  }

  if (!health.host || health.host.stale) {
    problems.push({
      key: "host-status",
      title: "The server's health check has stopped",
      detail: health.host
        ? `status/host.json was last written at ${health.host.generatedAt}. Until deploy/host-status.sh runs again, disk, container and backup checks are blind.`
        : "status/host.json is missing, so disk, container and backup checks are blind. Is the bymr-host-status timer installed (docs/alerts.md)?",
      section: "health",
    });
  }

  // The fullest disk; nearly full, or still too full to call fixed.
  const fullest = [...health.disks]
    .filter((disk) => disk.usedPercent !== null)
    .sort((a, b) => (b.usedPercent ?? 0) - (a.usedPercent ?? 0))[0];
  if (!fullest) {
    unchecked.push("disk");
  } else {
    const limit = open.has("disk") ? config.diskPercent - DISK_RECOVERY_MARGIN : config.diskPercent;
    if ((fullest.usedPercent ?? 0) >= limit) {
      problems.push({
        key: "disk",
        title: "The server's disk is nearly full",
        detail: `Disk ${fullest.mount} is ${fullest.usedPercent}% full (${size(fullest.availableBytes)} left). When it fills up, saves and backups fail.`,
        section: "health",
      });
    }
  }

  // Backups: only host.json can see them; without it the host-status problem says so.
  if (!health.backups || health.host?.stale) {
    unchecked.push("backup");
  } else {
    const newest = health.backups.newest;
    if (!newest || newest.ageHours === null || newest.ageHours >= config.backupHours) {
      problems.push({
        key: "backup",
        title: "The nightly backup was missed",
        detail: newest
          ? `The newest database backup (${newest.name}) is ${newest.ageHours ?? "?"} hours old.`
          : "There is no database backup in server/backups/ at all.",
        section: "backups",
      });
    }
  }

  if (!errors) {
    unchecked.push("errors");
  } else if (errors.recent >= config.errorsMin && errors.recent >= config.errorsFactor * errors.usual) {
    problems.push({
      key: "errors",
      title: "Sudden jump in server errors",
      detail: `${errors.recent} server errors in the last 10 minutes; usually about ${Math.round(errors.usual)}.`,
      section: "errors",
    });
  }

  return { problems, unchecked };
};

/** The text of one message: what, the detail, and the dashboard link. */
const message = (head: string, body: string, section: DashboardSection, config: AlertConfig): string => {
  const link = dashboardLink(section, config);
  return [`BYMR ${head}`, body, link].filter(Boolean).join("\n");
};

export interface AlertRun {
  readonly sent: readonly string[];
  readonly failed: readonly string[];
}

/**
 * Compares what is wrong now with what was open, and sends what is new,
 * overdue for a reminder, or fixed.
 *
 * @returns {Promise<AlertRun>} The messages sent and those that failed (tried again next time).
 */
export const runAlertRules = async (
  result: CheckResult,
  { store, send, config, now = Date.now() }: { store: AlertStore; send: SendTelegram; config: AlertConfig; now?: number }
): Promise<AlertRun> => {
  const open = await store.all();
  const sent: string[] = [];
  const failed: string[] = [];
  const say = async (text: string): Promise<boolean> => {
    const outcome = await send(text);
    (outcome.sent ? sent : failed).push(text);
    return outcome.sent;
  };

  for (const problem of result.problems) {
    const state = open.get(problem.key);
    if (!state) {
      if (await say(message(`problem: ${problem.title}`, problem.detail, problem.section, config))) {
        await store.put(problem.key, { title: problem.title, section: problem.section, since: now, lastSentAt: now });
      }
    } else if (now - state.lastSentAt >= ALERT_REMINDER_MS) {
      const head = `still a problem (for ${duration(now - state.since)}): ${problem.title}`;
      if (await say(message(head, problem.detail, problem.section, config))) {
        await store.put(problem.key, { ...state, lastSentAt: now });
      }
    }
  }

  const current = new Set(result.problems.map((problem) => problem.key));
  for (const [key, state] of open) {
    if (current.has(key) || result.unchecked.includes(key)) continue;
    const body = `It lasted ${duration(now - state.since)}.`;
    if (await say(message(`fixed: ${state.title}`, body, state.section, config))) await store.remove(key);
  }

  return { sent, failed };
};

/** The part of Bun's Redis client the alert store uses. */
export interface AlertRedis {
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, fields: Record<string, string>): Promise<number>;
  hdel(key: string, field: string): Promise<number>;
}

/** The Redis hash of open problems: one field per key, a JSON `AlertState` each. */
export const ALERTS_OPEN_KEY = "alerts:open";

export const redisAlertStore = (redis: AlertRedis): AlertStore => ({
  async all() {
    const open = new Map<string, AlertState>();
    for (const [key, value] of Object.entries((await redis.hgetall(ALERTS_OPEN_KEY)) ?? {})) {
      try {
        open.set(key, JSON.parse(value) as AlertState);
      } catch {
        // A broken entry is dropped; the problem, if still there, is said again.
      }
    }
    return open;
  },
  async put(key, state) {
    await redis.hset(ALERTS_OPEN_KEY, { [key]: JSON.stringify(state) });
  },
  async remove(key) {
    await redis.hdel(ALERTS_OPEN_KEY, key);
  },
});

/** For tests and the CLI: open problems in memory. */
export const memoryAlertStore = (open: Map<string, AlertState> = new Map()): AlertStore => ({
  all: async () => new Map(open),
  put: async (key, state) => void open.set(key, state),
  remove: async (key) => void open.delete(key),
});
