import type { EntityManager } from "@mikro-orm/postgresql";

import { REPORTERS_KEPT, takeCapturedErrors, type ErrorReporter } from "../../utils/errorCapture.js";
import { logger } from "../../utils/logger.js";
import { noteServerErrors } from "../alerts/errorRate.js";
import { noteErrors, type ErrorSource } from "../stats/activity.js";
import { isThirdPartyError } from "./errorText.js";

/**
 * Errors for the owner's dashboard (`bym.app_error`, migration
 * `20261023_CreateDashboardTables.ts`): browser errors the web client sends
 * on its own (`controllers/errors/clientErrors.ts`) and the server's own
 * error log lines (`utils/errorCapture.ts`, moved in by
 * {@link startServerErrorFlush}).
 *
 * One row per kind of error (`errorText.ts`: same source, message and place,
 * numbers and build hashes aside) with how many times it happened and when
 * it was first and last seen. The words are scrubbed of emails, addresses
 * and tokens before they get here. What is kept about players: a few recent
 * account numbers ({@link USERIDS_KEPT}), and in `bym.app_error_reporter`
 * (migration `20261103_CreateAppErrorReporterTable.ts`) the last few senders
 * of each kind ({@link REPORTERS_KEPT}): account number and name when signed
 * in, and address, as the server read them from the request, never from what
 * the request says. They are shown only on the owner's dashboard; a sender
 * goes {@link ERROR_RETENTION_DAYS} days after it last hit the error, and with
 * its account when the account is deleted.
 *
 * At most {@link ERROR_GROUPS_MAX} kinds are kept: when full, new kinds are
 * dropped and only the ones already there keep counting. The daily clean-up
 * (`services/privacy/retention.ts`) deletes kinds not seen for
 * {@link ERROR_RETENTION_DAYS} days.
 */

export const ERROR_GROUPS_MAX = 5000;
export const ERROR_RETENTION_DAYS = 30;
export const USERIDS_KEPT = 5;
const COUNT_MAX = 2_147_483_647;

/** One kind of error to add, already cleaned (`errorText.ts`). */
export interface ErrorEntry {
  readonly source: ErrorSource;
  readonly fingerprint: string;
  readonly message: string;
  readonly place: string;
  readonly stack: string;
  readonly count: number;
  readonly at: Date;
  readonly gameVersion?: string;
  readonly screen?: string;
  readonly userid?: number | null;
  /** Who hit it (`utils/errorCapture.ts`), most recent first. */
  readonly reporters?: readonly ErrorReporter[];
}

/** Adds the kind's senders, keeping only its {@link REPORTERS_KEPT} most recent. */
const recordReporters = async (em: EntityManager, errorId: number | string, reporters: readonly ErrorReporter[]): Promise<void> => {
  if (reporters.length === 0) return;
  for (const reporter of reporters.slice(0, REPORTERS_KEPT)) {
    await em.execute(
      `INSERT INTO bym.app_error_reporter AS r (error_id, userid, username, ip, last_seen)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (error_id, userid, ip) DO UPDATE SET
         username  = EXCLUDED.username,
         last_seen = GREATEST(r.last_seen, EXCLUDED.last_seen)`,
      [errorId, reporter.userid ?? 0, reporter.username.slice(0, 64), reporter.ip.slice(0, 64), reporter.at]
    );
  }
  await em.execute(
    `DELETE FROM bym.app_error_reporter WHERE error_id = ? AND id NOT IN (
       SELECT id FROM bym.app_error_reporter WHERE error_id = ? ORDER BY last_seen DESC, id DESC LIMIT ${REPORTERS_KEPT})`,
    [errorId, errorId]
  );
};

/**
 * Adds each entry to its kind's row, making the row when there is room.
 * Returns how many entries were kept (counted or added).
 */
export const recordErrors = async (em: EntityManager, entries: readonly ErrorEntry[]): Promise<number> => {
  let kept = 0;
  for (const entry of entries) {
    const count = Math.min(COUNT_MAX, Math.max(1, Math.floor(entry.count) || 1));
    const userids = entry.userid ? `{${entry.userid}}` : "{}";
    const rows = await em.execute<{ id: number | string }[]>(
      `INSERT INTO bym.app_error AS e
         (source, fingerprint, message, place, stack, count, first_seen, last_seen, game_version, screen, userids)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::int[]
        WHERE EXISTS (SELECT 1 FROM bym.app_error WHERE fingerprint = ?)
           OR (SELECT count(*) FROM bym.app_error) < ?
       ON CONFLICT (fingerprint) DO UPDATE SET
         count        = LEAST(e.count::bigint + EXCLUDED.count, ${COUNT_MAX})::integer,
         last_seen    = GREATEST(e.last_seen, EXCLUDED.last_seen),
         message      = EXCLUDED.message,
         stack        = CASE WHEN e.stack = '' THEN EXCLUDED.stack ELSE e.stack END,
         game_version = CASE WHEN EXCLUDED.game_version <> '' THEN EXCLUDED.game_version ELSE e.game_version END,
         screen       = CASE WHEN EXCLUDED.screen <> '' THEN EXCLUDED.screen ELSE e.screen END,
         userids      = CASE WHEN EXCLUDED.userids <@ e.userids THEN e.userids
                             ELSE (EXCLUDED.userids || array_remove(e.userids, EXCLUDED.userids[1]))[1:${USERIDS_KEPT}] END
       RETURNING id`,
      [
        entry.source,
        entry.fingerprint,
        entry.message,
        entry.place,
        entry.stack,
        count,
        entry.at,
        entry.at,
        entry.gameVersion ?? "",
        entry.screen ?? "",
        userids,
        entry.fingerprint,
        ERROR_GROUPS_MAX,
      ]
    );
    if (rows.length === 0) continue;
    kept += 1;
    await recordReporters(em, rows[0]!.id, entry.reporters ?? []);
  }
  return kept;
};

export interface ErrorGroup {
  readonly id: number;
  readonly source: ErrorSource;
  readonly message: string;
  readonly place: string;
  readonly stack: string;
  readonly count: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly gameVersion: string;
  readonly screen: string;
  readonly userids: readonly number[];
  /** The last few senders, newest first: owner's dashboard only (their addresses go nowhere else). */
  readonly reporters: readonly ErrorGroupReporter[];
  /** A browser error whose stack names none of the game's own code (an extension, an injected script). */
  readonly thirdParty: boolean;
}

export interface ErrorGroupReporter {
  readonly userid: number | null;
  readonly username: string;
  readonly ip: string;
  readonly lastSeen: string;
}

export interface ErrorListQuery {
  readonly source?: ErrorSource;
  /** `last` (newest first, the default) or `count` (most frequent first). */
  readonly sort?: "last" | "count";
  /** Only kinds seen since this time. */
  readonly since?: Date;
  readonly limit?: number;
}

interface ErrorRow {
  id: number | string;
  source: ErrorSource;
  message: string;
  place: string;
  stack: string;
  count: number | string;
  first_seen: Date | string;
  last_seen: Date | string;
  game_version: string;
  screen: string;
  userids: number[] | string | null;
  reporters: { userid: number; username: string; ip: string; last_seen: string }[] | string | null;
}

/** Postgres arrays may come back as `{1,2}` text, depending on the driver's mood. */
const idsOf = (raw: ErrorRow["userids"]): number[] => {
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === "string") return raw.replace(/[{}]/g, "").split(",").filter(Boolean).map(Number);
  return [];
};

const iso = (raw: Date | string): string => new Date(raw).toISOString();

const reportersOf = (raw: ErrorRow["reporters"]): ErrorGroupReporter[] => {
  const list = typeof raw === "string" ? (JSON.parse(raw) as Exclude<ErrorRow["reporters"], string>) : raw;
  return (list ?? []).map((r) => ({
    userid: Number(r.userid) || null,
    username: r.username ?? "",
    ip: r.ip ?? "",
    lastSeen: iso(r.last_seen),
  }));
};

/** The kept kinds of error, newest or most frequent first (at most 200). */
export const listErrors = async (em: EntityManager, query: ErrorListQuery = {}): Promise<ErrorGroup[]> => {
  const limit = Math.min(200, Math.max(1, Math.floor(query.limit ?? 100) || 100));
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.source) {
    where.push("source = ?");
    params.push(query.source);
  }
  if (query.since) {
    where.push("last_seen >= ?");
    params.push(query.since);
  }
  const order = query.sort === "count" ? "count DESC, last_seen DESC" : "last_seen DESC";
  const rows = await em.execute<ErrorRow[]>(
    `SELECT id, source, message, place, stack, count, first_seen, last_seen, game_version, screen, userids,
            (SELECT coalesce(json_agg(json_build_object('userid', r.userid, 'username', r.username, 'ip', r.ip, 'last_seen', r.last_seen)
                                      ORDER BY r.last_seen DESC, r.id DESC), '[]'::json)
               FROM bym.app_error_reporter r WHERE r.error_id = e.id) AS reporters
       FROM bym.app_error e ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ${order}, id DESC LIMIT ${limit}`,
    params
  );
  return rows.map((row) => ({
    id: Number(row.id),
    source: row.source,
    message: row.message,
    place: row.place,
    stack: row.stack,
    count: Number(row.count),
    firstSeen: iso(row.first_seen),
    lastSeen: iso(row.last_seen),
    gameVersion: row.game_version,
    screen: row.screen,
    userids: idsOf(row.userids),
    reporters: reportersOf(row.reporters),
    thirdParty: row.source === "browser" && isThirdPartyError(row.place, row.stack),
  }));
};

/** How many kinds are kept, per source, and the total count of each. */
export const errorTotals = async (
  em: EntityManager
): Promise<Record<ErrorSource, { kinds: number; occurrences: number }>> => {
  const rows = await em.execute<{ source: ErrorSource; kinds: number | string; occurrences: number | string }[]>(
    `SELECT source, count(*) AS kinds, coalesce(sum(count), 0) AS occurrences FROM bym.app_error GROUP BY source`
  );
  const totals = { browser: { kinds: 0, occurrences: 0 }, server: { kinds: 0, occurrences: 0 } };
  for (const row of rows) totals[row.source] = { kinds: Number(row.kinds), occurrences: Number(row.occurrences) };
  return totals;
};

/** How often caught server errors are moved into the table. */
export const SERVER_ERROR_FLUSH_MS = 30_000;

/**
 * Moves the server errors the logger caught (`utils/errorCapture.ts`) into
 * the table once. A failure is a warning (never caught again as an error)
 * and loses only that half minute's errors.
 */
export const flushServerErrors = async (em: EntityManager): Promise<number> => {
  const { entries, dropped } = takeCapturedErrors();
  const occurrences = entries.reduce((sum, entry) => sum + entry.count, 0) + dropped;
  // The "sudden jump in errors" alert (`services/alerts/errorRate.ts`) counts
  // every flush, an empty one too, so its check runs from the first flush.
  noteServerErrors(occurrences);
  if (entries.length === 0 && dropped === 0) return 0;
  noteErrors("server", occurrences);
  try {
    return await recordErrors(
      em,
      entries.map((entry) => ({
        ...entry,
        source: "server" as const,
        at: new Date(entry.at),
        userid: entry.reporters.find((r) => r.userid !== null)?.userid ?? null,
      }))
    );
  } catch (err) {
    logger.warn(`Dashboard: ${entries.length} kind(s) of server error could not be saved: ${err}`);
    return 0;
  }
};

/** Starts the half-minute flush (`server.ts`). Returns the stop function. */
export const startServerErrorFlush = (em: EntityManager): (() => void) => {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await flushServerErrors(em.fork());
    } finally {
      running = false;
    }
  }, SERVER_ERROR_FLUSH_MS);
  return () => clearInterval(timer);
};
