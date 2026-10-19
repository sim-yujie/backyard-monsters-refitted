import { redis } from "../../server.js";
import { logger } from "../../utils/logger.js";

/**
 * When a player's main yard was last helped by a friend (`docs/design/friends.md`
 * §3.3, issue #374), kept in Redis for a short while so the presence ping
 * can tell an owner sitting in their yard that its countdowns or health
 * changed. The web client then reads the yard again. One Redis read per
 * ping, no database work.
 */

/** How long the mark lasts: long past the 30-second ping, short enough to leave nothing behind. */
export const HELPED_MARK_SECONDS = 10 * 60;

export const helpedKey = (userid: number): string => `friend-helped:${userid}`;

/** Marks the owner's yard as helped at `now`. Never throws: the help has already gone through. */
export const markHelped = async (owner: number, now: number): Promise<void> => {
  try {
    await redis.setex(helpedKey(owner), HELPED_MARK_SECONDS, String(now));
  } catch (err) {
    logger.warn("Helped mark for user {userid} failed: {error}", {
      userid: owner,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

/** When the player's yard was last helped, unix seconds, or null when not lately. */
export const readHelped = async (userid: number): Promise<number | null> => {
  const raw = await redis.get(helpedKey(userid));
  const at = Number(raw);
  return raw !== null && raw !== undefined && Number.isFinite(at) && at > 0 ? at : null;
};
