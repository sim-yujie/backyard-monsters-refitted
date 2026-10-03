import type { EntityManager } from "@mikro-orm/postgresql";

import { BotJob } from "../../database/models/botjob.model.js";
import { Message } from "../../database/models/message.model.js";
import { Thread } from "../../database/models/thread.model.js";
import { Truce } from "../../database/models/truce.model.js";
import { User } from "../../database/models/user.model.js";
import { MessageType } from "../../enums/MessageType.js";
import { TruceStatus } from "../../enums/TruceStatus.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { logger } from "../../utils/logger.js";
import { answerTruce, isRequestOpen } from "../mail/truceTimes.js";
import { isBot } from "./isBot.js";

/**
 * A bot turns down every truce (issue #245, `docs/design/bot-neighbours.md`
 * §4.9, decisions 14 and 18): a request to a bot books a `declineTruce` job
 * ({@link bookTruceDecline}), due a random {@link DECLINE_TRUCE_HOURS} later,
 * and the bot sweep runs it ({@link declineTruce}): the bot answers in the
 * request's thread exactly as a player pressing Reject in the web mailbox
 * does, with Flash's words.
 *
 * The bot reads the thread as it answers (the request no longer counts as
 * unread for it), as a player must open it to press Reject.
 *
 * What the proposer then sees is a real rejection: the thread's
 * `trucestate`, a `trucereject` message from the bot, an unread count, and
 * the 2-day wait before they may ask that player again (`truceRules.ts`).
 *
 * A request that is no longer open when the job runs (lapsed, or answered
 * some other way) is left alone, and so is one between players who have
 * blocked each other since: a player could not answer it either
 * (`sendMessage`'s block refusal). Either way the job is done.
 *
 * Alliance invitations cannot reach a bot (it has no world; `inviteUser`
 * refuses), nor can an invitation to move (`handleInviteRequest` wants a Map
 * Room 2 player), and there are no friend invitations, so truces are the
 * only invitation a bot answers. Messages to a bot are never answered.
 */

/** A bot answers a truce request a uniform 2-8 hours after it was made (decision 18). */
export const DECLINE_TRUCE_HOURS = { min: 2, max: 8 } as const;

/** Flash's own words for a rejection (`mail_defaulttrucereject`), as the web mailbox sends them. */
export const TRUCE_REJECT_TEXT = "I reject your truce.";

/** The subject the web mailbox gives a reply in a thread whose last subject is empty (`web/src/game/mail/mailbox.ts`). */
export const NO_SUBJECT = "(no subject)";

const HOUR_MS = 60 * 60 * 1000;

/** The truce a `declineTruce` job answers: its `payload.truce`. */
export interface DeclineTrucePayload extends JsonObject {
  truce: number;
}

/**
 * Books a bot's answer to a truce request just made, when its recipient is a
 * bot; does nothing for a player. Called by both routes that make a request
 * (`requesttruce` and `sendmessage` `trucerequest`) once the truce row
 * exists. The route's answer is the same either way.
 *
 * @param {EntityManager} em - The request's entity manager
 * @param {Pick<Truce, "id" | "initiator_userid" | "recipient_userid">} truce - The request just made
 * @param {number} now - Unix seconds
 * @param {() => number} rng - Random numbers in [0, 1)
 * @returns {Promise<boolean>} True when a decline was booked
 */
export const bookTruceDecline = async (
  em: EntityManager,
  truce: Pick<Truce, "id" | "initiator_userid" | "recipient_userid">,
  now: number,
  rng: () => number = Math.random
): Promise<boolean> => {
  if (!(await isBot(truce.recipient_userid, em))) return false;

  const hours = DECLINE_TRUCE_HOURS.min + rng() * (DECLINE_TRUCE_HOURS.max - DECLINE_TRUCE_HOURS.min);
  em.create(BotJob, {
    bot_userid: truce.recipient_userid,
    kind: "declineTruce",
    target_userid: truce.initiator_userid,
    due_at: new Date(now * 1000 + hours * HOUR_MS),
    payload: { truce: truce.id } satisfies DeclineTrucePayload,
  });
  await em.flush();
  return true;
};

/** A player's unread messages, as `countUnreadMessage` counts them. */
const unreadCount = (tx: EntityManager, userid: number): Promise<number> =>
  tx.count(Message, {
    $or: [
      { userid, userUnread: 1 },
      { targetid: userid, targetUnread: 1 },
    ],
  });

/** The job row the sweep hands over. */
export interface DeclineTruceJob {
  bot_userid: number;
  payload: JsonObject;
}

/** What {@link declineTruce} did. */
export type DeclineOutcome = "rejected" | "closed" | "blocked";

/**
 * The `declineTruce` job (the file comment): rejects the request in its
 * thread, as `sendMessage` writes a `trucereject` reply. Runs inside the
 * sweep's transaction, which then deletes the job.
 *
 * @param {EntityManager} tx - The job's transaction
 * @param {DeclineTruceJob} job - The claimed job
 * @param {number} now - Unix seconds
 * @returns {Promise<DeclineOutcome>} What became of the request
 */
export const declineTruce = async (tx: EntityManager, job: DeclineTruceJob, now: number): Promise<DeclineOutcome> => {
  const truceId = Number(job.payload?.truce);
  const truce = Number.isInteger(truceId) ? await tx.findOne(Truce, { id: truceId }) : null;
  if (!truce || truce.recipient_userid !== job.bot_userid || !isRequestOpen(truce, now)) return "closed";

  const thread = await tx.findOne(Thread, { truce_id: truce.id }, { populate: ["lastMessage"] });
  if (!thread) {
    logger.warn("Truce {truce} to bot {bot} has no thread; left to lapse", { truce: truce.id, bot: job.bot_userid });
    return "closed";
  }

  const [bot, proposer] = await Promise.all([
    tx.findOne(User, { userid: job.bot_userid }, { populate: ["save"], fields: ["blockedUsers", "save.unreadmessages"] }),
    tx.findOne(User, { userid: truce.initiator_userid }, { populate: ["save"], fields: ["blockedUsers", "save.unreadmessages"] }),
  ]);
  if (!bot || !proposer?.save) return "closed";
  if (bot.blockedUsers.includes(proposer.userid) || proposer.blockedUsers.includes(bot.userid)) return "blocked";

  // The bot opens the thread first, as a player must to press Reject: what
  // it holds for the bot is read (`getMessageThread`).
  const unread = await tx.find(Message, {
    threadid: thread.threadid,
    $or: [
      { userid: bot.userid, userUnread: 1 },
      { targetid: bot.userid, targetUnread: 1 },
    ],
  });
  for (const message of unread) {
    if (message.userid === bot.userid) message.userUnread = 0;
    else message.targetUnread = 0;
  }

  answerTruce(truce, thread, TruceStatus.REJECTED, now);

  // The reply as the web mailbox sends it (`MailboxScreen.answerTruce`): the
  // thread's subject and Flash's words, through `sendMessage`'s filter.
  const { Filter } = await import("bad-words");
  const filter = new Filter();
  const reply = tx.create(Message, {
    threadid: thread.threadid,
    userid: bot.userid,
    targetid: proposer.userid,
    messagetype: MessageType.TRUCE_REJECT,
    userUnread: 0,
    targetUnread: 1,
    subject: filter.clean(thread.lastMessage?.subject || NO_SUBJECT),
    message: filter.clean(TRUCE_REJECT_TEXT),
    updatetime: now,
  });
  thread.messagecount++;
  thread.lastMessage = reply;
  await tx.flush();

  proposer.save.unreadmessages = await unreadCount(tx, proposer.userid);
  if (bot.save) bot.save.unreadmessages = await unreadCount(tx, bot.userid);
  await tx.flush();
  return "rejected";
};
