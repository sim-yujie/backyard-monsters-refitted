import { logger } from "../../utils/logger.js";

/**
 * Takes a banned player's recent lines out of the world chat rooms' live
 * history (owner, 24 Nov 2026: a moderator's ban offers it). Every room's
 * last lines are a Redis list, `history:<channel>` (`chat/chatHistory.ts`),
 * which a player joining a room is sent. The lines stay in `bym.chat_log`
 * and in any report's copy: those are the evidence.
 *
 * Chat boxes already open drop the lines too (chat filter, owner 24 Nov
 * 2026, removed line option A: "it simply vanishes for everyone, name
 * included"): each removed line is announced on its room's channel with no
 * words, `{ type: "removed", channel, id, userId, ts }`, and the game's chat
 * box drops the line it names. The sender's own copies of filtered lines
 * (`chat/chatOwnLines.ts`) go too, so a removed line does not come back for
 * him on a re-join. A moderator's Remove takes one line ({@link removeChatLine}).
 *
 * Not reached: alliance feeds (kept in Postgres, not here).
 */

/** Every world and country room's history list (`chat/chatHistory.ts`: `history:` + a `chat:` channel). */
export const CHAT_HISTORY_KEYS = "history:chat:*";

/** How far back a moderator's ban removes lines: the last hour. */
export const REMOVE_LINES_MS = 60 * 60 * 1000;

/** The Redis commands this needs (Bun's `RedisClient` has `send`). */
export interface CommandRedis {
  send(command: string, args: string[]): Promise<unknown>;
}

/** One player's own copies of their filtered lines (`chat/chatOwnLines.ts`). */
const ownLinesOf = (userid: number, channel?: string): string => `chat-own:${userid}:${channel ?? "*"}`;

/** A line as a removal names it: by its id when it has one, else by speaker and stamp. */
export interface LineRef {
  readonly userId: number;
  readonly ts: number;
  readonly id?: string | null;
}

/** Whether a raw history entry (or an own copy's `entry`) is the line named. */
export const isLine = (raw: string, line: LineRef): boolean => {
  try {
    const parsed = JSON.parse(raw) as { entry?: unknown } & Record<string, unknown>;
    const entry = (parsed && typeof parsed.entry === "object" && parsed.entry ? parsed.entry : parsed) as { id?: unknown; userId?: unknown; ts?: unknown };
    if (Number(entry.userId) !== line.userId) return false;
    return (line.id && entry.id === line.id) || Number(entry.ts) === line.ts;
  } catch {
    return false;
  }
};

/** The words-free message the chat box drops a line on. */
export const removedMessage = (channel: string, line: LineRef): string =>
  JSON.stringify({ type: "removed", channel, ...(line.id ? { id: line.id } : {}), userId: line.userId, ts: line.ts });

const announce = async (redis: CommandRedis, channel: string, line: LineRef): Promise<void> => {
  try {
    await redis.send("PUBLISH", [channel, removedMessage(channel, line)]);
  } catch (err) {
    logger.warn(`Chat: the removal of a line in ${channel} was not announced: ${err}`);
  }
};

/** Takes the entries matching `match` out of one list: the distinct entries that went, and how many copies. */
const removeFromList = async (
  redis: CommandRedis,
  key: string,
  match: (raw: string) => boolean,
): Promise<{ gone: string[]; count: number }> => {
  const entries = (await redis.send("LRANGE", [key, "0", "-1"])) as string[] | null;
  const gone: string[] = [];
  let count = 0;
  // LREM takes every copy of an entry at once, so each distinct one once.
  for (const raw of new Set((entries ?? []).filter(match))) {
    const removed = Number(await redis.send("LREM", [key, "0", raw])) || 0;
    if (removed > 0) gone.push(raw);
    count += removed;
  }
  return { gone, count };
};

/** An own copy's line (`{ entry, hidden }`) as a raw history entry, or "" when it is broken. */
const ownEntry = (raw: string): string => {
  try {
    return JSON.stringify((JSON.parse(raw) as { entry?: unknown }).entry ?? {});
  } catch {
    return "";
  }
};

/**
 * A moderator's Remove: takes one line out of its room's history and the
 * sender's own copies, and tells every open chat box in the room to drop it.
 * Announced even when the history no longer holds it (it may still be on
 * screens).
 *
 * @returns {Promise<number>} How many history entries went (0 or 1, more for a duplicated entry).
 */
export const removeChatLine = async (redis: CommandRedis, channel: string, line: LineRef): Promise<number> => {
  const { count } = await removeFromList(redis, `history:${channel}`, (raw) => isLine(raw, line));
  await removeFromList(redis, ownLinesOf(line.userId, channel), (raw) => isLine(raw, line));
  await announce(redis, channel, line);
  logger.info(`Chat: removed the line of user ${line.userId} said at ${line.ts} in ${channel} (${count} in history)`);
  return count;
};

const scanKeys = async (redis: CommandRedis, pattern: string): Promise<string[]> => {
  const keys = new Set<string>();
  let cursor = "0";
  do {
    const [next, batch] = (await redis.send("SCAN", [cursor, "MATCH", pattern, "COUNT", "500"])) as [string, string[]];
    for (const key of batch) keys.add(key);
    cursor = String(next);
  } while (cursor !== "0");
  return [...keys];
};

/** Whether a raw history entry is `userid`'s line said at or after `since` (ms). */
export const isRecentLineOf = (raw: string, userid: number, since: number): boolean => {
  try {
    const entry = JSON.parse(raw) as { userId?: unknown; ts?: unknown };
    return Number(entry.userId) === userid && Number(entry.ts) >= since;
  } catch {
    return false;
  }
};

/**
 * Removes `userid`'s lines said since `since` (ms) from every room's history.
 *
 * @returns {Promise<number>} How many lines were taken out.
 */
export const removeRecentChatLines = async (redis: CommandRedis, userid: number, since: number): Promise<number> => {
  let removed = 0;
  for (const key of await scanKeys(redis, CHAT_HISTORY_KEYS)) {
    if ((await redis.send("TYPE", [key])) !== "list") continue;
    const { gone, count } = await removeFromList(redis, key, (entry) => isRecentLineOf(entry, userid, since));
    const channel = key.slice("history:".length);
    for (const raw of gone) {
      const entry = JSON.parse(raw) as { id?: string; ts: number };
      await announce(redis, channel, { userId: userid, ts: Number(entry.ts), id: entry.id ?? null });
    }
    removed += count;
  }
  // Their own copies of filtered lines, which could otherwise come back on a re-join.
  for (const key of await scanKeys(redis, ownLinesOf(userid))) {
    await removeFromList(redis, key, (raw) => isRecentLineOf(ownEntry(raw), userid, since));
  }
  if (removed > 0) logger.info(`Chat: removed ${removed} recent lines of user ${userid} from the rooms' history`);
  return removed;
};
