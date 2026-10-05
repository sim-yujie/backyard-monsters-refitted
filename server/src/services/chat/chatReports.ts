import type { EntityManager } from "@mikro-orm/postgresql";
import type { HistoryEntry } from "../../chat/chatProtocol.js";

/**
 * Reports of world chat lines (issue #282), stored in `bym.chat_report` for
 * moderation. Nothing reads them back yet.
 *
 * The reporter's client names the line by who said it and when (the chat
 * server's millisecond stamp). The channel's own history is checked for that
 * line first: when it is still there, the server's copy of the words is kept
 * and the row is `verified`, so a report cannot put words in anyone's mouth.
 * A line that has already rolled out of the history keeps the client's words,
 * unverified, rather than being refused.
 */

/** The longest line the chat server accepts (`chatRooms.ts` `MAX_MSG_LEN`). */
export const CHAT_REPORT_MAX_TEXT = 200;

export interface ChatReportInput {
  reporter: number;
  reported: number;
  /** A validated global channel key. */
  channel: string;
  /** The line's words as the reporter's client holds them. */
  message: string;
  /** When the line was said (ms since the epoch). */
  ts: number;
}

export interface ChatReportResult {
  /** False when this reporter had already reported this line. */
  stored: boolean;
  verified: boolean;
}

/** The channel's own copy of the reported line, or null when it is gone. */
export const findReportedLine = (
  history: readonly HistoryEntry[],
  reported: number,
  ts: number,
): HistoryEntry | null => history.find((entry) => entry.userId === reported && entry.ts === ts) ?? null;

/**
 * Stores one report; a second report of the same line by the same player is
 * a no-op (`chat_report_once`).
 *
 * @param {EntityManager} em - Any entity manager; the insert is raw SQL and flushes nothing.
 * @param {ChatReportInput} input - Who reported which line.
 * @param {readonly HistoryEntry[]} history - The channel's current history, oldest first.
 * @returns {Promise<ChatReportResult>} Whether a row was written, and whether the words were the server's.
 */
export const recordChatReport = async (
  em: EntityManager,
  input: ChatReportInput,
  history: readonly HistoryEntry[],
): Promise<ChatReportResult> => {
  const line = findReportedLine(history, input.reported, input.ts);
  const verified = line !== null;
  const message = (line ? line.body : input.message).slice(0, CHAT_REPORT_MAX_TEXT);

  const rows = await em.execute<{ id: number }[]>(
    `INSERT INTO bym.chat_report (reporter_id, reported_id, channel, message, message_ts, verified)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING RETURNING id`,
    [input.reporter, input.reported, input.channel, message, input.ts, verified],
  );

  return { stored: rows.length > 0, verified };
};
