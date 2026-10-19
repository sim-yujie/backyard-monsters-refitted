import type { EntityManager } from "@mikro-orm/postgresql";

import { BotJob } from "../../database/models/botjob.model.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { isBot } from "./isBot.js";
import { DECLINE_TRUCE_HOURS } from "./truceDecline.js";

/**
 * Friend requests to accounts that never answer them (`docs/design/friends.md`
 * §6.2, "Accounts that cannot be friended"; issue #368), handled as truce
 * requests to them are (`truceDecline.ts`): the request is stored and answered
 * exactly as any other ({@link bookFriendDecline} books a `declineFriend` job a
 * random {@link DECLINE_FRIEND_HOURS} later), and the sweep runs it
 * ({@link declineFriend}): the request is declined as a player pressing
 * Decline declines it. The sender sees what any decline gives: the request
 * leaves their Sent list, and the 7-day wait before asking again.
 *
 * A request no longer waiting when the job runs (cancelled, or the pair
 * blocked since, which cancels it) is left alone. Either way the job is done.
 */

/** Answered a uniform 2-8 hours after the request, as truce requests are. */
export const DECLINE_FRIEND_HOURS = DECLINE_TRUCE_HOURS;

const HOUR_MS = 60 * 60 * 1000;

/** The request a `declineFriend` job answers: its `payload.request`. */
export interface DeclineFriendPayload extends JsonObject {
  request: number;
}

/**
 * Books the answer to a friend request just made when the §6.2 rule covers
 * its recipient; does nothing otherwise. The route's answer is the same
 * either way.
 *
 * @param {EntityManager} em - The request's entity manager (its transaction)
 * @param {{ id: number; from_userid: number; to_userid: number }} request - The request just made
 * @param {number} now - Unix seconds
 * @param {() => number} rng - Random numbers in [0, 1)
 * @returns {Promise<boolean>} True when a decline was booked
 */
export const bookFriendDecline = async (
  em: EntityManager,
  request: { id: number; from_userid: number; to_userid: number },
  now: number,
  rng: () => number = Math.random
): Promise<boolean> => {
  if (!(await isBot(request.to_userid, em))) return false;

  const hours = DECLINE_FRIEND_HOURS.min + rng() * (DECLINE_FRIEND_HOURS.max - DECLINE_FRIEND_HOURS.min);
  em.create(BotJob, {
    bot_userid: request.to_userid,
    kind: "declineFriend",
    target_userid: request.from_userid,
    due_at: new Date(now * 1000 + hours * HOUR_MS),
    payload: { request: request.id } satisfies DeclineFriendPayload,
  });
  await em.flush();
  return true;
};

/** The job row the sweep hands over. */
export interface DeclineFriendJob {
  bot_userid: number;
  payload: JsonObject;
}

/**
 * The `declineFriend` job: declines the request if it is still waiting, as
 * `POST /bm/friends/request/answer` with `accept: false` does. Runs inside the
 * sweep's transaction, which then deletes the job.
 *
 * @returns {Promise<"declined" | "closed">} What became of the request
 */
export const declineFriend = async (tx: EntityManager, job: DeclineFriendJob, now: number): Promise<"declined" | "closed"> => {
  const id = Number(job.payload?.request);
  if (!Number.isInteger(id)) return "closed";
  const rows = await tx.execute<{ id: number }[]>(
    `UPDATE bym.friend_request SET status = 'declined', answered_at = ?
      WHERE id = ? AND to_userid = ? AND status = 'pending'
      RETURNING id`,
    [new Date(now * 1000), id, job.bot_userid]
  );
  return rows.length > 0 ? "declined" : "closed";
};
