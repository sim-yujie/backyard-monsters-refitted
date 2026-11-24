import { redis } from "../server.js";
import type { HistoryEntry } from "./chatProtocol.js";

/**
 * The sender's own copy of a filtered line (owner, 24 Nov 2026, chat filter
 * "sender's view" B): when the filter cuts a link or hides a line, everyone
 * else gets the cut line or nothing, but the sender keeps seeing their own
 * words, also after a reload or re-join, and so never learns they were
 * filtered.
 *
 * Their words never go to the room: not in the published message, not in
 * the room's history (`history:<channel>`). They are kept here, in a list
 * for that one player and room, `chat-own:<userid>:<channel>`, and only
 * that player's join reads it ({@link withOwnLines}).
 */

/** One player's own copies in one room: newest first, trimmed, gone 30 days after the last. */
export const ownLinesKey = (userid: number, channel: string): string => `chat-own:${userid}:${channel}`;

/** Every room's own copies of one player (a ban's clean-up). */
export const ownLinesPattern = (userid: number): string => `chat-own:${userid}:*`;

/** As many as a room's history keeps (`chatHistory.ts`). */
const MAX_OWN = 100;
const OWN_TTL_SECONDS = 2592000;

export interface OwnLine {
  /** The line as the sender sees it, with their own words. */
  readonly entry: HistoryEntry;
  /** Nobody else got it at all (a new player's watched word). */
  readonly hidden: boolean;
}

/** Keeps the sender's copy of one filtered line. */
export const keepOwnLine = async (userid: number, channel: string, line: OwnLine): Promise<void> => {
  const key = ownLinesKey(userid, channel);
  await redis.lpush(key, JSON.stringify(line));
  await Promise.all([redis.ltrim(key, 0, MAX_OWN - 1), redis.expire(key, OWN_TTL_SECONDS)]);
};

/** The player's own copies in a room, oldest first. */
export const readOwnLines = async (userid: number, channel: string): Promise<OwnLine[]> => {
  const raw = await redis.lrange(ownLinesKey(userid, channel), 0, MAX_OWN - 1);
  const lines: OwnLine[] = [];
  for (const item of raw) {
    try {
      const line = JSON.parse(item) as OwnLine;
      if (line && typeof line === "object" && line.entry && typeof line.entry.ts === "number") lines.push(line);
    } catch {
      // A broken copy is skipped.
    }
  }
  return lines.reverse();
};

/**
 * The room's history as one player sees it: their filtered lines with their
 * own words, and their hidden lines put back where they were said. A hidden
 * line older than the room's oldest kept line is left out, as the room has
 * moved on past it; a cut line no longer in the room (rolled out, or removed
 * by a moderator) is not brought back.
 *
 * @param {readonly HistoryEntry[]} history - The room's history, oldest first.
 * @param {readonly OwnLine[]} own - The player's own copies there, oldest first.
 * @param {boolean} full - Whether the room's history is at its cap (older lines rolled out).
 * @returns {HistoryEntry[]} Oldest first.
 */
export const mergeOwnLines = (history: readonly HistoryEntry[], own: readonly OwnLine[], full: boolean): HistoryEntry[] => {
  if (own.length === 0) return [...history];
  const byId = new Map(own.filter((line) => line.entry.id).map((line) => [line.entry.id!, line]));
  const merged = history.map((entry) => {
    const mine = entry.id ? byId.get(entry.id) : undefined;
    return mine && !mine.hidden && mine.entry.userId === entry.userId ? { ...entry, body: mine.entry.body } : entry;
  });
  const oldest = full ? (history[0]?.ts ?? Infinity) : -Infinity;
  const present = new Set(history.map((entry) => entry.id).filter(Boolean));
  for (const line of own) {
    if (!line.hidden || line.entry.ts < oldest || (line.entry.id && present.has(line.entry.id))) continue;
    merged.push(line.entry);
  }
  return merged.sort((a, b) => a.ts - b.ts);
};
