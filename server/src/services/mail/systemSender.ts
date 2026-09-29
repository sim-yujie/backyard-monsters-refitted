/**
 * The game's own place in the mailbox (#187): messages the server writes
 * itself, such as the outpost notices, come from `userid` 0, which no player
 * has. There is no user row behind it, so the mail routes name it here, and
 * nobody can reply to it or block it.
 */
export const SYSTEM_SENDER = 0;

/** The name the mailbox shows for the game's own messages. */
export const SYSTEM_SENDER_NAME = "Backyard Monsters";
