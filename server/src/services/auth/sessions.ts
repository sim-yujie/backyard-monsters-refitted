import { redis } from "../../server.js";
import { SessionType } from "../../enums/SessionType.js";
import { chatTokenKey } from "../../chat/chatChannels.js";

/**
 * The Redis key holding an account's current login token for one session
 * type. A token is accepted only while it is the one stored here.
 *
 * @param {SessionType} sessionType - The game or the launcher.
 * @param {string} email - The account's email.
 * @returns {string} The Redis key.
 */
export const sessionTokenKey = (sessionType: SessionType, email: string) => `user-token:${sessionType}:${email}`;

/**
 * Logs an account out everywhere (issue #318): drops its stored login token
 * for every session type, so every token issued before stops working, and
 * its chat token, so chat asks for a fresh one. Called when the password
 * changes, so a stolen session does not outlive the old password.
 *
 * A chat connection already open stays open until it disconnects.
 *
 * @param {{ email: string; userid: number }} user - The account.
 * @returns {Promise<void>} Resolves once the tokens are gone.
 */
export const endAllSessions = async (user: { email: string; userid: number }): Promise<void> => {
  await redis.del(
    ...Object.values(SessionType).map((sessionType) => sessionTokenKey(sessionType, user.email)),
    chatTokenKey(user.userid)
  );
};

/**
 * Logs one session out (security audit 2026-10-29, L4): drops the account's
 * stored login token for that session type, so the token stops working at
 * once rather than when it expires, and its chat token.
 *
 * Only one token per session type is stored, so this is the one signed in.
 * The other session type (the launcher or the game) stays signed in.
 *
 * @param {SessionType} sessionType - The session being signed out.
 * @param {{ email: string; userid: number }} user - The account.
 * @returns {Promise<void>} Resolves once the tokens are gone.
 */
export const endSession = async (sessionType: SessionType, user: { email: string; userid: number }): Promise<void> => {
  await redis.del(sessionTokenKey(sessionType, user.email), chatTokenKey(user.userid));
};
