import { ChatControlType } from "../enums/Chat.js";
import type { ChatControlMessage } from "./chatControl.js";
import { send, ServerMessageType } from "./chatProtocol.js";
import { clients } from "./chatState.js";

/**
 * New mail (`services/mail/mailNudge.ts`): the player's open chat connection,
 * if this gateway holds one, is told so, and the game asks the mail routes
 * what came. A player with no connection here is not found, and their game's
 * own slow check (or the next save) brings it instead.
 *
 * @returns {boolean} Whether the message was a mail nudge.
 */
export const applyMailNudge = (message: ChatControlMessage): boolean => {
  if (message.type !== ChatControlType.Mail) return false;
  const client = clients.get(message.userId);
  if (client) send(client.ws, { type: ServerMessageType.Mail });
  return true;
};
