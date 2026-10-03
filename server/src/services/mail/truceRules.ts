import { TruceStatus } from "../../enums/TruceStatus.js";
import { Truce } from "../../database/models/truce.model.js";
import { postgres } from "../../server.js";
import { TRUCE_REQUEST_LIFETIME } from "./truceTimes.js";

/**
 * The rules of a truce between two players (#203), in one place for the three
 * routes that start or answer one and the map that shows it.
 *
 * - A request waits for its recipient for {@link TRUCE_REQUEST_LIFETIME}. After
 *   that it lapses: it can no longer be accepted or rejected, and it no longer
 *   stands in the way of a new request. Nothing rewrites the row; the lapse
 *   is read from `created_at`.
 * - An accepted truce lasts {@link TRUCE_DURATION} and, while it does, neither
 *   player can attack any base of the other's (`baseModeAttack`).
 * - A pair holds at most one live truce: a request still waiting, or an
 *   accepted truce not yet expired.
 * - After a rejection, the one who asked waits {@link TRUCE_RETRY_AFTER_REJECTION}
 *   before asking that player again (Flash Map Room 1's rule); the other
 *   player may ask at once. The rejected row's `expires_at` holds the moment.
 *
 * The times and the answer itself, which read no rows, live in `truceTimes.ts`
 * and are re-exported here.
 */

export {
  isRequestOpen,
  requestLapsesAt,
  truceEndsAt,
  TRUCE_DURATION,
  TRUCE_REQUEST_LIFETIME,
  TRUCE_RETRY_AFTER_REJECTION,
} from "./truceTimes.js";

/** The filter for a truce that still binds its pair at `now`: a waiting request, or an unexpired accepted truce. */
export const liveTruceFilter = (now: number) => ({
  $or: [
    { status: TruceStatus.REQUESTED, created_at: { $gt: new Date((now - TRUCE_REQUEST_LIFETIME) * 1000) } },
    { status: TruceStatus.ACCEPTED, expires_at: { $gt: now } },
  ],
});

/** The filter for a truce between two players, whoever started it. */
const betweenFilter = (userId: number, otherId: number) => ({
  $or: [
    { initiator_userid: userId, recipient_userid: otherId },
    { initiator_userid: otherId, recipient_userid: userId },
  ],
});

/** The live truce between two players, or null. */
export const findLiveTruce = (userId: number, otherId: number, now: number) =>
  postgres.em.findOne(Truce, { $and: [betweenFilter(userId, otherId), liveTruceFilter(now)] });

/** A span of time, rounded up, roughly: "1 day 23 h", "5 h", "12 min". */
export const spanText = (seconds: number) => {
  const totalHours = Math.ceil(seconds / 3_600);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) return `${days} ${days === 1 ? "day" : "days"}${hours > 0 ? ` ${hours} h` : ""}`;
  if (seconds > 3_600) return `${hours} h`;
  return `${Math.max(1, Math.ceil(seconds / 60))} min`;
};

/**
 * Why a proposer may not ask a player for a truce yet, as the soft refusal
 * the routes send (`{ error: 1, message, retryat }`), or null when they may:
 * the player rejected one of theirs less than 2 days ago.
 */
export const rejectionWait = async (proposerId: number, recipientId: number, now: number) => {
  const rejected = await postgres.em.findOne(Truce, {
    initiator_userid: proposerId,
    recipient_userid: recipientId,
    status: TruceStatus.REJECTED,
    expires_at: { $gt: now },
  });
  if (!rejected?.expires_at) return null;
  return {
    error: 1,
    message: `They rejected your last truce request. You can ask them again in ${spanText(rejected.expires_at - now)}.`,
    retryat: rejected.expires_at,
  };
};
