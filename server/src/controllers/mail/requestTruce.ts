import z from "zod";

import { Status } from "../../enums/StatusCodes.js";
import { TruceStatus } from "../../enums/TruceStatus.js";
import { BaseType } from "../../enums/Base.js";
import { Message } from "../../database/models/message.model.js";
import { Save } from "../../database/models/save.model.js";
import { Truce } from "../../database/models/truce.model.js";
import { User } from "../../database/models/user.model.js";
import { postgres } from "../../server.js";
import { countUnreadMessage } from "../../services/mail/countUnreadMessage.js";
import { findOrCreateThread } from "../../services/mail/findOrCreateThread.js";
import { findLiveTruce, rejectionWait } from "../../services/mail/truceRules.js";
import { bookTruceDecline } from "../../services/bots/truceDecline.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import type { KoaController } from "../../utils/KoaController.js";
import { mailboxErr, permissionErr, truceExistsErr } from "../../errors/errors.js";

const TruceSchema = z.object({
  baseid: z.string(),
  message: z.string().max(580).min(1),
});

/**
 * Creates a truce request between the authenticated user and the owner of the given base.
 *
 * - Resolves the target player from the provided baseid: a player's main yard or outpost
 * - Guards against self-truces, a block either way (the soft refusal `sendmessage` gives),
 *   and a request still waiting or a truce still running between the pair (`truceRules.ts`)
 * - Refuses softly, saying when, while the target rejected this user's last request
 *   under 2 days ago (`rejectionWait`)
 * - Creates a Truce record and a new mailbox thread with the request message, and
 *   answers with that thread's id (#203)
 * - To a bot: books its answer, a rejection some hours later (`bookTruceDecline`)
 *
 * @param {Context} ctx - Koa context. Expects baseid and message in the request body.
 */
export const requestTruce: KoaController = async (ctx) => {
  const user: User = ctx.authUser;

  const { baseid, message } = TruceSchema.parse(ctx.request.body);

  const targetSave = await postgres.em.findOne(Save, { baseid });

  if (!targetSave || (targetSave.type !== BaseType.MAIN && targetSave.type !== BaseType.OUTPOST)) {
    throw mailboxErr();
  }

  if (targetSave.saveuserid === user.userid) throw permissionErr();

  const targetUserid = targetSave.saveuserid;

  const recipient = await postgres.em.findOne(
    User,
    { userid: targetUserid },
    { populate: ["save"], fields: ["blockedUsers", "save.unreadmessages"] }
  );

  if (!recipient) throw mailboxErr();

  if (user.blockedUsers.includes(targetUserid) || recipient.blockedUsers.includes(user.userid)) {
    ctx.status = Status.OK;
    ctx.body = { error: 1, message: "Cannot send message to this user" };
    return;
  }

  const now = getCurrentDateTime();

  if (await findLiveTruce(user.userid, targetUserid, now)) throw truceExistsErr();

  // Asked too soon after a rejection: the soft refusal says when they may ask again.
  const wait = await rejectionWait(user.userid, targetUserid, now);
  if (wait) {
    ctx.status = Status.OK;
    ctx.body = wait;
    return;
  }

  const { Filter } = await import("bad-words");
  const filteredMessage = new Filter().clean(message);

  const truce = postgres.em.create(Truce, {
    initiator_userid: user.userid,
    recipient_userid: targetUserid,
    status: TruceStatus.REQUESTED,
    created_at: new Date(),
  });

  postgres.em.persist(truce);
  await postgres.em.flush();

  const thread = await findOrCreateThread(0, targetUserid, user.userid);
  thread.truce_id = truce.id;
  thread.trucestate = TruceStatus.REQUESTED;

  const newMessage = postgres.em.create(Message, {
    threadid: thread.threadid,
    userid: user.userid,
    targetid: targetUserid,
    messagetype: "trucerequest",
    userUnread: 0,
    targetUnread: 1,
    subject: `Truce Request from ${user.username}`,
    message: filteredMessage,
    updatetime: getCurrentDateTime(),
  });

  thread.messagecount++;
  thread.lastMessage = newMessage;

  postgres.em.persist(thread);
  await postgres.em.flush();

  if (recipient.save) {
    recipient.save.unreadmessages = await countUnreadMessage(targetUserid);
    postgres.em.persist(recipient);
    await postgres.em.flush();
  }

  await bookTruceDecline(postgres.em, truce, now);

  ctx.status = Status.OK;
  ctx.body = { error: 0, threadid: thread.threadid };
};
