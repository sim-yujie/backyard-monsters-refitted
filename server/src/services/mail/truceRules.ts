import { TruceStatus } from "../../enums/TruceStatus.js";
import { Truce } from "../../database/models/truce.model.js";
import { postgres } from "../../server.js";

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
 */

/** How long an accepted truce lasts, in seconds: 14 days. */
export const TRUCE_DURATION = 14 * 24 * 60 * 60;

/** How long a request waits for an answer before it lapses, in seconds: 7 days. */
export const TRUCE_REQUEST_LIFETIME = 7 * 24 * 60 * 60;

/** The last moment a request can be answered, in unix seconds. */
export const requestLapsesAt = (truce: Pick<Truce, "created_at">) =>
  Math.floor(new Date(truce.created_at).getTime() / 1000) + TRUCE_REQUEST_LIFETIME;

/** True while a request can still be answered. */
export const isRequestOpen = (truce: Pick<Truce, "status" | "created_at">, now: number) =>
  truce.status === TruceStatus.REQUESTED && requestLapsesAt(truce) > now;

/**
 * When the thread list says a truce ends (`truceexpire`): an accepted truce's
 * expiry, the moment a request lapses, and nothing for a rejected one.
 */
export const truceEndsAt = (truce: Pick<Truce, "status" | "created_at" | "expires_at">) => {
  if (truce.status === TruceStatus.ACCEPTED) return truce.expires_at ?? null;
  if (truce.status === TruceStatus.REQUESTED) return requestLapsesAt(truce);
  return null;
};

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
