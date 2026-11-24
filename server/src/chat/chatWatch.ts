import { ChannelType } from "../enums/Chat.js";
import { postgres, redis } from "../server.js";
import { alertChatFlag } from "../services/alerts/moderationAlerts.js";
import { filterWhy, type FilterOutcome } from "../services/chat/chatFilter.js";
import { countHits } from "../services/chat/watchWords.js";
import { chatFlagRooms, FlagLimiter, isFlaggedRoom, recordChatFlag, type LineCheck } from "../services/chat/chatFlags.js";
import { ChatLogWriter, insertChatLogLines } from "../services/chat/chatLog.js";
import { logger } from "../utils/logger.js";

/**
 * What the chat server keeps of each line for the owner's dashboard: World
 * and country room lines go into the chat log (`services/chat/chatLog.ts`),
 * and a line the word filter caught in a monitored room (`CHAT_FLAG_ROOMS`:
 * World and the Philippines room by default) becomes an automatic flag
 * (`services/chat/chatFlags.ts`). Alliance lines are private: neither logged
 * nor flagged.
 *
 * The chat filter's flags (links and watched words, `services/chat/chatFilter.ts`;
 * owner 24 Nov 2026) come from every public room, whatever `CHAT_FLAG_ROOMS`
 * says, and are told on Telegram (`alertChatFlag`, at most 10 an hour). Each
 * watched word is counted for the dashboard on every line; flags, as all
 * flags, are limited per player ({@link FlagLimiter}).
 *
 * Nothing here is waited for and nothing here throws: a failed write is
 * logged and the line has already gone out to players.
 */

const warn = (message: string) => logger.warn(message);

const chatLog = new ChatLogWriter((lines) => insertChatLogLines(postgres.orm.em.fork(), lines), warn);

const flagLimiter = new FlagLimiter();

const flagRooms = chatFlagRooms();

export interface WatchedLine {
  userid: number;
  /** For the Telegram message. */
  username?: string;
  channel: string;
  channelType: ChannelType;
  /** The player's own words. */
  message: string;
  check: LineCheck;
  /** The line's chat stamp (ms). */
  ts: number;
  /** What the chat filter did (public rooms only). */
  filter?: FilterOutcome;
  /** What other players saw, when the filter changed it: the cut line, or "" when hidden. */
  shown?: string;
  /** The chat line's id. */
  lineId?: string;
  /** A new player's main yard age in hours, else null. */
  yardAgeHours?: number | null;
}

/** Logs a line and, if the filter caught it, flags it. Never throws. */
export const watchLine = (line: WatchedLine): void => {
  try {
    const { check, filter } = line;
    const swear = isFlaggedRoom(flagRooms, line.channelType, line.channel) ? check.severity : null;
    const filtered = line.channelType !== ChannelType.Alliance && filter?.flag === true && filter.tags.length > 0;
    const severity = swear ?? (filtered ? "filter" : null);
    const shown = line.shown ?? check.shown;
    if (line.channelType !== ChannelType.Alliance) {
      chatLog.add({
        userid: line.userid,
        channel: line.channel,
        message: line.message,
        shown,
        flagged: severity,
        at: new Date(line.ts),
      });
      // Every hit counts, flagged or not (the dashboard's "hits in 7 days").
      if (filter && filter.words.length > 0) void countHits(redis, filter.words, line.ts);
    }

    if (severity && flagLimiter.take(line.userid, line.ts)) {
      recordChatFlag(postgres.orm.em.fork(), {
        userid: line.userid,
        channel: line.channel,
        message: line.message,
        shown,
        words: [...new Set([...check.words, ...(filtered ? filter!.words : [])])],
        severity,
        rule: check.rule ?? "word",
        ts: line.ts,
        ...(filtered && {
          tags: filter!.tags,
          hidden: filter!.hidden,
          ...(line.lineId && { lineId: line.lineId }),
          yardAgeHours: line.yardAgeHours ?? null,
        }),
      }).catch((err) => warn(`Chat flag not saved for ${line.userid}: ${err}`));
      if (filtered) {
        void alertChatFlag({
          userid: line.userid,
          username: line.username ?? null,
          channel: line.channel,
          text: line.message,
          why: filterWhy(filter!),
        });
      }
    }
  } catch (err) {
    warn(`Chat line not watched for ${line.userid}: ${err}`);
  }
};

/** Saves the chat log's queued lines now (tests, and a server about to stop). */
export const flushChatLog = (): Promise<number> => chatLog.flush();
