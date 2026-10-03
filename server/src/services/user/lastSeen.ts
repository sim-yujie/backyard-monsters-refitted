import type { EntityManager } from "@mikro-orm/postgresql";

import { User } from "../../database/models/user.model.js";

/** `user.last_seen_at` is written at most this often. */
export const LAST_SEEN_INTERVAL_MS = 60 * 60 * 1000;

/** Whether a stored `last_seen_at` is old enough (or absent) to be written again at `now`. */
export const lastSeenIsStale = (lastSeenAt: Date | null | undefined, now: Date): boolean =>
  !lastSeenAt || now.getTime() - lastSeenAt.getTime() >= LAST_SEEN_INTERVAL_MS;

/**
 * Records that the player opened their own yard (issue #235,
 * `docs/design/bot-neighbours.md` decision 20): sets `user.last_seen_at` to
 * `now`, at most once an hour, for the Map Room 1 neighbour search.
 *
 * A direct update rather than a change to the loaded entity, so nothing else
 * the request flushes is touched, and guarded in SQL as well, so two loads at
 * once write it once. Returns whether a row was written.
 *
 * @param {EntityManager} em - The request's entity manager
 * @param {User} user - The player, as the request loaded them
 * @param {Date} now - The time of the load
 * @returns {Promise<boolean>} True when `last_seen_at` was written
 */
export const touchLastSeen = async (em: EntityManager, user: User, now: Date = new Date()): Promise<boolean> => {
  if (!lastSeenIsStale(user.last_seen_at, now)) return false;

  const cutoff = new Date(now.getTime() - LAST_SEEN_INTERVAL_MS);
  const written = await em.nativeUpdate(
    User,
    { userid: user.userid, $or: [{ last_seen_at: null }, { last_seen_at: { $lte: cutoff } }] },
    { last_seen_at: now },
  );
  return written > 0;
};
