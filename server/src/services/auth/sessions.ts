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
