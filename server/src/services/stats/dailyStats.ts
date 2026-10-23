import type { EntityManager } from "@mikro-orm/postgresql";

import { logger } from "../../utils/logger.js";
import {
  activeKey,
  errorsKey,
  eventIdsKey,
  eventKey,
  raidsKey,
  utcDay,
  type ActivityRedis,
} from "./activity.js";
import { readLogDays, type LogDay } from "./logBackfill.js";
import { realPlayerIds, realPlayerSql } from "./realPlayers.js";

/**
 * The dashboard's daily numbers (`bym.daily_stat`, migration
 * `20261023_CreateDashboardTables.ts`): one row per finished UTC day, written
 * once the day is over by {@link fillDailyStats} (at start-up and hourly,
 * {@link startDailyStats}), and the live numbers for today
 * ({@link statsOverview}). {@link getDailySummary} is the daily Telegram
 * summary's source.
 *
 * Every player count leaves out bots and test accounts (`realPlayers.ts`).
 * What each number is and how far back it goes:
 *
 * - `newPlayers` / `totalPlayers`: accounts by the day they joined, the
 *   earlier of their main yard's creation and their accepting the terms at
 *   sign-up. Back to launch. An account that never opened its yard and
 *   signed up before the terms date was recorded (1 October 2026) has no
 *   join day and is not counted.
 * - `activePlayers`: distinct players who opened the game that day.
 *   From the day the dashboard started: the day-by-day record (`activity.ts`,
 *   source `tracked`). Before it: the log files' sign-ins
 *   (`logBackfill.ts`, source `logs`), only as far back as the files go (30
 *   days). Otherwise null. The dashboard's first day is `partial` when it has
 *   no log file, as its morning was not recorded.
 * - `attacks`: player attacks on players' yards started that day by a real
 *   player (`attack_logs`, kept 365 days).
 * - `tribeRaids`: wild monster raids that landed: tracked, or from the logs;
 *   null before both.
 * - `eventNewPlayers`: per event, players whose first progress in it was that
 *   day (`event_progress.created_at`); back to each event's start.
 *   `eventPlayers`: per event, players who made any progress that day; from
 *   the dashboard's start only (null before).
 * - `bugReports`: reports sent that day (signed in or not).
 * - `browserErrors` / `serverErrors`: errors that came in that day; from the
 *   dashboard's start only.
 */

export type ActiveSource = "tracked" | "logs" | "partial";

export interface DailyStat {
  readonly day: string;
  readonly newPlayers: number;
  readonly totalPlayers: number;
  readonly activePlayers: number | null;
  readonly activeSource: ActiveSource | null;
  readonly attacks: number;
  readonly tribeRaids: number | null;
  readonly eventNewPlayers: Readonly<Record<string, number>>;
  readonly eventPlayers: Readonly<Record<string, number>> | null;
  readonly bugReports: number;
  readonly browserErrors: number | null;
  readonly serverErrors: number | null;
}

export interface StatsDeps {
  readonly em: EntityManager;
  readonly redis: ActivityRedis;
  /** Where the log files are; null (or a missing folder) means none. */
  readonly logDir?: string | null;
  readonly logBase?: string;
}

/** The `bym.job_run` row that remembers when the day-by-day record began. */
export const TRACKING_JOB = "dashboard-tracking";
const TRACKING_PERIOD = "start";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The furthest back a fill goes, and how many days one round counts. */
export const MAX_BACKFILL_DAYS = 400;
const DAYS_PER_ROUND = 31;

/** How often the hourly check runs. */
const CHECK_MS = 60 * 60 * 1000;

const dayStart = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
const nextDay = (day: string): string => utcDay(dayStart(day).getTime() + DAY_MS);

/** Every day from `from` to `to`, both included. */
export const daysBetween = (from: string, to: string): string[] => {
  const days: string[] = [];
  for (let day = from; day <= to; day = nextDay(day)) days.push(day);
  return days;
};

/**
 * The UTC day the day-by-day record began: written the first time this runs
 * (so on the first start-up with the dashboard), read back ever after.
 */
export const trackingStartDay = async (em: EntityManager, now: number = Date.now()): Promise<string> => {
  await em.execute(`INSERT INTO bym.job_run (job, period, ran_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`, [
    TRACKING_JOB,
    TRACKING_PERIOD,
    new Date(now),
  ]);
  const [row] = await em.execute<{ ran_at: Date | string }[]>(
    `SELECT ran_at FROM bym.job_run WHERE job = ? AND period = ?`,
    [TRACKING_JOB, TRACKING_PERIOD]
  );
  return utcDay(row ? new Date(row.ran_at) : new Date(now));
};

/** The SQL for each real player's join time (see the module comment). */
const JOINED_SQL = `
  SELECT u.userid, LEAST(s.created_at, u.terms_accepted_at) AS joined
    FROM bym."user" u
    LEFT JOIN bym.save s ON s.userid = u.userid AND s.type = 'main'
   WHERE ${realPlayerSql("u")}`;

const countsByDay = (rows: { day: string; n: number | string }[]): Map<string, number> =>
  new Map(rows.map((row) => [row.day, Number(row.n) || 0]));

/** What the database says about `days` (consecutive, oldest first). */
const databaseCounts = async (em: EntityManager, days: readonly string[]) => {
  const from = dayStart(days[0]!);
  const to = dayStart(nextDay(days[days.length - 1]!));
  const dayOf = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

  const [joinedBefore] = await em.execute<{ n: number | string }[]>(
    `SELECT count(*) AS n FROM (${JOINED_SQL}) j WHERE j.joined < ?`,
    [from]
  );
  const joined = await em.execute<{ day: string; n: number | string }[]>(
    `SELECT ${dayOf("j.joined")} AS day, count(*) AS n FROM (${JOINED_SQL}) j
      WHERE j.joined >= ? AND j.joined < ? GROUP BY 1`,
    [from, to]
  );
  const attacks = await em.execute<{ day: string; n: number | string }[]>(
    `SELECT ${dayOf("a.attacktime")} AS day, count(*) AS n
       FROM bym.attack_logs a JOIN bym."user" u ON u.userid = a.attacker_userid
      WHERE a.attacktime >= ? AND a.attacktime < ? AND ${realPlayerSql("u")} GROUP BY 1`,
    [from, to]
  );
  const bugReports = await em.execute<{ day: string; n: number | string }[]>(
    `SELECT ${dayOf("created_at")} AS day, count(*) AS n FROM bym.bug_report
      WHERE created_at >= ? AND created_at < ? GROUP BY 1`,
    [from, to]
  );
  const eventNew = await em.execute<{ day: string; event_id: string; n: number | string }[]>(
    `SELECT ${dayOf("p.created_at")} AS day, p.event_id, count(*) AS n
       FROM bym.event_progress p JOIN bym."user" u ON u.userid = p.userid
      WHERE p.created_at >= ? AND p.created_at < ? AND ${realPlayerSql("u")} GROUP BY 1, 2`,
    [from, to]
  );

  const eventNewByDay = new Map<string, Record<string, number>>();
  for (const row of eventNew) {
    const into = eventNewByDay.get(row.day) ?? {};
    into[row.event_id] = Number(row.n) || 0;
    eventNewByDay.set(row.day, into);
  }
  return {
    joinedBefore: Number(joinedBefore?.n ?? 0),
    joined: countsByDay(joined),
    attacks: countsByDay(attacks),
    bugReports: countsByDay(bugReports),
    eventNew: eventNewByDay,
  };
};

const numberOf = (raw: string | null): number => Number(raw ?? 0) || 0;

/** The day-by-day record of one day: real players seen, per-event players, raids and errors. */
const trackedCounts = async (deps: StatsDeps, day: string) => {
  const { em, redis } = deps;
  const active = await redis.smembers(activeKey(day));
  const eventIds = await redis.smembers(eventIdsKey(day));
  const eventPlayers: Record<string, number> = {};
  for (const eventId of eventIds.sort()) {
    const members = await redis.smembers(eventKey(day, eventId));
    eventPlayers[eventId] = (await realPlayerIds(em, members.map(Number))).length;
  }
  return {
    active: new Set(await realPlayerIds(em, active.map(Number))),
    eventPlayers,
    raids: numberOf(await redis.get(raidsKey(day))),
    browserErrors: numberOf(await redis.get(errorsKey(day, "browser"))),
    serverErrors: numberOf(await redis.get(errorsKey(day, "server"))),
  };
};

/**
 * Counts `days` (consecutive, oldest first; at most a month or so at a time).
 * `startDay` is when the day-by-day record began; a day on or after it is
 * read from Redis, a day before it (or the start day itself) from the log
 * files where there are any. Today counts as far as it has gone.
 */
export const computeDays = async (deps: StatsDeps, days: readonly string[], startDay: string): Promise<DailyStat[]> => {
  if (days.length === 0) return [];
  const db = await databaseCounts(deps.em, days);

  const fromLogs = days.filter((day) => day <= startDay);
  const logs: Map<string, LogDay> =
    deps.logDir && fromLogs.length > 0 ? await readLogDays(deps.logDir, deps.logBase ?? "bymr", fromLogs) : new Map();

  const stats: DailyStat[] = [];
  let total = db.joinedBefore;
  for (const day of days) {
    const newPlayers = db.joined.get(day) ?? 0;
    total += newPlayers;
    const log = logs.get(day);
    const tracked = day >= startDay ? await trackedCounts(deps, day) : null;
    const logActive = log ? new Set(await realPlayerIds(deps.em, log.logins)) : null;

    let activePlayers: number | null = null;
    let activeSource: ActiveSource | null = null;
    if (tracked && day > startDay) {
      activePlayers = tracked.active.size;
      activeSource = "tracked";
    } else if (logActive) {
      activePlayers = new Set([...logActive, ...(tracked?.active ?? [])]).size;
      activeSource = "logs";
    } else if (tracked) {
      activePlayers = tracked.active.size;
      activeSource = "partial";
    }

    stats.push({
      day,
      newPlayers,
      totalPlayers: total,
      activePlayers,
      activeSource,
      attacks: db.attacks.get(day) ?? 0,
      tribeRaids: log && day <= startDay ? log.raids : (tracked?.raids ?? null),
      eventNewPlayers: db.eventNew.get(day) ?? {},
      eventPlayers: tracked ? tracked.eventPlayers : null,
      bugReports: db.bugReports.get(day) ?? 0,
      browserErrors: tracked ? tracked.browserErrors : null,
      serverErrors: tracked ? tracked.serverErrors : null,
    });
  }
  return stats;
};

interface DailyStatRow {
  day: string;
  new_players: number | string;
  total_players: number | string;
  active_players: number | string | null;
  active_source: string | null;
  attacks: number | string;
  tribe_raids: number | string | null;
  event_new_players: unknown;
  event_players: unknown;
  bug_reports: number | string;
  browser_errors: number | string | null;
  server_errors: number | string | null;
}

const jsonOf = (raw: unknown): unknown => (typeof raw === "string" ? JSON.parse(raw) : raw);
const countsOf = (raw: unknown): Record<string, number> => {
  const value = jsonOf(raw);
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, n]) => [key, Number(n) || 0]));
};
const orNull = (raw: number | string | null): number | null => (raw === null ? null : Number(raw));

const statOf = (row: DailyStatRow): DailyStat => ({
  day: row.day,
  newPlayers: Number(row.new_players),
  totalPlayers: Number(row.total_players),
  activePlayers: orNull(row.active_players),
  activeSource: (row.active_source as ActiveSource | null) ?? null,
  attacks: Number(row.attacks),
  tribeRaids: orNull(row.tribe_raids),
  eventNewPlayers: countsOf(row.event_new_players),
  eventPlayers: jsonOf(row.event_players) === null ? null : countsOf(row.event_players),
  bugReports: Number(row.bug_reports),
  browserErrors: orNull(row.browser_errors),
  serverErrors: orNull(row.server_errors),
});

/** The stored days from `from` to `to` (both included), oldest first. */
export const readDailyStats = async (em: EntityManager, from: string, to: string): Promise<DailyStat[]> => {
  const rows = await em.execute<DailyStatRow[]>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, new_players, total_players, active_players, active_source, attacks,
            tribe_raids, event_new_players, event_players, bug_reports, browser_errors, server_errors
       FROM bym.daily_stat WHERE day >= ?::date AND day <= ?::date ORDER BY day`,
    [from, to]
  );
  return rows.map(statOf);
};

/** Writes days not stored yet; a day already there is left as it is. */
const insertDays = async (em: EntityManager, stats: readonly DailyStat[]): Promise<void> => {
  for (const stat of stats) {
    await em.execute(
      `INSERT INTO bym.daily_stat
         (day, new_players, total_players, active_players, active_source, attacks, tribe_raids,
          event_new_players, event_players, bug_reports, browser_errors, server_errors)
       VALUES (?::date, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?)
       ON CONFLICT (day) DO NOTHING`,
      [
        stat.day,
        stat.newPlayers,
        stat.totalPlayers,
        stat.activePlayers,
        stat.activeSource,
        stat.attacks,
        stat.tribeRaids,
        JSON.stringify(stat.eventNewPlayers),
        stat.eventPlayers === null ? null : JSON.stringify(stat.eventPlayers),
        stat.bugReports,
        stat.browserErrors,
        stat.serverErrors,
      ]
    );
  }
};

/** The first day worth counting: the earliest real player's join day, at most {@link MAX_BACKFILL_DAYS} back. */
const firstDay = async (em: EntityManager, yesterday: string, startDay: string): Promise<string> => {
  const [row] = await em.execute<{ day: string | null }[]>(
    `SELECT to_char(min(j.joined) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day FROM (${JOINED_SQL}) j`
  );
  const limit = utcDay(dayStart(yesterday).getTime() - (MAX_BACKFILL_DAYS - 1) * DAY_MS);
  const earliest = row?.day ?? startDay;
  return earliest < limit ? limit : earliest;
};

/**
 * Counts and stores every finished day not stored yet, from the first
 * player's join day (at most {@link MAX_BACKFILL_DAYS} back) to yesterday.
 * Safe to run on two servers at once: a day is written once and never
 * changed. Returns the days it wrote.
 */
export const fillDailyStats = async (deps: StatsDeps, now: number = Date.now()): Promise<string[]> => {
  const startDay = await trackingStartDay(deps.em, now);
  const yesterday = utcDay(now - DAY_MS);
  const from = await firstDay(deps.em, yesterday, startDay);
  if (from > yesterday) return [];

  const stored = new Set(
    (
      await deps.em.execute<{ day: string }[]>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day FROM bym.daily_stat WHERE day >= ?::date AND day <= ?::date`,
        [from, yesterday]
      )
    ).map((row) => row.day)
  );
  const missing = daysBetween(from, yesterday).filter((day) => !stored.has(day));

  const written: string[] = [];
  // Consecutive runs, a month at a time, so each round's queries stay small.
  let run: string[] = [];
  const flush = async () => {
    if (run.length === 0) return;
    await insertDays(deps.em, await computeDays(deps, run, startDay));
    written.push(...run);
    run = [];
  };
  for (const day of missing) {
    if (run.length > 0 && (run.length >= DAYS_PER_ROUND || nextDay(run[run.length - 1]!) !== day)) await flush();
    run.push(day);
  }
  await flush();
  return written;
};

/**
 * Starts the daily count (`server.ts`): at boot (which also notes the day the
 * record began), then every hour. Returns the stop function.
 */
export const startDailyStats = (deps: StatsDeps): (() => void) => {
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      const written = await fillDailyStats({ ...deps, em: deps.em.fork() });
      if (written.length > 0) {
        logger.info("Dashboard daily stats: counted {count} day(s), {from} to {to}", {
          count: written.length,
          from: written[0],
          to: written[written.length - 1],
        });
      }
    } catch (err) {
      logger.error(`Dashboard daily stats failed: ${err}`);
    } finally {
      running = false;
    }
  };
  void check();
  const timer = setInterval(check, CHECK_MS);
  return () => clearInterval(timer);
};

export interface PlayerTotals {
  /** Real players with a join day. */
  readonly total: number;
  /** Seen today (UTC), in the last 7 days, in the last 30 days, up to now. */
  readonly activeToday: number;
  readonly active7: number;
  readonly active30: number;
}

/**
 * Players seen recently, as of `now`: `user.last_seen_at` (an own-yard load,
 * written at most hourly) or today's day-by-day record.
 */
export const playerTotals = async (deps: StatsDeps, now: number = Date.now()): Promise<PlayerTotals> => {
  const today = utcDay(now);
  const seenToday = (await deps.redis.smembers(activeKey(today))).map(Number).filter((id) => Number.isSafeInteger(id));
  const ids = `{${seenToday.join(",")}}`;
  const [row] = await deps.em.execute<Record<string, number | string>[]>(
    `SELECT
       (SELECT count(*) FROM (${JOINED_SQL}) j WHERE j.joined IS NOT NULL) AS total,
       count(*) FILTER (WHERE u.last_seen_at >= ? OR u.userid = ANY(?::int[])) AS today,
       count(*) FILTER (WHERE u.last_seen_at >= ? OR u.userid = ANY(?::int[])) AS week,
       count(*) FILTER (WHERE u.last_seen_at >= ? OR u.userid = ANY(?::int[])) AS month
     FROM bym."user" u
     WHERE (u.last_seen_at >= ? OR u.userid = ANY(?::int[])) AND ${realPlayerSql("u")}`,
    [
      dayStart(today),
      ids,
      new Date(now - 7 * DAY_MS),
      ids,
      new Date(now - 30 * DAY_MS),
      ids,
      new Date(now - 30 * DAY_MS),
      ids,
    ]
  );
  return {
    total: Number(row?.total ?? 0),
    activeToday: Number(row?.today ?? 0),
    active7: Number(row?.week ?? 0),
    active30: Number(row?.month ?? 0),
  };
};

export interface StatsOverview {
  readonly generatedAt: string;
  readonly players: PlayerTotals;
  /** Today so far (UTC), counted live. */
  readonly today: DailyStat;
  /** Stored days, oldest first, ending yesterday. */
  readonly days: readonly DailyStat[];
}

/** The dashboard's front page: totals, today so far and the last `days` finished days. */
export const statsOverview = async (deps: StatsDeps, days = 30, now: number = Date.now()): Promise<StatsOverview> => {
  const startDay = await trackingStartDay(deps.em, now);
  const today = utcDay(now);
  const yesterday = utcDay(now - DAY_MS);
  const from = utcDay(now - Math.max(1, days) * DAY_MS);
  const [todayStat] = await computeDays({ ...deps, logDir: null }, [today], startDay);
  return {
    generatedAt: new Date(now).toISOString(),
    players: await playerTotals(deps, now),
    today: todayStat!,
    days: await readDailyStats(deps.em, from, yesterday),
  };
};

export interface DailySummary {
  readonly day: string;
  /** The day's stored numbers (counted now if they were not yet). */
  readonly stat: DailyStat;
  /** As of the moment the summary was made. */
  readonly players: PlayerTotals;
  /** Kinds of error first seen that day, most frequent first (at most 5). */
  readonly newErrors: readonly { id: number; source: string; count: number }[];
  /** Bug reports sent that day (at most 10), oldest first. */
  readonly bugReports: readonly { id: number }[];
}

/**
 * The numbers for the daily summary of finished UTC day `day` (`YYYY-MM-DD`):
 * the day's row (counted first if the hourly count has not reached it yet),
 * players seen recently, new kinds of error and the day's bug reports.
 *
 * Numbers only, never words: the summary goes to Telegram, an outside
 * service, so it carries no player-written text, error text, names or emails
 * (docs/alerts.md, "Privacy"). The dashboard shows the rest.
 *
 * With no `deps`, uses the running server's database and Redis.
 *
 * @throws {Error} When `day` is not a date, or is today or later (not over yet).
 */
export const getDailySummary = async (day: string, deps?: StatsDeps, now: number = Date.now()): Promise<DailySummary> => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(dayStart(day).getTime())) throw new Error(`Not a day: ${day}`);
  if (day >= utcDay(now)) throw new Error(`Day ${day} is not over yet`);
  const use = deps ?? (await serverDeps());

  let [stat] = await readDailyStats(use.em, day, day);
  if (!stat) {
    await fillDailyStats(use, now);
    [stat] = await readDailyStats(use.em, day, day);
  }
  if (!stat) {
    // Older than the fill reaches (before the first player): count it on its own.
    [stat] = await computeDays(use, [day], await trackingStartDay(use.em, now));
  }

  const from = dayStart(day);
  const to = dayStart(nextDay(day));
  const newErrors = await use.em.execute<{ id: number | string; source: string; count: number | string }[]>(
    `SELECT id, source, count FROM bym.app_error WHERE first_seen >= ? AND first_seen < ?
      ORDER BY count DESC, id LIMIT 5`,
    [from, to]
  );
  const reports = await use.em.execute<{ id: number | string }[]>(
    `SELECT id FROM bym.bug_report WHERE created_at >= ? AND created_at < ? ORDER BY id LIMIT 10`,
    [from, to]
  );
  return {
    day,
    stat: stat!,
    players: await playerTotals(use, now),
    newErrors: newErrors.map((row) => ({ id: Number(row.id), source: row.source, count: Number(row.count) })),
    bugReports: reports.map((row) => ({ id: Number(row.id) })),
  };
};

/** The running server's database, Redis and log folder. Importing `server.js` boots it, so only on demand. */
const serverDeps = async (): Promise<StatsDeps> => {
  const [{ postgres, redis }, { LOG_DIR, LOG_BASE }, { Env }] = await Promise.all([
    import("../../server.js"),
    import("../../utils/logger.js"),
    import("../../enums/Env.js"),
  ]);
  return { em: postgres.em.fork(), redis, logDir: process.env.ENV === Env.LOCAL ? null : LOG_DIR, logBase: LOG_BASE };
};
