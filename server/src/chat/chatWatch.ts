import { ChannelType } from "../enums/Chat.js";
import { postgres } from "../server.js";
import { FlagLimiter, recordChatFlag, type LineCheck } from "../services/chat/chatFlags.js";
import { ChatLogWriter, insertChatLogLines } from "../services/chat/chatLog.js";
import { logger } from "../utils/logger.js";

/**
 * What the chat server keeps of each line for the owner's dashboard: World
 * and country room lines go into the chat log (`services/chat/chatLog.ts`),
 * and a line the word filter caught, in any room including alliance chat,
 * becomes an automatic flag (`services/chat/chatFlags.ts`).
 *
 * Nothing here is waited for and nothing here throws: a failed write is
 * logged and the line has already gone out to players.
 */

const warn = (message: string) => logger.warn(message);

const chatLog = new ChatLogWriter((lines) => insertChatLogLines(postgres.orm.em.fork(), lines), warn);

const flagLimiter = new FlagLimiter();

export interface WatchedLine {
  userid: number;
  channel: string;
  channelType: ChannelType;
  /** The player's own words. */
  message: string;
  check: LineCheck;
  /** The line's chat stamp (ms). */
  ts: number;
}

/** Logs a line and, if the filter caught it, flags it. Never throws. */
export const watchLine = (line: WatchedLine): void => {
  try {
    const { check } = line;
    if (line.channelType !== ChannelType.Alliance) {
      chatLog.add({
        userid: line.userid,
        channel: line.channel,
        message: line.message,
        shown: check.shown,
        flagged: check.severity,
        at: new Date(line.ts),
      });
    }

    if (check.severity && flagLimiter.take(line.userid, line.ts)) {
      recordChatFlag(postgres.orm.em.fork(), {
        userid: line.userid,
        channel: line.channel,
        message: line.message,
        shown: check.shown,
        words: check.words,
        severity: check.severity,
        ts: line.ts,
      }).catch((err) => warn(`Chat flag not saved for ${line.userid}: ${err}`));
    }
  } catch (err) {
    warn(`Chat line not watched for ${line.userid}: ${err}`);
  }
};

/** Saves the chat log's queued lines now (tests, and a server about to stop). */
export const flushChatLog = (): Promise<number> => chatLog.flush();
