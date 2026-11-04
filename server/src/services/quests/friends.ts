import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import { calculateBaseLevel } from "../base/calculateBaseLevel.js";
import { FRIEND_GATES } from "../friends/helpConfig.js";

/**
 * The friend facts the social quests read (owner, 2 Nov 2026):
 * - whether a player has a friend they can help or gift (friends long
 *   enough, both level 5+), which picks "help or gift 5 times" over
 *   "make 5 new friends";
 * - whether a new friend counts: level 5+, played in the last 7 days, never
 *   this player's friend before.
 */

const sql = (em: EntityManager): SqlEntityManager => em as SqlEntityManager;

/** Days a new friend must have played within to count. */
export const NEW_FRIEND_ACTIVE_DAYS = 7;

interface LevelRow {
  points: string | number | null;
  basevalue: string | number | null;
}

const levelOf = (row: LevelRow | undefined): number =>
  row ? calculateBaseLevel(String(row.points ?? "0"), String(row.basevalue ?? "0")) : 0;

/** Whether `userid` (level 5+) has a friend of level 5+ they have been friends with long enough to help. */
export const sqlHasFriend = async (em: EntityManager, userid: number, now: number): Promise<boolean> => {
  const [me] = await sql(em).execute<LevelRow[]>(
    `SELECT s.points, s.basevalue FROM bym."user" u JOIN bym.save s ON s.basesaveid = u.save_basesaveid WHERE u.userid = ?`,
    [userid]
  );
  if (levelOf(me) < FRIEND_GATES.minLevel) return false;
  const since = new Date((now - FRIEND_GATES.friendshipAgeHours * 3600) * 1000);
  const rows = await sql(em).execute<LevelRow[]>(
    `SELECT s.points, s.basevalue
       FROM bym.friend f
       JOIN bym."user" u ON u.userid = f.friend_userid
       JOIN bym.save s ON s.basesaveid = u.save_basesaveid
      WHERE f.userid = ? AND f.created_at <= ?`,
    [userid, since]
  );
  return rows.some((row) => levelOf(row) >= FRIEND_GATES.minLevel);
};

/**
 * Whether `friend`, who has just become `userid`'s friend, counts as a new
 * friend for `userid`: level 5+, seen in the last 7 days, and never friends
 * before (only one accepted friend request between the two, this one).
 */
export const sqlCountsAsNewFriend = async (
  em: EntityManager,
  userid: number,
  friend: number,
  now: number
): Promise<boolean> => {
  const [row] = await sql(em).execute<(LevelRow & { last_seen_at: Date | string | null })[]>(
    `SELECT s.points, s.basevalue, u.last_seen_at
       FROM bym."user" u LEFT JOIN bym.save s ON s.basesaveid = u.save_basesaveid
      WHERE u.userid = ?`,
    [friend]
  );
  if (!row || levelOf(row) < FRIEND_GATES.minLevel) return false;
  const seen = row.last_seen_at ? new Date(row.last_seen_at).getTime() / 1000 : 0;
  if (seen < now - NEW_FRIEND_ACTIVE_DAYS * 24 * 3600) return false;
  const [history] = await sql(em).execute<{ n: number | string }[]>(
    `SELECT count(*)::int AS n FROM bym.friend_request
      WHERE status = 'accepted'
        AND ((from_userid = ? AND to_userid = ?) OR (from_userid = ? AND to_userid = ?))`,
    [userid, friend, friend, userid]
  );
  return Number(history?.n ?? 0) <= 1;
};
