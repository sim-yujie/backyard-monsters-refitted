import type { EntityManager } from "@mikro-orm/postgresql";

import type { FlagRule, FlagSeverity } from "../chat/chatFlags.js";

/**
 * The dashboard's side of the automatic chat flags and the chat log
 * (`services/chat/chatFlags.ts`, `services/chat/chatLog.ts`): flagged
 * players, one row each, the owner's "dismiss", and the chat log read by
 * player, room, word or time. Only the dashboard sees the players' own
 * (unmasked) words.
 */

const iso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();

/** One flagged line. */
export interface FlagLine {
  id: number;
  channel: string;
  /** The player's own words. */
  message: string;
  /** What other players saw. */
  shown: string;
  words: string[];
  severity: FlagSeverity;
  /** `word`: a listed word as such; `disguised`: spelled to get past the filter. */
  rule: FlagRule;
  at: string;
}

/** A flagged player: their open flags, counted, with the latest few lines. */
export interface FlaggedPlayer {
  userid: number;
  username: string | null;
  banned: boolean;
  muted: boolean;
  /** Open (not dismissed) flags. */
  count: number;
  /** Open flags with a slur. */
  slurs: number;
  /** The newest open flag's id: dismissing up to it leaves any newer one. */
  lastId: number;
  latestAt: string;
  /** The newest {@link FLAG_LINES_SHOWN}, newest first. */
  lines: FlagLine[];
}

/** Lines shown per flagged player. */
export const FLAG_LINES_SHOWN = 3;

export const FLAGGED_PAGE = 30;

export type FlagSort = "latest" | "serious";

export interface FlagListOptions {
  /** `serious`: players with a slur first, then newest. Default `latest`. */
  sort?: FlagSort;
  /** Only players with a slur flag. */
  slursOnly?: boolean;
  /** One player only. */
  userid?: number;
  offset?: number;
  limit?: number;
}

interface FlaggedRow {
  userid: number;
  username: string | null;
  banned: boolean | null;
  mute_until: Date | string | null;
  count: string | number;
  slurs: string | number;
  last_id: string | number;
  latest_at: Date | string;
  lines: { id: string | number; channel: string; message: string; shown: string; words: string; severity: FlagSeverity; rule: FlagRule; created_at: string }[] | string | null;
}

/**
 * Flagged players with open flags, a page at a time (`nextOffset` for the
 * next page, null at the end).
 */
export const listChatFlags = async (
  em: EntityManager,
  options: FlagListOptions = {},
  now: Date = new Date(),
): Promise<{ players: FlaggedPlayer[]; nextOffset: number | null }> => {
  const limit = Math.min(100, Math.max(1, options.limit ?? FLAGGED_PAGE));
  const offset = Math.max(0, options.offset ?? 0);
  const serious = options.sort === "serious";
  const rows = await em.execute<FlaggedRow[]>(
    `WITH open AS (
       SELECT f.userid, count(*) AS count, count(*) FILTER (WHERE f.severity = 'slur') AS slurs,
              max(f.id) AS last_id, max(f.created_at) AS latest_at
         FROM bym.chat_flag f
        WHERE f.dismissed_at IS NULL AND (?::int IS NULL OR f.userid = ?::int)
        GROUP BY f.userid
     )
     SELECT o.userid, u.username, u.banned, u.mute_until, o.count, o.slurs, o.last_id, o.latest_at,
            (SELECT json_agg(x ORDER BY x.id DESC) FROM (
               SELECT l.id, l.channel, l.message, l.shown, l.words, l.severity, l.rule, l.created_at
                 FROM bym.chat_flag l
                WHERE l.userid = o.userid AND l.dismissed_at IS NULL
                ORDER BY l.id DESC LIMIT ${FLAG_LINES_SHOWN}
             ) x) AS lines
       FROM open o
       LEFT JOIN bym."user" u ON u.userid = o.userid
      WHERE (NOT ?::boolean OR o.slurs > 0)
      ORDER BY (CASE WHEN ?::boolean AND o.slurs > 0 THEN 1 ELSE 0 END) DESC, o.latest_at DESC, o.userid
      LIMIT ${limit + 1} OFFSET ${offset}`,
    [options.userid ?? null, options.userid ?? null, Boolean(options.slursOnly), serious],
  );
  const page = rows.slice(0, limit);
  return {
    players: page.map((row) => {
      const mute = row.mute_until ? new Date(row.mute_until) : null;
      const lines = typeof row.lines === "string" ? JSON.parse(row.lines) : (row.lines ?? []);
      return {
        userid: Number(row.userid),
        username: row.username,
        banned: Boolean(row.banned),
        muted: mute !== null && mute > now,
        count: Number(row.count),
        slurs: Number(row.slurs),
        lastId: Number(row.last_id),
        latestAt: iso(row.latest_at),
        lines: (lines as Exclude<FlaggedRow["lines"], string | null>).map((line) => ({
          id: Number(line.id),
          channel: line.channel,
          message: line.message,
          shown: line.shown,
          words: line.words ? line.words.split(",") : [],
          severity: line.severity,
          rule: line.rule === "disguised" ? "disguised" : "word",
          at: iso(line.created_at),
        })),
      };
    }),
    nextOffset: rows.length > limit ? offset + limit : null,
  };
};

/**
 * Sets aside a player's open flags up to `upTo` (the `lastId` the owner was
 * shown, so a flag that came in since stays). Returns how many went.
 */
export const dismissChatFlags = async (
  em: EntityManager,
  userid: number,
  upTo: number,
  adminId: number,
  now: Date = new Date(),
): Promise<number> => {
  const rows = await em.execute<{ id: string }[]>(
    `UPDATE bym.chat_flag SET dismissed_at = ?, dismissed_by = ?
      WHERE userid = ? AND id <= ? AND dismissed_at IS NULL RETURNING id`,
    [now, adminId, userid, upTo],
  );
  return rows.length;
};

/** One line of the chat log, as the dashboard shows it. */
export interface ChatLogEntry {
  id: number;
  userid: number;
  username: string | null;
  channel: string;
  message: string;
  shown: string;
  flagged: FlagSeverity | null;
  at: string;
}

export const CHAT_LOG_PAGE = 50;

/** Longest word search. */
export const MAX_CHAT_LOG_QUERY = 60;

export interface ChatLogQuery {
  userid?: number;
  /** A player's name, any case, whole. */
  player?: string;
  /** Words in the line (the player's own), any case. */
  q?: string;
  channel?: string;
  /** Only lines said at or before this time (ms): the room around a flagged line. */
  until?: number;
  /** Only flagged lines. */
  flagged?: boolean;
  /** The last id of the page before. */
  before?: number;
  limit?: number;
}

const likeEscape = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The chat log, newest first, a page at a time. Every filter is optional and
 * they combine. A word search reads through lines newest first until the
 * page is full, so a rare word can take a moment.
 */
export const readChatLog = async (
  em: EntityManager,
  query: ChatLogQuery = {},
): Promise<{ lines: ChatLogEntry[]; nextBefore: number | null }> => {
  const limit = Math.min(100, Math.max(1, query.limit ?? CHAT_LOG_PAGE));
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.userid !== undefined) {
    where.push("c.userid = ?");
    params.push(query.userid);
  }
  const player = query.player?.trim();
  if (player) {
    where.push(`c.userid IN (SELECT p.userid FROM bym."user" p WHERE lower(p.username) = lower(?))`);
    params.push(player);
  }
  const words = query.q?.trim().slice(0, MAX_CHAT_LOG_QUERY);
  if (words) {
    where.push(`c.message ILIKE ? ESCAPE '\\'`);
    params.push(`%${likeEscape(words)}%`);
  }
  if (query.channel) {
    where.push("c.channel = ?");
    params.push(query.channel);
  }
  if (query.until !== undefined) {
    where.push("c.created_at <= ?");
    params.push(new Date(query.until));
  }
  if (query.flagged) where.push("c.flagged IS NOT NULL");
  if (query.before !== undefined && query.before > 0) {
    where.push("c.id < ?");
    params.push(query.before);
  }
  const rows = await em.execute<
    {
      id: string | number;
      userid: number;
      username: string | null;
      channel: string;
      message: string;
      shown: string;
      flagged: FlagSeverity | null;
      created_at: Date | string;
    }[]
  >(
    `SELECT c.id, c.userid, u.username, c.channel, c.message, c.shown, c.flagged, c.created_at
       FROM bym.chat_log c
       LEFT JOIN bym."user" u ON u.userid = c.userid
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY c.id DESC
      LIMIT ${limit + 1}`,
    params,
  );
  const page = rows.slice(0, limit);
  return {
    lines: page.map((row) => ({
      id: Number(row.id),
      userid: Number(row.userid),
      username: row.username,
      channel: row.channel,
      message: row.message,
      shown: row.shown,
      flagged: row.flagged,
      at: iso(row.created_at),
    })),
    nextBefore: rows.length > limit ? Number(page[page.length - 1]!.id) : null,
  };
};
