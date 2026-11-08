import type { EntityManager } from "@mikro-orm/postgresql";

import { friendRefusedErr, type FriendRefusal } from "../../errors/errors.js";
import { FRIEND_LIMITS } from "./friendRules.js";

/**
 * Pinned friends (beta 7, owner: "Allow pinning of friends in the friend list
 * (up to 10)"). A pin is `bym.friend.pinned_at` on the player's own side of
 * the friendship: one-sided, never told to the friend, and gone with the
 * friendship. Pinned friends sort to the top of the list and the friends bar
 * and wear a stronger marker on the maps.
 */

/** Why a pin is refused, or null when it may go ahead (pure, for the tests). */
export const pinRefusal = (
  state: { readonly friends: boolean; readonly pinned: boolean; readonly pinnedCount: number },
  pin: boolean,
): FriendRefusal | null => {
  if (!state.friends) return "notFriends";
  if (!pin || state.pinned) return null;
  return state.pinnedCount >= FRIEND_LIMITS.maxPinned ? "pinLimit" : null;
};

/**
 * Pins (`pin`) or unpins a friend. Refuses `self`, `notFriends` (not, or no
 * longer, friends) and `pinLimit` (10 already pinned). Pinning a friend
 * already pinned, or unpinning one who is not, changes nothing and is not
 * refused. The caller's own `user` row is locked for the count, so two pins
 * at once cannot both slip under the limit.
 *
 * @returns How many friends the caller has pinned afterwards.
 */
export const setFriendPinned = async (
  em: EntityManager,
  me: number,
  friendUserid: number,
  pin: boolean,
  now: number,
): Promise<{ pinned: boolean; pinnedCount: number }> => {
  if (friendUserid === me) throw friendRefusedErr("self");
  return em.transactional(async (tx) => {
    await tx.execute(`SELECT userid FROM bym."user" WHERE userid = ? FOR UPDATE`, [me]);
    const [link] = await tx.execute<{ pinned_at: Date | null }[]>(
      `SELECT pinned_at FROM bym.friend WHERE userid = ? AND friend_userid = ?`,
      [me, friendUserid],
    );
    const pinnedCount = await countPinned(tx, me);
    const refusal = pinRefusal({ friends: !!link, pinned: !!link?.pinned_at, pinnedCount }, pin);
    if (refusal) throw friendRefusedErr(refusal, { max: FRIEND_LIMITS.maxPinned });
    const wasPinned = !!link?.pinned_at;
    if (wasPinned === pin) return { pinned: pin, pinnedCount };
    await tx.execute(`UPDATE bym.friend SET pinned_at = ? WHERE userid = ? AND friend_userid = ?`, [
      pin ? new Date(now * 1000) : null,
      me,
      friendUserid,
    ]);
    return { pinned: pin, pinnedCount: pinnedCount + (pin ? 1 : -1) };
  });
};

/** How many friends a player has pinned. */
export const countPinned = async (em: EntityManager, userid: number): Promise<number> => {
  const [row] = await em.execute<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM bym.friend WHERE userid = ? AND pinned_at IS NOT NULL`,
    [userid],
  );
  return Number(row?.n ?? 0);
};
