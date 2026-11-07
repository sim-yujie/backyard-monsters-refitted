import { isAdminUser } from "../config/AdminConfig.js";
import { postgres } from "../server.js";
import { readModeratorIds } from "../services/admin/chatModerators.js";
import { logger } from "../utils/logger.js";

/**
 * The chat moderators' mark (owner, 7 Nov 2026): a line by an account on the
 * dashboard's Moderators list carries `mod`, and the game's chat box shows a
 * blue [Mod] badge. Like the game team's `gm` (`chatGameTeam.ts`) it is
 * decided here from the account number, on every line and every history
 * read, so no client can claim it and a moderator taken off the list loses
 * it on their old lines too. A game team account shows GM only.
 *
 * The list lives in Postgres (`services/admin/chatModerators.ts`); this
 * process keeps a copy, read when the gateway starts, when the dashboard
 * changes it (`ChatControlType.Moderators`) and every minute.
 */

/** How often the copy is read again, in case a change message was lost. */
export const MODERATORS_REFRESH_MS = 60_000;

let moderatorIds: ReadonlySet<number> = new Set();

/** Replaces the copy of the list. */
export const setChatModerators = (ids: Iterable<number>): void => {
  moderatorIds = new Set(ids);
};

/** Whether `userid`'s lines carry the moderators' mark: on the list, and not a game team account. */
export const isChatModerator = (userid: unknown): boolean =>
  typeof userid === "number" && moderatorIds.has(userid) && !isAdminUser(userid);

/**
 * Reads the list again from Postgres. A failed read (the table not there yet,
 * the database away) keeps the copy as it was.
 */
export const refreshChatModerators = async (): Promise<void> => {
  try {
    setChatModerators(await readModeratorIds(postgres.orm.em.fork()));
  } catch (err) {
    logger.warn(`Chat: could not read the moderators list: ${err}`);
  }
};
