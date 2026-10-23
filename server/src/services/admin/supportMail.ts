import type { EntityManager } from "@mikro-orm/postgresql";

import { Message } from "../../database/models/message.model.js";
import { Thread } from "../../database/models/thread.model.js";
import { SUPPORT_SENDER } from "../mail/systemSender.js";
import { refreshUnread } from "../maproom/v2/outpostNotices.js";
import { logger } from "../../utils/logger.js";

/**
 * The owner writing to players in the game's mail (dashboard support tools,
 * `docs/design/admin-dashboard-api.md`, "Replies and Shiny"). Every message
 * comes from "The game team" (`SUPPORT_SENDER`, -1), never from the owner's
 * own account.
 *
 * - A reply to a bug report goes into that report's thread
 *   (`bug_report.mail_thread_id`), started by the first reply. The player can
 *   answer in it like any thread (`sendMessage`, {@link mayAnswerTeam}), and
 *   the answers show under the report.
 * - A Shiny gift from a report goes into the same thread; one given from the
 *   Shiny section, with no report, is a notice of its own that cannot be
 *   answered (`shinyAwards.ts`).
 */

/** A message from the team in a report's thread: the player may answer it. */
export const TEAM_MESSAGE = "team";
/** A message from the team outside any report: it cannot be answered. */
export const TEAM_NOTICE = "teamnotice";

/** The mail's own limit on one message (`SendMessageSchema`, `message.message`). */
export const MAX_TEAM_TEXT = 580;

/** The subject of a report's thread, as the player's mailbox lists it. */
export const REPORT_SUBJECT = "About your bug report";

/**
 * How many of the player's answers in a report's thread the owner has not
 * opened, as a column of `bym.bug_report` (`bugReportsAdmin.ts`).
 */
export const UNREAD_REPLIES = `(SELECT count(*) FROM bym.message m
    WHERE m.threadid = bug_report.mail_thread_id AND m.targetid = ${SUPPORT_SENDER} AND m.target_unread = 1)`;

/** One message of a report's thread, as the dashboard shows it. */
export interface SupportMessage {
  readonly id: string;
  /** `team`: the owner (as "The game team"); `player`: the report's player. */
  readonly from: "team" | "player";
  readonly text: string;
  readonly at: string;
  /** A player's answer the owner had not seen before this read. */
  readonly unread: boolean;
}

/**
 * Why the owner cannot write to a report's player in the game: `signedOut`
 * (sent signed out, so there is no account; the report may have an email) or
 * `noPlayer` (the account is gone).
 */
export type NoReplyReason = "signedOut" | "noPlayer";

export const noReplyReason = async (em: EntityManager, userid: number | null): Promise<NoReplyReason | null> => {
  if (userid === null) return "signedOut";
  const [row] = await em.execute<{ found: number }[]>(`SELECT 1 AS found FROM bym."user" WHERE userid = ?`, [userid]);
  return row ? null : "noPlayer";
};

/**
 * The text of a team message from a request body's `message`: trimmed, 1 to
 * {@link MAX_TEAM_TEXT} characters.
 */
export const parseTeamText = (raw: unknown): { ok: true; text: string } | { ok: false; message: string } => {
  if (typeof raw !== "string") return { ok: false, message: "Write a message." };
  const text = raw.trim();
  if (text === "") return { ok: false, message: "Write a message." };
  if (text.length > MAX_TEAM_TEXT) return { ok: false, message: `Keep it to ${MAX_TEAM_TEXT} characters.` };
  return { ok: true, text };
};

export interface TeamMessageInput {
  /** The player told. */
  readonly userid: number;
  /** The thread to write into; a new one when null or no longer the player's thread with the team. */
  readonly threadid: number | null;
  readonly subject: string;
  readonly text: string;
  /** {@link TEAM_MESSAGE} or {@link TEAM_NOTICE}. */
  readonly type: string;
  /** Unix seconds. */
  readonly now: number;
}

/**
 * Leaves the player one unread message from the team and brings their unread
 * count up to date. Answers the thread it went into. Flushes `em`; inside a
 * transaction it lands with it.
 */
export const writeTeamMessage = async (em: EntityManager, input: TeamMessageInput): Promise<number> => {
  const { userid, threadid, subject, text, type, now } = input;
  let thread =
    threadid === null ? null : await em.findOne(Thread, { threadid, userid: SUPPORT_SENDER, targetid: userid });
  if (!thread) {
    const [last] = await em.find(Thread, {}, { orderBy: { threadid: "DESC" }, limit: 1 });
    thread = new Thread();
    thread.threadid = (last?.threadid ?? 0) + 1;
    thread.userid = SUPPORT_SENDER;
    thread.targetid = userid;
    thread.messagecount = 0;
  }
  const message = em.create(Message, {
    threadid: thread.threadid,
    userid: SUPPORT_SENDER,
    targetid: userid,
    messagetype: type,
    userUnread: 0,
    targetUnread: 1,
    subject,
    message: text,
    updatetime: now,
  });
  thread.messagecount++;
  thread.lastMessage = message;
  em.persist(thread);
  await em.flush();
  await refreshUnread(em, userid);
  return thread.threadid;
};

/** What {@link replyToReport} did. */
export type ReplyOutcome = "sent" | "notFound" | NoReplyReason;

/**
 * Sends the owner's `text` to report `id`'s player, in the report's thread
 * (started now if there is none). The report row is locked meanwhile, so two
 * first replies make one thread.
 */
export const replyToReport = async (
  em: EntityManager,
  id: number,
  text: string,
  by: number,
  now: number
): Promise<ReplyOutcome> => {
  const outcome = await em.transactional(async (tx): Promise<ReplyOutcome> => {
    const [row] = await tx.execute<{ userid: number | null; mail_thread_id: number | null }[]>(
      `SELECT userid, mail_thread_id FROM bym.bug_report WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (!row) return "notFound";
    const userid = row.userid === null ? null : Number(row.userid);
    const refusal = await noReplyReason(tx, userid);
    if (refusal || userid === null) return refusal ?? "signedOut";
    const threadid = await writeTeamMessage(tx, {
      userid,
      threadid: row.mail_thread_id === null ? null : Number(row.mail_thread_id),
      subject: REPORT_SUBJECT,
      text,
      type: TEAM_MESSAGE,
      now,
    });
    if (threadid !== row.mail_thread_id) {
      await tx.execute(`UPDATE bym.bug_report SET mail_thread_id = ? WHERE id = ?`, [threadid, id]);
    }
    return "sent";
  });
  if (outcome === "sent") logger.info(`Dashboard: reply to bug report ${id} sent by ${by}`);
  return outcome;
};

interface ThreadRow {
  id: string;
  userid: number;
  message: string | null;
  updatetime: number;
  target_unread: number;
}

/**
 * A report's thread, oldest first, and marks the player's answers in it read
 * (the dashboard is the team's only way to read them). Each answer read for
 * the first time comes back `unread`.
 */
export const readSupportThread = async (em: EntityManager, threadid: number): Promise<SupportMessage[]> => {
  const rows = await em.execute<ThreadRow[]>(
    `SELECT id, userid, message, updatetime, target_unread FROM bym.message
      WHERE threadid = ? ORDER BY updatetime, created_at`,
    [threadid]
  );
  const messages = rows.map((row): SupportMessage => {
    const team = Number(row.userid) === SUPPORT_SENDER;
    return {
      id: row.id,
      from: team ? "team" : "player",
      text: row.message ?? "",
      at: new Date(Number(row.updatetime) * 1000).toISOString(),
      unread: !team && Number(row.target_unread) === 1,
    };
  });
  if (messages.some((message) => message.unread)) {
    await em.execute(
      `UPDATE bym.message SET target_unread = 0 WHERE threadid = ? AND targetid = ? AND target_unread = 1`,
      [threadid, SUPPORT_SENDER]
    );
  }
  return messages;
};

/**
 * Whether `userid` may answer the team in `threadid`: only in a thread that
 * belongs to one of their own bug reports. A notice (a Shiny gift with no
 * report) and a thread they started to the team themselves cannot be answered.
 */
export const mayAnswerTeam = async (em: EntityManager, userid: number, threadid: number): Promise<boolean> => {
  if (!Number.isSafeInteger(threadid) || threadid < 1) return false;
  const [row] = await em.execute<{ found: number }[]>(
    `SELECT 1 AS found FROM bym.bug_report r
       JOIN bym.thread t ON t.threadid = r.mail_thread_id
      WHERE r.mail_thread_id = ? AND r.userid = ? AND t.userid = ? AND t.targetid = ?
      LIMIT 1`,
    [threadid, userid, SUPPORT_SENDER, userid]
  );
  return Boolean(row);
};
