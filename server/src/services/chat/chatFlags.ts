import type { EntityManager } from "@mikro-orm/postgresql";
import type { Filter } from "bad-words";

import { NOT_FLAGGED_WORDS, SLUR_WORDS } from "./badWords.js";

/**
 * Automatic chat flags (owner, 4 Nov 2026): a chat line the word filter
 * catches is stored in `bym.chat_flag` with the player's own words, so the
 * owner sees it on the dashboard and decides whether to warn, pause or ban.
 * Nothing here acts on the player. Players still see the masked line.
 *
 * A line flags when the filter masks a word in it, except words that are also
 * ordinary English ({@link NOT_FLAGGED_WORDS}); a line with a word from
 * {@link SLUR_WORDS} is a `slur`, anything else a `swear`. Writes are
 * limited per player ({@link FlagLimiter}): one flag per line at most, and
 * no more than {@link FLAGS_PER_WINDOW} in {@link FLAG_WINDOW_MS}. The chat
 * log (`chatLog.ts`) still keeps every line, flagged or not.
 */

export type FlagSeverity = "slur" | "swear";

export interface LineCheck {
  /** The line as players see it (the filter's masked copy). */
  shown: string;
  /** The words that raise a flag, lower case, each once. */
  words: string[];
  /** Null: no flag. */
  severity: FlagSeverity | null;
}

const slurs: ReadonlySet<string> = new Set(SLUR_WORDS);
const notFlagged: ReadonlySet<string> = new Set(NOT_FLAGGED_WORDS);

/** The filter splits a line into words this way (`bad-words` `splitRegex`). */
const WORD_SPLIT = /\b|_/;

/**
 * Masks a line the way chat always has, and says whether it raises a flag.
 * The words are only looked for when the filter changed the line, so a clean
 * line costs no more than before.
 *
 * @param {Filter} filter - The game's word filter (`makeWordFilter`).
 * @param {string} text - The player's line, already cut to length and trimmed.
 * @returns {LineCheck} What players see, and the flag, if any.
 */
export const checkLine = (filter: Filter, text: string): LineCheck => {
  const shown = filter.clean(text);
  if (shown === text) return { shown, words: [], severity: null };

  const hits = new Set<string>();
  for (const token of text.split(WORD_SPLIT)) {
    if (!/\w/.test(token)) continue;
    if (filter.isProfane(token)) hits.add(token.toLowerCase());
  }
  const words = [...hits].filter((word) => !notFlagged.has(word));
  if (words.length === 0) return { shown, words, severity: null };
  return { shown, words, severity: words.some((word) => slurs.has(word)) ? "slur" : "swear" };
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
    `INSERT INTO bym.chat_flag (userid, channel, message, shown, words, severity, message_ts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      flag.userid,
      flag.channel,
      flag.message,
      flag.shown,
      flag.words.join(","),
      flag.severity,
      flag.ts,
      new Date(flag.ts),
    ],
  );
};
