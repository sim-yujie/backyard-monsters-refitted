import { TruceStatus } from "../../enums/TruceStatus.js";
import { Truce } from "../../database/models/truce.model.js";
import type { Thread } from "../../database/models/thread.model.js";
import { postgres } from "../../server.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { truceExistsErr } from "../../errors/errors.js";
import { findLiveTruce, rejectionWait } from "./truceRules.js";
import { bookTruceDecline } from "../bots/truceDecline.js";

/**
 * Creates a truce request from the current user to the message recipient.
 *
 * - Guards against a request still waiting or a truce still running between the pair (`truceRules.ts`)
 * - Refuses softly while the recipient's rejection of this user's last request
 *   is under 2 days old: answers that refusal (`rejectionWait`) and writes nothing
 * - Creates a Truce record and links it to the thread
 * - To a bot: books its answer, a rejection some hours later (`bookTruceDecline`)
 *
 * @param userid - The authenticated user's ID
 * @param recipientId - The target user's ID
 * @param thread - The mailbox thread to link the truce to
 * @returns The soft refusal to send, or null once the request is made
 */
export const handleTruceRequest = async (userid: number, recipientId: number, thread: Thread) => {
  const now = getCurrentDateTime();

  if (await findLiveTruce(userid, recipientId, now)) throw truceExistsErr();

  const wait = await rejectionWait(userid, recipientId, now);
  if (wait) return wait;

  const truce = postgres.em.create(Truce, {
    initiator_userid: userid,
    recipient_userid: recipientId,
    status: TruceStatus.REQUESTED,
    created_at: new Date(),
  });

  postgres.em.persist(truce);
  await postgres.em.flush();

  thread.truce_id = truce.id;
  thread.trucestate = TruceStatus.REQUESTED;

  await bookTruceDecline(postgres.em, truce, now);
  return null;
};
