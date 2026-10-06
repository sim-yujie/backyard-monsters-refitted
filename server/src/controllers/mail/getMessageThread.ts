import { ZodError } from "zod";
import { Status } from "../../enums/StatusCodes.js";
import { mailboxErr } from "../../errors/errors.js";
import { User } from "../../database/models/user.model.js";
import type { KoaController } from "../../utils/KoaController.js";
import { postgres } from "../../server.js";
import { GetMessageSchema } from "./zod/GetMessageSchema.js";
import { countUnreadMessage } from "../../services/mail/countUnreadMessage.js";
import { findUserMessages } from "../../services/mail/findUserMessages.js";
import { Message } from "../../database/models/message.model.js";
import { FilterFrontendKeys } from "../../utils/FrontendKey.js";
import { MessageType } from "../../enums/MessageType.js";
import { findInviteOutposts, inviteFields } from "../../services/mail/inviteRules.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";

/**
 * Controller to get multiple messages with single threadid.
 * This function retrieves messages for a specific thread and marks them as read if necessary.
 * An invitation to move (#205) says where it stands now and when it lapses
 * (`migratestate`, `migrateexpire`), with its outpost's cell in `coords`.
 *
 * @param {Context} ctx - The Koa context object, which includes the request body.
 * @returns {Promise<void>} - A promise that resolves when the controller is complete.
 * @throws {Error} - Throws an error if the request body is missing required fields or if logging fails.
 */
export const getMessageThread: KoaController = async (ctx) => {
  try {
    const user: User = ctx.authUser;
    const userSave = user.save!;
    await postgres.em.populate(user, ["save"], { fields: ["save.unreadmessages"] });

    const { threadid } = GetMessageSchema.parse(ctx.request.body);

    const messages = await findUserMessages(user, { threadid });
    const hasUnreadMessage = messages.some((message) => message.unread === 1);

    if (hasUnreadMessage) {
      messages.forEach((message) => {
        if (message.userid === user.userid) {
          message.userUnread = 0;
          message.unread = 0;
        } else {
          message.targetUnread = 0;
          message.unread = 0;
        }
      });

      postgres.em.persist(messages);
      await postgres.em.flush();

      const count = await countUnreadMessage(user.userid);

      userSave.unreadmessages = count;
      await postgres.em.flush();
    }

    const invites = messages.filter((message) => message.messagetype === MessageType.MIGRATE_REQUEST);
    const inviteOutposts = await findInviteOutposts(postgres.em, invites.map((invite) => invite.baseid));
    const now = getCurrentDateTime();

    const thread = Object.fromEntries(
      messages.map((message: Message) => [
        message.messageid,
        {
          ...FilterFrontendKeys(message),
          ...(message.messagetype === MessageType.MIGRATE_REQUEST && inviteFields(message, inviteOutposts, now)),
        },
      ])
    );

    ctx.status = Status.OK;
    ctx.body = { error: 0, thread };
  } catch (err) {
    // A body that fails its schema answers 400 globally (issue #224).
    if (err instanceof ZodError) throw err;
    throw mailboxErr();
  }
};
