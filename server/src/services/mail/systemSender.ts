/**
 * The game's own place in the mailbox (#187): messages the server writes
 * itself, such as the outpost notices, come from `userid` 0, which no player
 * has. There is no user row behind it, so the mail routes name it here, and
 * nobody can reply to it or block it.
 */
export const SYSTEM_SENDER = 0;

/** The name the mailbox shows for the game's own messages. */
export const SYSTEM_SENDER_NAME = "Backyard Monsters";

/**
 * The owner's place in the mailbox (dashboard support tools): replies to a
 * bug report and Shiny gifts come from `userid` -1, "The game team", so the
 * owner's own account is never shown. Like the game's notices it has no user
 * row and cannot be blocked; unlike them, a player can answer it in a thread
 * that belongs to one of their bug reports (`services/admin/supportMail.ts`).
 */
export const SUPPORT_SENDER = -1;

/** The name the mailbox shows for the owner's messages. */
export const SUPPORT_SENDER_NAME = "The game team";

/** The mail senders that are not players: no user row, never blocked. */
export const isServerSender = (userid: number): boolean => userid === SYSTEM_SENDER || userid === SUPPORT_SENDER;
