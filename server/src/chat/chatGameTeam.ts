import { isAdminUser } from "../config/AdminConfig.js";
import { ErrorCode, send, ServerMessageType, type HistoryEntry } from "./chatProtocol.js";
import type { ChatClient } from "./chatState.js";

/**
 * The game team's side of chat (dashboard moderation, `services/admin/moderation.ts`).
 *
 * - The mark: a line by an `ADMIN_USER_IDS` account carries `gm`, and the
 *   game's chat box shows it as the game team's. The mark is decided here
 *   from the account number alone, on every line and every history read,
 *   so no client can claim it and an account taken off the list loses it.
 * - A mute: lines from a muted player are refused until `mutedUntil`.
 * - A ban: the player's open connection is told why and closed.
 */


/** Whether the client may not chat now; answers them with when it ends. */
export const refuseIfMuted = (client: ChatClient, now: number): boolean => {
  const until = client.mutedUntil ?? 0;
  if (until <= now) return false;
  send(client.ws, { type: ServerMessageType.Error, code: ErrorCode.Muted, until });
  return true;
};

/** The entries with the game team's mark on exactly the lines by `ADMIN_USER_IDS` accounts. */
export const markGameTeam = (entries: readonly HistoryEntry[]): HistoryEntry[] =>
  entries.map((entry) => {
    const { gm: _claimed, ...rest } = entry;
    return isAdminUser(entry.userId) ? { ...rest, gm: true } : rest;
  });
