import { MapRoomVersion } from "../enums/MapRoom.js";
import { isCountryCode } from "./Countries.js";

export const INFERNO_CHAT_CHANNEL = "chat:inferno-global";

export const ALLIANCE_CHANNEL_ALIAS = "alliance";

export const ALLIANCE_CHANNEL_PREFIX = "chat:alliance:";

/** Country rooms' keys: `chat:country:PH`. */
export const COUNTRY_CHANNEL_PREFIX = "chat:country:";

/**
 * The one global room Map Room 1 and Map Room 2 players share (owner, 7 Nov
 * 2026, patch 6.6: "merge map room 1 and map room 2 chat ... its global
 * afterall"). It keeps the Map Room 2 key, so that room's history stays.
 */
export const GLOBAL_CHAT_CHANNEL = "chat:mr2-global";

/**
 * Map Room 1's own room before patch 6.6. A page loaded before the patch
 * still echoes it on join; it is read as {@link GLOBAL_CHAT_CHANNEL}. Its old
 * history stays in Redis for the dashboard.
 */
export const LEGACY_MR1_CHAT_CHANNEL = "chat:mr1-global";

export const CHANNELS: Record<number, string> = {
  [MapRoomVersion.V1]: GLOBAL_CHAT_CHANNEL,
  [MapRoomVersion.V2]: GLOBAL_CHAT_CHANNEL,
  [MapRoomVersion.V3]: "chat:mr3-global",
};

/**
 * The room a player from `country` chats in besides Global, or null when the
 * player has not set a country. Every country has a room (owner 3 Nov 2026:
 * "it has to be for all countries that have at least 1 player from there"),
 * so a room exists as soon as one player picks that country; there is no list
 * to keep. Rooms cost nothing until used: the Redis subscription opens with the
 * first player online in it, and its history (100 lines, 30 days) only after
 * the first line is sent.
 *
 * @param {string | null | undefined} country - The player's stored country code.
 * @returns {string | null} The channel key, e.g. `chat:country:PH`.
 */
export const countryChannelFor = (country: string | null | undefined): string | null => {
  if (!country || !isCountryCode(country)) return null;

  return `${COUNTRY_CHANNEL_PREFIX}${country}`;
};
