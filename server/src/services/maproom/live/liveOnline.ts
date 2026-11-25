import { markUsers } from "./liveMarks.js";

/**
 * The live map's online flag (beta 9, stage 1). A yard whose owner is online
 * shows locked (`lo`, `userCell.ts`), and nothing is written when a player
 * goes quiet: their presence marks simply run out (`services/user/online.ts`).
 * So every {@link ONLINE_CHECK_MS} one server (whichever takes the Redis lock)
 * works out who is online among the players seen lately and marks the cells
 * of everyone who came online or went offline since the last check. The
 * owner accepted 15-60 s of lag for this (25 Nov 2026).
 *
 * Who was seen lately is the Redis set {@link LIVE_SEEN_KEY}, which every
 * presence mark adds to ({@link noteLiveSeen}); who was online at the last
 * check is {@link LIVE_ONLINE_KEY}. Both live in Redis, so any server may run
 * the next check.
 */

export const LIVE_SEEN_KEY = "livemap:seen";
export const LIVE_ONLINE_KEY = "livemap:online";
export const LIVE_ONLINE_LOCK_KEY = "livemap:online:lock";
export const ONLINE_CHECK_MS = 15_000;

/** The Redis calls this needs (Bun's client has them all). */
export interface OnlineRedis {
  sadd(key: string, ...members: string[]): Promise<unknown>;
  srem(key: string, ...members: string[]): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
  send(command: string, args: string[]): Promise<unknown>;
}

/**
 * Notes a presence mark for the online check. Never throws and never waits on
 * anything that matters: a lost note only delays the flag to the next mark.
 */
export const noteLiveSeen = (redis: Pick<OnlineRedis, "sadd"> | undefined, userid: number): void => {
  try {
    void redis?.sadd(LIVE_SEEN_KEY, String(userid)).catch(() => undefined);
  } catch {
    // A test's stand-in Redis without sets.
  }
};

export interface OnlineCheckDeps {
  redis: OnlineRedis;
  /** Who among these is online now (`onlinePlayers`). */
  online(userids: readonly number[], now: number): Promise<Set<number>>;
  now(): number;
  warn(message: string): void;
}

/**
 * One check: takes the lock (so two servers never both run it), compares who
 * is online now with the last check, marks the difference and keeps the sets
 * small. Returns the players whose flag changed (for tests).
 */
export const checkOnline = async (deps: OnlineCheckDeps): Promise<number[]> => {
  const { redis } = deps;
  const locked = await redis.send("SET", [LIVE_ONLINE_LOCK_KEY, "1", "NX", "PX", String(ONLINE_CHECK_MS - 1000)]);
  if (locked === null || locked === undefined) return [];

  const [seen, before] = await Promise.all([redis.smembers(LIVE_SEEN_KEY), redis.smembers(LIVE_ONLINE_KEY)]);
  const candidates = [...new Set([...seen, ...before].map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!candidates.length) return [];

  const now = await deps.online(candidates, deps.now());
  const was = new Set(before.map(Number));
  const changed = candidates.filter((id) => now.has(id) !== was.has(id));
  markUsers(changed);

  const cameOnline = [...now].filter((id) => !was.has(id)).map(String);
  const wentOffline = [...was].filter((id) => !now.has(id)).map(String);
  // The seen set only needs who might come online before their next mark: those online now.
  const quiet = seen.filter((id) => !now.has(Number(id)));
  await Promise.all([
    cameOnline.length ? redis.sadd(LIVE_ONLINE_KEY, ...cameOnline) : null,
    wentOffline.length ? redis.srem(LIVE_ONLINE_KEY, ...wentOffline) : null,
    quiet.length ? redis.srem(LIVE_SEEN_KEY, ...quiet) : null,
  ]);
  return changed;
};

/** Runs {@link checkOnline} every {@link ONLINE_CHECK_MS} (server start). */
export const startLiveOnline = (deps: OnlineCheckDeps): ReturnType<typeof setInterval> => {
  const timer = setInterval(() => {
    checkOnline(deps).catch((error) => deps.warn(`Live map online check failed: ${error}`));
  }, ONLINE_CHECK_MS);
  timer.unref?.();
  return timer;
};
