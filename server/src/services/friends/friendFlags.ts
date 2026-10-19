import type { EntityManager } from "@mikro-orm/postgresql";
import { blockedIdsOf } from "./friendRules.js";

/**
 * Which of `ids` are friends of `userid` (`docs/design/friends.md` §6.2,
 * "Friend flag"): the set behind `friend: 1` / `fr: 1` in map cells, Map Room 1
 * neighbour lists and mail targets. Read fresh on every answer, never kept in a
 * cached list, so a new or ended friendship shows at once.
 */
export const friendsAmong = async (em: EntityManager, userid: number | undefined, ids: readonly number[]): Promise<Set<number>> => {
  const others = [...new Set(ids)].filter((id) => id !== userid);
  if (userid === undefined || others.length === 0) return new Set();
  const rows = await em.execute<{ friend_userid: number }[]>(
    `SELECT friend_userid FROM bym.friend WHERE userid = ? AND friend_userid IN (${others.map(() => "?").join(", ")})`,
    [userid, ...others]
  );
  return new Set(rows.map((row) => Number(row.friend_userid)));
};

/** `1` for a friend, else `0`: the legacy flag's value. */
export const friendFlag = (friends: ReadonlySet<number>, userid: number): 0 | 1 => (friends.has(userid) ? 1 : 0);

/**
 * Whether `visitor` may open `owner`'s main yard in help mode: the two are
 * friends, neither has blocked the other, and neither account is banned. A
 * friendship normally cannot outlive a block or a ban's cleanup, but a visit
 * checks again rather than trust that.
 */
export const mayVisit = async (em: EntityManager, visitor: number, owner: number): Promise<boolean> => {
  if (visitor === owner) return false;
  const [link] = await em.execute(`SELECT 1 FROM bym.friend WHERE userid = ? AND friend_userid = ?`, [visitor, owner]);
  if (!link) return false;
  const users = await em.execute<{ userid: number; blocked_users: unknown; banned: boolean }[]>(
    `SELECT userid, blocked_users, banned FROM bym."user" WHERE userid IN (?, ?)`,
    [visitor, owner]
  );
  const find = (id: number) => users.find((row) => Number(row.userid) === id);
  const a = find(visitor);
  const b = find(owner);
  if (!a || !b || a.banned || b.banned) return false;
  return !blockedIdsOf(a.blocked_users).includes(owner) && !blockedIdsOf(b.blocked_users).includes(visitor);
};
