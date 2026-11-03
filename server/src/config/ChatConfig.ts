import { MapRoomVersion } from "../enums/MapRoom.js";
import { isCountryCode } from "./Countries.js";

export const INFERNO_CHAT_CHANNEL = "chat:inferno-global";

export const ALLIANCE_CHANNEL_ALIAS = "alliance";

export const ALLIANCE_CHANNEL_PREFIX = "chat:alliance:";

/** Country rooms' keys: `chat:country:PH`. */
export const COUNTRY_CHANNEL_PREFIX = "chat:country:";

export const CHANNELS: Record<number, string> = {
  [MapRoomVersion.V1]: "chat:mr1-global",
  [MapRoomVersion.V2]: "chat:mr2-global",
  [MapRoomVersion.V3]: "chat:mr3-global",
};

/** The countries with a room when `CHAT_COUNTRY_ROOMS` is not set (owner 3 Nov 2026). */
export const DEFAULT_COUNTRY_ROOMS = "PH";

/**
 * The countries that have their own chat room, from `CHAT_COUNTRY_ROOMS`: ISO
 * 3166-1 alpha-2 codes, comma separated (`PH,ID,BR`). Unset means
 * {@link DEFAULT_COUNTRY_ROOMS}; set but empty means no country rooms. Codes
 * that are not countries are dropped. Read on each use, so the owner adds a
 * room by changing the setting and restarting, and tests can change it.
 *
 * @param {Record<string, string | undefined>} env - Where to read it from.
 * @returns {ReadonlySet<string>} The upper-case codes with a room.
 */
export const countryRooms = (env: Record<string, string | undefined> = process.env): ReadonlySet<string> => {
  const raw = env.CHAT_COUNTRY_ROOMS ?? DEFAULT_COUNTRY_ROOMS;

  return new Set(
    raw
      .split(",")
      .map((code) => code.trim().toUpperCase())
      .filter((code) => isCountryCode(code)),
  );
};

/**
 * The room a player from `country` chats in besides Global, or null when that
 * country has no room (or the player has not set one).
 *
 * @param {string | null | undefined} country - The player's stored country code.
 * @returns {string | null} The channel key, e.g. `chat:country:PH`.
 */
export const countryChannelFor = (country: string | null | undefined): string | null => {
  if (!country) return null;

  return countryRooms().has(country) ? `${COUNTRY_CHANNEL_PREFIX}${country}` : null;
};
