import { ChatControlType } from "../enums/Chat.js";
import { logger } from "../utils/logger.js";
import type { ChatControlMessage } from "./chatControl.js";
import { send, ServerMessageType } from "./chatProtocol.js";
import { leaveAllChannels } from "./chatRooms.js";
import { clients } from "./chatState.js";

/**
 * Applies a moderation control message to the player's open connection, if
 * this gateway holds one. Other control messages are not handled here.
 *
 * @returns {boolean} Whether the message was a moderation one.
 */
export const applyModeration = (message: ChatControlMessage): boolean => {
  if (
    message.type !== ChatControlType.Kick &&
    message.type !== ChatControlType.Notice &&
    message.type !== ChatControlType.Mute
  ) {
    return false;
  }

  const client = clients.get(message.userId);
  if (!client) return true;

  switch (message.type) {
    case ChatControlType.Kick:
      send(client.ws, { type: ServerMessageType.Kicked, reason: "banned", until: message.until, text: message.text });
      leaveAllChannels(client);
      clients.delete(client.userId);
      client.ws.close();
      logger.info(`Chat: closed banned user ${client.userId}`);
      return true;
    case ChatControlType.Mute:
      client.mutedUntil = message.until;
      return true;
    case ChatControlType.Notice:
      send(client.ws, { type: ServerMessageType.Notice });
      return true;
  }
};
