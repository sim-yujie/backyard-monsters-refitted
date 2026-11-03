import type { EntityManager } from "@mikro-orm/postgresql";
import { COUNTRY_CHANNEL_PREFIX } from "../../config/ChatConfig.js";
import { ChannelType } from "../../enums/Chat.js";
import { NOT_FLAGGED_WORDS, SLUR_WORDS, type WordFilter } from "./badWords.js";
import { listedWord } from "./wordMatch.js";

/**
 * Automatic chat flags (owner, 4 Nov 2026): a chat line the word filter
 * catches is stored in `bym.chat_flag` with the player's own words, so the
 * owner sees it on the dashboard and decides whether to warn, pause or ban.
 * Nothing here acts on the player. Players still see the masked line.
 *
 * A line flags when the filter masks a word in it, except words that are also
 * ordinary English ({@link NOT_FLAGGED_WORDS}); a line with a word from
 * {@link SLUR_WORDS} is a `slur`, anything else a `swear`. Its `rule` says
 * whether a flagging word was typed as such (`word`) or disguised (leetspeak,
 * stretched or split letters, look-alike letters: `disguised`). Writes are
 * limited per player ({@link FlagLimiter}): one flag per line at most, and
 * no more than {@link FLAGS_PER_WINDOW} in {@link FLAG_WINDOW_MS}. The chat
 * log (`chatLog.ts`) still keeps every line, flagged or not.
 */

export type FlagSeverity = "slur" | "swear";

/** How a flagging word was written: as listed, or disguised. */
export type FlagRule = "word" | "disguised";

export interface LineCheck {
  /** The line as players see it (the filter's masked copy). */
  shown: string;
  /** The words that raise a flag, lower case, each once. */
  words: string[];
  /** Null: no flag. */
  severity: FlagSeverity | null;
  /** Null: no flag. */
  rule: FlagRule | null;
}

/** Words as the filter reports them: "n1gga" is caught as "nigga". */
const asCaught = (words: readonly string[]): ReadonlySet<string> =>
  new Set(words.flatMap((word) => [word, listedWord(word) ?? word]));

const slurs = asCaught(SLUR_WORDS);
const notFlagged = asCaught(NOT_FLAGGED_WORDS);

/**
 * Masks a line the way players see it, and says whether it raises a flag.
 *
 * @param {WordFilter} filter - The game's word filter (`makeWordFilter`).
 * @param {string} text - The player's line, already cut to length and trimmed.
 * @returns {LineCheck} What players see, and the flag, if any.
 */
export const checkLine = (filter: WordFilter, text: string): LineCheck => {
  const { shown, hits } = filter.scan(text);
  const flagging = hits.filter((hit) => !notFlagged.has(hit.word));
  const words = [...new Set(flagging.map((hit) => hit.word))];
  if (words.length === 0) return { shown, words, severity: null, rule: null };
  return {
    shown,
    words,
    severity: words.some((word) => slurs.has(word)) ? "slur" : "swear",
    rule: flagging.some((hit) => hit.disguised) ? "disguised" : "word",
  };
};

/**
 * The rooms whose lines can raise a flag (owner, 4 Nov 2026: "i mainly want
 * to monitor the global chat, and tagalog chat"): `global` for every World
 * room, and two-letter country codes for country rooms (`PH`: the
 * Philippines room, `chat:country:PH`). Alliance chat is private and never
 * flags. Masking is the same in every room.
 */
export const DEFAULT_CHAT_FLAG_ROOMS = "global,PH";

/**
 * The monitored rooms from `CHAT_FLAG_ROOMS` (comma separated, read when the
 * chat server starts; default {@link DEFAULT_CHAT_FLAG_ROOMS}). Set it empty
 * to stop all flags.
 *
 * @param {Record<string, string | undefined>} env - Where to read it from.
 * @returns {ReadonlySet<string>} `global` and upper-case country codes.
 */
export const chatFlagRooms = (env: Record<string, string | undefined> = process.env): ReadonlySet<string> =>
  new Set(
    (env.CHAT_FLAG_ROOMS ?? DEFAULT_CHAT_FLAG_ROOMS)
      .split(",")
      .map((room) => room.trim())
      .filter((room) => room.length > 0)
      .map((room) => (room.toLowerCase() === "global" ? "global" : room.toUpperCase())),
  );

/**
 * Whether lines in a room can raise a flag.
 *
 * @param {ReadonlySet<string>} rooms - From {@link chatFlagRooms}.
 * @param {ChannelType} channelType - The room's kind.
 * @param {string} channel - The room's key, e.g. `chat:mr2-global` or `chat:country:PH`.
 * @returns {boolean} True for a monitored World or country room; never for alliance chat.
 */
export const isFlaggedRoom = (rooms: ReadonlySet<string>, channelType: ChannelType, channel: string): boolean => {
  if (channelType === ChannelType.Global) return rooms.has("global");
  if (channelType === ChannelType.Country && channel.startsWith(COUNTRY_CHANNEL_PREFIX)) {
    return rooms.has(channel.slice(COUNTRY_CHANNEL_PREFIX.length).toUpperCase());
  }
  return false;
};

/** The window the per-player flag limit counts over. */
export const FLAG_WINDOW_MS = 10 * 60 * 1000;

/** Flags stored per player in {@link FLAG_WINDOW_MS}; more lines still go in the chat log. */
export const FLAGS_PER_WINDOW = 5;

/**
 * Counts each player's stored flags over the last {@link FLAG_WINDOW_MS}, so
 * one player swearing over and over does not fill the table. Per chat server
 * process; forgets players whose window has emptied.
 */
export class FlagLimiter {
  private readonly recent = new Map<number, number[]>();

  constructor(
    private readonly windowMs: number = FLAG_WINDOW_MS,
    private readonly max: number = FLAGS_PER_WINDOW,
  ) {}

  /** True (and counted) when a flag for `userid` may be stored at `now`. */
  take(userid: number, now: number): boolean {
    const since = now - this.windowMs;
    const times = (this.recent.get(userid) ?? []).filter((t) => t > since);
    if (times.length >= this.max) {
      this.recent.set(userid, times);
      return false;
    }
    times.push(now);
    this.recent.set(userid, times);
    if (this.recent.size > 1000) this.forgetIdle(since);
    return true;
  }

  private forgetIdle(since: number): void {
    for (const [userid, times] of this.recent) if (!times.some((t) => t > since)) this.recent.delete(userid);
  }
}

export interface ChatFlagInput {
  userid: number;
  channel: string;
  /** The player's own words. */
  message: string;
  /** What other players saw. */
  shown: string;
  words: readonly string[];
  severity: FlagSeverity;
  rule: FlagRule;
  /** When the line was said (ms), as chat stamps it. */
  ts: number;
}

/**
 * Stores one flag.
 *
 * @param {EntityManager} em - Any entity manager; the insert is raw SQL and flushes nothing.
 * @param {ChatFlagInput} flag - The line and what it hit.
 */
export const recordChatFlag = async (em: EntityManager, flag: ChatFlagInput): Promise<void> => {
  await em.execute(
    `INSERT INTO bym.chat_flag (userid, channel, message, shown, words, severity, rule, message_ts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      flag.userid,
      flag.channel,
      flag.message,
      flag.shown,
      flag.words.join(","),
      flag.severity,
      flag.rule,
      flag.ts,
      new Date(flag.ts),
    ],
  );
};
