import { logger } from "../../utils/logger.js";

/**
 * Live mail (owner, beta 7: "new inbox message should give a notification in
 * game rather than wait for refresh"). Whatever leaves a player a message
 * (a player's mail, a truce, the game team, the game's own notices) calls
 * {@link nudgeMail}; the server sends it over the chat control channel to the
 * chat gateway, which tells the player's game, if it is connected, to ask
 * `/player/mailstatus` what came. A game without a chat connection checks on
 * its own every so often.
 *
 * The publisher is set once at start-up (`server.ts`); until then, and in
 * tests, a nudge does nothing. A nudge never throws: the message is already
 * saved, and the game finds it at the next check or save anyway.
 */

type Publisher = (userId: number) => Promise<void>;

let publisher: Publisher | null = null;

/** Sets how a nudge goes out (the chat control channel); null switches nudges off. */
export const setMailNudge = (next: Publisher | null): void => {
  publisher = next;
};

/** Tells `userId`'s game it has new mail. Players only: the game's own senders (0, -1) have no game. */
export const nudgeMail = (userId: number): void => {
  if (!publisher || !Number.isInteger(userId) || userId <= 0) return;
  try {
    void publisher(userId).catch((err) => logger.warn(`Mail: nudge for user ${userId} failed: ${err}`));
  } catch (err) {
    logger.warn(`Mail: nudge for user ${userId} failed: ${err}`);
  }
};
