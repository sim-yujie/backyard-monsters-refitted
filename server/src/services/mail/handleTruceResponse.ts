import { TruceStatus } from "../../enums/TruceStatus.js";
import { Truce } from "../../database/models/truce.model.js";
import type { Thread } from "../../database/models/thread.model.js";
import { postgres } from "../../server.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { mailboxErr, permissionErr, truceClosedErr } from "../../errors/errors.js";
import { isRequestOpen, TRUCE_DURATION, TRUCE_RETRY_AFTER_REJECTION } from "./truceRules.js";

type TruceResponse = TruceStatus.ACCEPTED | TruceStatus.REJECTED;

/**
 * Accepts or rejects a pending truce request on behalf of the recipient.
 *
 * - Validates the thread has a linked truce
 * - Validates the caller is the truce recipient (not the initiator)
 * - Validates the request can still be answered: not answered yet, and not
 *   lapsed (`truceRules.ts`, 7 days)
 * - On accept: sets status to ACCEPTED and calculates expiry
 * - On reject: sets status to REJECTED, and when its proposer may ask again (2 days on)
 *
 * @param userid - The authenticated user's ID
 * @param thread - The mailbox thread linked to the truce
 * @param status - TruceStatus.ACCEPTED or TruceStatus.REJECTED
 */
export const handleTruceResponse = async (userid: number, thread: Thread, status: TruceResponse) => {
  if (!thread.truce_id) throw mailboxErr();

  const truce = await postgres.em.findOne(Truce, { id: thread.truce_id });

  if (!truce) throw mailboxErr();

  if (truce.recipient_userid !== userid) throw permissionErr();

  const now = getCurrentDateTime();

  if (!isRequestOpen(truce, now)) throw truceClosedErr();

  truce.status = status;
  thread.trucestate = status;

  truce.expires_at = now + (status === TruceStatus.ACCEPTED ? TRUCE_DURATION : TRUCE_RETRY_AFTER_REJECTION);

  postgres.em.persist(truce);
};
