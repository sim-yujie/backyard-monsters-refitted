import { logger } from "../../utils/logger.js";

/**
 * Takes a banned player's recent lines out of the world chat rooms' live
 * history (owner, 24 Nov 2026: a moderator's ban offers it). Every room's
 * last lines are a Redis list, `history:<channel>` (`chat/chatHistory.ts`),
 * which a player joining a room is sent. The lines stay in `bym.chat_log`
 * and in any report's copy: those are the evidence.
 *
 * Not reached: alliance feeds (kept in Postgres, not here) and chat boxes
 * already open, which keep showing the lines until they join the room again.
 */

/** Every world and country room's history list (`chat/chatHistory.ts`: `history:` + a `chat:` channel). */
export const CHAT_HISTORY_KEYS = "history:chat:*";

/** How far back a moderator's ban removes lines: the last hour. */
export const REMOVE_LINES_MS = 60 * 60 * 1000;

/** The Redis commands this needs (Bun's `RedisClient` has `send`). */
export interface CommandRedis {
  send(command: string, args: string[]): Promise<unknown>;
}

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
    const entries = (await redis.send("LRANGE", [key, "0", "-1"])) as string[];
    // LREM takes every copy of an entry at once, so each distinct one once.
    for (const raw of new Set(entries.filter((entry) => isRecentLineOf(entry, userid, since)))) {
      removed += Number(await redis.send("LREM", [key, "0", raw])) || 0;
    }
  }
  if (removed > 0) logger.info(`Chat: removed ${removed} recent lines of user ${userid} from the rooms' history`);
  return removed;
};
