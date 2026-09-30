import type { Thread } from "../../database/models/thread.model.js";
import { postgres } from "../../server.js";
import { inviteClosedErr, mailboxErr, permissionErr } from "../../errors/errors.js";
import { findInviteOutpost, findThreadInvite, InviteState, inviteState } from "./inviteRules.js";

/**
 * Withdraws the thread's invitation to move (#205, Flash's `migraterevoke`),
 * on behalf of the one who sent it. It must still wait for its answer
 * (`inviteRules.ts`): not answered, withdrawn, lapsed or void.
 *
 * @param userid - The authenticated user's ID
 * @param thread - The mailbox thread holding the invitation
 * @param now - Unix seconds
 */
export const handleInviteRevoke = async (userid: number, thread: Thread, now: number) => {
  const invite = await findThreadInvite(postgres.em, thread.threadid);

  if (!invite) throw mailboxErr();

  if (invite.userid !== userid) throw permissionErr();

  const outpost = await findInviteOutpost(postgres.em, invite.baseid);

  if (inviteState(invite, outpost, now) !== InviteState.REQUESTED) throw inviteClosedErr();

  invite.migratestate = InviteState.REVOKED;
  postgres.em.persist(invite);
};
