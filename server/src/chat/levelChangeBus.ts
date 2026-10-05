/**
 * Tells the chat subsystem a player's level may have changed, without the
 * yard code that knows about levels (`controllers/yard/yardAction.ts`,
 * `controllers/yardplanner/plannerYard.ts`) importing anything chat-related
 * (issue #232).
 *
 * A plain function import would do if chat were a leaf module, but
 * `chatIdentity.ts` reaches `server.js` for its database access, and
 * `server.js` imports the whole route tree — the yard code included — before
 * its own exports exist. Importing it from a yard module, even dynamically,
 * would make every yard unit test boot the real server (`docs/design` has no
 * precedent for that; `services/bots/isBot.ts` sidesteps the same problem by
 * taking an `em` instead). This module has no imports of its own, so nothing
 * reaches back to the yard code through it, and emitting is a true no-op
 * until the chat subsystem is actually loaded and listening.
 *
 * `chatIdentity.ts` registers the one real listener at import time, which
 * happens as a side effect of `server.ts` loading the chat subsystem
 * (`server.ts` -> `chatServer.ts` -> `chatGateway.ts` -> `chatIdentity.ts`)
 * before any request is served. A test that never touches chat leaves this
 * listener unset, so `emitLevelChange` does nothing.
 */
type LevelChangeListener = (userId: number, username: string, level: number) => void;

let listener: LevelChangeListener | null = null;

/**
 * Registers the function that actually pushes a chat display name update.
 * Replaces any previous listener; the bus only ever needs one.
 *
 * @param {LevelChangeListener} fn - Called with the player's id, username and current level.
 */
export const onLevelChange = (fn: LevelChangeListener): void => {
  listener = fn;
};

/**
 * Reports a player's current level after something that could have changed
 * it. A no-op until {@link onLevelChange} has registered a listener.
 *
 * @param {number} userId - The player whose level may have changed.
 * @param {string} username - Their username, as stored.
 * @param {number} level - Their current level, e.g. from `playerLevelOf`.
 */
export const emitLevelChange: LevelChangeListener = (userId, username, level) => {
  listener?.(userId, username, level);
};
