import { TruceStatus } from "../../enums/TruceStatus.js";
import type { Thread } from "../../database/models/thread.model.js";
import type { Truce } from "../../database/models/truce.model.js";

/**
 * The clock of a truce (#203) and the answer to a request, with no database
 * behind them: `truceRules.ts` re-exports all of it beside the reads, and the
 * bot sweep (`services/bots/truceDecline.ts`), which must not import
 * `server.js`, answers through {@link answerTruce} as a player's reply does.
 */

/** How long an accepted truce lasts, in seconds: 7 days (the owner's rule, #203; Flash asked for 14). */
export const TRUCE_DURATION = 7 * 24 * 60 * 60;

/** How long a request waits for an answer before it lapses, in seconds: 7 days. */
export const TRUCE_REQUEST_LIFETIME = 7 * 24 * 60 * 60;

/** How long the one who asked waits after a rejection before asking again, in seconds: 2 days. */
export const TRUCE_RETRY_AFTER_REJECTION = 2 * 24 * 60 * 60;

/** The last moment a request can be answered, in unix seconds. */
export const requestLapsesAt = (truce: Pick<Truce, "created_at">) =>
  Math.floor(new Date(truce.created_at).getTime() / 1000) + TRUCE_REQUEST_LIFETIME;

/** True while a request can still be answered. */
export const isRequestOpen = (truce: Pick<Truce, "status" | "created_at">, now: number) =>
  truce.status === TruceStatus.REQUESTED && requestLapsesAt(truce) > now;

/**
 * When the thread list says a truce ends (`truceexpire`): an accepted truce's
 * expiry, the moment a request lapses, and for a rejected one when its
 * proposer may ask again.
 */
export const truceEndsAt = (truce: Pick<Truce, "status" | "created_at" | "expires_at">) => {
  if (truce.status === TruceStatus.ACCEPTED) return truce.expires_at ?? null;
  if (truce.status === TruceStatus.REQUESTED) return requestLapsesAt(truce);
  if (truce.status === TruceStatus.REJECTED) return truce.expires_at ?? null;
  return null;
};

/**
 * Answers an open request, on the truce and its thread: accepted, it runs
 * {@link TRUCE_DURATION}; rejected, its proposer may ask again after
 * {@link TRUCE_RETRY_AFTER_REJECTION}. The caller has checked the request is
 * open and that the one answering is its recipient.
 */
export const answerTruce = (
  truce: Pick<Truce, "status" | "expires_at">,
  thread: Pick<Thread, "trucestate">,
  status: TruceStatus.ACCEPTED | TruceStatus.REJECTED,
  now: number
): void => {
  truce.status = status;
  thread.trucestate = status;
  truce.expires_at = now + (status === TruceStatus.ACCEPTED ? TRUCE_DURATION : TRUCE_RETRY_AFTER_REJECTION);
};
