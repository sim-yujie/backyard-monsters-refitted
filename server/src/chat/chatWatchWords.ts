import { postgres } from "../server.js";
import { compileWatchList, DEFAULT_WATCH_WORDS, type WatchList } from "../services/chat/chatFilter.js";
import { readWatchWords } from "../services/chat/watchWords.js";
import { logger } from "../utils/logger.js";

/**
 * The chat server's copy of the filter's watched words (owner, 24 Nov 2026:
 * "applies within a minute, no restart"). Read when the gateway starts, when
 * the dashboard changes the list (`ChatControlType.WatchWords`) and every
 * minute, like the moderators list (`chatModerators.ts`). Until the first
 * read, and whenever a read fails, the last list stays; at start that is the
 * owner's own list ({@link DEFAULT_WATCH_WORDS}).
 */

export const WATCH_WORDS_REFRESH_MS = 60_000;

let watchList: WatchList = compileWatchList(DEFAULT_WATCH_WORDS);

/** The list the next line is checked against. */
export const currentWatchList = (): WatchList => watchList;

/** Replaces the copy (tests). */
export const setWatchList = (list: WatchList): void => {
  watchList = list;
};

export const refreshWatchWords = async (): Promise<void> => {
  try {
    watchList = compileWatchList(await readWatchWords(postgres.orm.em.fork()));
  } catch (err) {
    logger.warn(`Chat: could not read the watched words: ${err}`);
  }
};
