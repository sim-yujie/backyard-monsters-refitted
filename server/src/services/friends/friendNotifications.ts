import type { EntityManager } from "@mikro-orm/core";

import { logger } from "../../utils/logger.js";
import { recordNotifications } from "../notifications/notifications.js";

/**
 * The `friend` notifications (`docs/design/friends.md` §6.1, issue #368): one
 * row in the bell's list per event, its payload the only entry of the row's
 * `jobs`. WP1 writes `request` (to the player asked) and `accepted` (to both
 * players); later packages add `gift`, `helpSpeedup` and `helpRepair`.
 *
 * A decline writes nothing: it is silent to the sender (§3.1).
 */

/** What a `friend` row carries: the event, and the other player. */
export interface FriendNotice {
  event: "request" | "accepted" | "gift" | "helpSpeedup" | "helpRepair";
  userid: number;
  username: string;
  [detail: string]: unknown;
}

/**
 * Writes one `friend` row for a player, then prunes their list as every
 * write does (`recordNotifications`). Never throws: the friends answer matters more than its bell
 * line, so a failure is logged. Run it after the friends transaction has
 * committed, never inside it.
 */
export const notifyFriend = async (
  em: EntityManager,
  userid: number,
  notice: FriendNotice,
  now: Date = new Date(),
): Promise<void> => {
  try {
    // As every write: a player who turned "Friends and gifts" off gets it
    // stored already read, never shown (`notificationCategories.ts`).
    await recordNotifications(em.fork(), userid, null, "friend", [[notice]], now);
  } catch (err) {
    logger.warn("Friend notification for user {userid} failed: {error}", {
      userid,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
