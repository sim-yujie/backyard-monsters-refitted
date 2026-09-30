import { TruceStatus } from "../../enums/TruceStatus.js";
import { Truce } from "../../database/models/truce.model.js";
import type { Thread } from "../../database/models/thread.model.js";
import { postgres } from "../../server.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { truceExistsErr } from "../../errors/errors.js";
import { findLiveTruce } from "./truceRules.js";

/**
 * Creates a truce request from the current user to the message recipient.
 *
 * - Guards against a request still waiting or a truce still running between the pair (`truceRules.ts`)
 * - Creates a Truce record and links it to the thread
 *
 * @param userid - The authenticated user's ID
 * @param recipientId - The target user's ID
 * @param thread - The mailbox thread to link the truce to
 */
export const handleTruceRequest = async (userid: number, recipientId: number, thread: Thread) => {
  if (await findLiveTruce(userid, recipientId, getCurrentDateTime())) throw truceExistsErr();

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
};
