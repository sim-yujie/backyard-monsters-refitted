import { ChatControlType } from "../enums/Chat.js";
import { redis } from "../server.js";
import { logger } from "../utils/logger.js";

export const CHAT_CONTROL_CHANNEL = "chat:control";

export type ChatControlMessage =
  | { type: ChatControlType.AllianceEvict; userId: number }
  | {
      type: ChatControlType.CountryEvict;
      userId: number;
      /** The room the player's new country gives them, left alone; null leaves every country room. */
      keep: string | null;
    }
  | {
      type: ChatControlType.Kick;
      userId: number;
      /** When the ban ends (ms), null for good. */
      until: number | null;
      /** What the player is told. */
      text: string;
    }
  | { type: ChatControlType.Notice; userId: number }
  | {
      type: ChatControlType.Mute;
      userId: number;
      /** No lines before this (ms); 0 lifts the mute. */
      until: number;
    };

/**
 * Forces a player out of their alliance chat channel.
 *
 * Membership is written by the API process while the channel roster lives in the
 * chat process, so a player kicked or removed mid-session would otherwise keep
 * reading their old alliance's messages until they happened to disconnect.
 *
 * @param {number} userId - The player to evict.
 */
export const disconnectAllianceChat = async (userId: number) => {
  const message: ChatControlMessage = { type: ChatControlType.AllianceEvict, userId };

  await redis
    .publish(CHAT_CONTROL_CHANNEL, JSON.stringify(message))
    .catch((err) => logger.error(`Chat control publish failed for user ${userId}: ${err}`));
};

/**
 * Takes a player out of their country chat room after their country changed.
 *
 * The country is written by the API process (`/player/settings`) while the
 * room roster lives in the chat process, as with alliances. The client joins
 * its new room (if the new country has one) on its own afterwards; that room
 * is named in `keep`, so a join that overtakes this message is not undone.
 *
 * @param {number} userId - The player whose country changed.
 * @param {string | null} keep - The room of the player's new country, if it has one.
 */
export const disconnectCountryChat = async (userId: number, keep: string | null) => {
  const message: ChatControlMessage = { type: ChatControlType.CountryEvict, userId, keep };

  await redis
    .publish(CHAT_CONTROL_CHANNEL, JSON.stringify(message))
    .catch((err) => logger.error(`Chat control publish failed for user ${userId}: ${err}`));
};

/**
 * Tells the chat gateway about a moderation step from the dashboard
 * (`services/admin/moderation.ts`): a ban closes the player's chat connection
 * with the reason, a mute is applied to the open connection at once, and a
 * warning or mute nudges their game to show its pop-up. A player with no
 * open connection is simply not found by the gateway.
 *
 * @param {ChatControlMessage} message - A Kick, Notice or Mute.
 */
export const publishModeration = async (message: ChatControlMessage) => {
  await redis
    .publish(CHAT_CONTROL_CHANNEL, JSON.stringify(message))
    .catch((err) => logger.error(`Chat control publish failed for user ${message.userId}: ${err}`));
};
