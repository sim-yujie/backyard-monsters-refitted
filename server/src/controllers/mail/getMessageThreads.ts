import { Status } from "../../enums/StatusCodes.js";
import { mailboxErr } from "../../errors/errors.js";
import { User } from "../../database/models/user.model.js";
import type { KoaController } from "../../utils/KoaController.js";

import { postgres } from "../../server.js";
import { Thread } from "../../database/models/thread.model.js";
import { FilterFrontendKeys } from "../../utils/FrontendKey.js";
import { logger } from "../../utils/logger.js";
import { Truce } from "../../database/models/truce.model.js";
import { truceEndsAt } from "../../services/mail/truceRules.js";
import { Message } from "../../database/models/message.model.js";
import { MessageType } from "../../enums/MessageType.js";
import { findInviteOutposts, inviteFields } from "../../services/mail/inviteRules.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";

/**
 * Controller to get threads for mailbox.
 *
 * Retrieves message threads for the authenticated user.
 * Populates the last message in each thread and formats the response.
 * A thread with a truce says when it ends (`truceexpire`, #203): the accepted
 * truce's expiry, or when a waiting request lapses. A thread with an
 * invitation to move says where its latest stands and when it lapses
 * (`migratestate`, `migrateexpire`, #205), lapse and void included.
 *
 * @param {Context} ctx - The Koa context object, which includes the request body.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 * @throws {Error} - Throws an error if the request body is missing required fields or if logging fails.
 */
export const getMessageThreads: KoaController = async (ctx) => {
  const user: User = ctx.authUser;

  try {
    const threads = await postgres.em.find(
      Thread,
      {
        $or: [{ userid: user.userid }, { targetid: user.userid }],
      },
      { populate: ["lastMessage"] }
    );

    const blockedUsers = new Set(user.blockedUsers);

    // Filter out threads with blocked users and ensure they have lastMessage
    const filteredThreads = threads.filter((thread) => {
      const targetUser = thread.userid === user.userid ? thread.targetid : thread.userid;
      return thread.lastMessage && !blockedUsers.has(targetUser);
    });

    const truceIds = filteredThreads.flatMap((thread) => (thread.truce_id ? [thread.truce_id] : []));
    const truces = truceIds.length ? await postgres.em.find(Truce, { id: { $in: truceIds } }) : [];
    const trucesById = new Map(truces.map((truce) => [truce.id, truce]));

    // Each thread's latest invitation to move (#205), and its outpost as it is now.
    const threadIds = filteredThreads.map((thread) => thread.threadid);
    const invites = threadIds.length
      ? await postgres.em.find(
          Message,
          { threadid: { $in: threadIds }, messagetype: MessageType.MIGRATE_REQUEST },
          { orderBy: { updatetime: "ASC", createdAt: "ASC" } }
        )
      : [];
    const inviteOutposts = await findInviteOutposts(postgres.em, invites.map((invite) => invite.baseid));
    const now = getCurrentDateTime();
    // Read before the last messages' `userid` is rewritten below: an invitation may be one of them.
    const inviteByThread = new Map(
      invites.map((invite) => [invite.threadid, inviteFields(invite, inviteOutposts, now)])
    );

    const threadMessages = filteredThreads.flatMap((thread, index) => {
      if (!thread.lastMessage) return [];

      const lastMessage = thread.lastMessage;
      const isSender = lastMessage.userid === user.userid;

      lastMessage.selectUnread(user.userid);

      lastMessage.messageid = index.toString();
      lastMessage.messagecount = thread.messagecount;
      lastMessage.trucestate = thread.trucestate ?? null;
      const truce = thread.truce_id ? trucesById.get(thread.truce_id) : undefined;
      const truceEnd = truce ? truceEndsAt(truce) : null;
      if (truceEnd !== null) lastMessage.truceexpire = truceEnd;
      lastMessage.userid = isSender ? lastMessage.targetid : lastMessage.userid;
      lastMessage.reportid = "0";

      return [lastMessage];
    });

    const threadsList = Object.fromEntries(
      threadMessages.map((message) => {
        const invite = inviteByThread.get(message.threadid);
        return [
          message.threadid,
          { ...FilterFrontendKeys(message), ...invite },
        ];
      })
    );

    ctx.status = Status.OK;
    ctx.body = { error: 0, threads: threadsList };
  } catch (err) {
    logger.error(`Error getting message threads: ${err}`);
    throw mailboxErr();
  }
};
