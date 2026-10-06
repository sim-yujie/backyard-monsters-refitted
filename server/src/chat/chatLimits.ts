import { CHAT_SOCKET_LIMITS, SPAM_LIMITS } from "../config/SpamLimitConfig.js";
import type { SocketData } from "./chatState.js";

type ServerWebSocket<T> = import("bun").ServerWebSocket<T>;

/** Close codes: 1008 policy violation (no login in time), 1009 message too big. */
export const CLOSE_POLICY_VIOLATION = 1008;
export const CLOSE_TOO_LARGE = 1009;

/**
 * How many bytes a message arrived as. Bun hands text frames over as strings,
 * so a string is measured as UTF-8, the way it came over the wire.
 *
 * @param {string | Buffer} data - The raw message.
 * @returns {number} Its size in bytes.
 */
const messageBytes = (data: string | Buffer): number =>
  typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;

/**
 * Closes a connection that has not logged in and sent more than a login needs
 * (issue #323). Bun's own `maxPayloadLength` covers a logged-in connection.
 *
 * @param {ServerWebSocket<SocketData>} ws - The connection the message came on.
 * @param {string | Buffer} data - The raw message.
 * @returns {boolean} True when the connection was closed and the message must be dropped.
 */
export const closeIfTooLargeBeforeLogin = (ws: ServerWebSocket<SocketData>, data: string | Buffer): boolean => {
  if (ws.data.userId !== null) return false;
  if (messageBytes(data) <= CHAT_SOCKET_LIMITS.maxUnauthenticatedBytes) return false;

  ws.close(CLOSE_TOO_LARGE, "Message too large");
  return true;
};

/**
 * Closes the connection if it has not logged in within the deadline (issue #323).
 * The timer is kept on the socket so closing it early can cancel it.
 *
 * @param {ServerWebSocket<SocketData>} ws - The newly opened connection.
 * @param {number} ms - How long it has, the configured deadline unless a test says otherwise.
 */
export const armLoginDeadline = (ws: ServerWebSocket<SocketData>, ms: number = CHAT_SOCKET_LIMITS.authDeadlineMs) => {
  ws.data.loginDeadline = setTimeout(() => {
    ws.data.loginDeadline = null;
    if (ws.data.userId === null) ws.close(CLOSE_POLICY_VIOLATION, "Login timed out");
  }, ms);
};

/**
 * Cancels a connection's login deadline, once it logs in or closes.
 *
 * @param {ServerWebSocket<SocketData>} ws - The connection.
 */
export const clearLoginDeadline = (ws: ServerWebSocket<SocketData>) => {
  if (ws.data.loginDeadline) clearTimeout(ws.data.loginDeadline);
  ws.data.loginDeadline = null;
};

/**
 * Alliance chat lines said per player in the current window. Kept by player
 * rather than on the connection so reconnecting does not start a new count.
 */
const allianceLines = new Map<number, { count: number; resetAt: number }>();

/**
 * Counts one alliance chat line against the player's hourly limit (issue #323)
 * and says whether it may go out. Expired windows are swept as they are met.
 *
 * @param {number} userId - The player saying the line.
 * @param {number} now - The current time in ms.
 * @returns {boolean} False when the player is over the limit.
 */
export const takeAllianceLine = (userId: number, now: number = Date.now()): boolean => {
  const { max, minutes } = SPAM_LIMITS.allianceChat;

  let window = allianceLines.get(userId);

  if (!window || window.resetAt <= now) {
    for (const [id, other] of allianceLines) if (other.resetAt <= now) allianceLines.delete(id);

    window = { count: 0, resetAt: now + minutes * 60_000 };
    allianceLines.set(userId, window);
  }

  if (window.count >= max) return false;

  window.count += 1;
  return true;
};
