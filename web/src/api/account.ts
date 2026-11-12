import { avatarPath, type AvatarId } from "@/game/avatars";
import { setSessionPicSquare, setSessionUsername } from "./auth";
import { get, post, postJson } from "./http";
import { countryOf, type CountrySettings } from "./country";
import { privacyOf, type PrivacySettings } from "./privacy";
import { notificationsOffOf, type NotificationCategoryId } from "./notificationSettings";
import { hexShapeOf, type HexShape } from "@/game/maproom/rules/range";
import type { AccountResponse, ChangeUsernameResponse, SetAvatarResponse, SettingsResponse } from "./types";

/**
 * `POST /api/:apiVersion/player/avatar` (issue #175): stores the picked critter
 * as `pic_square`. The server takes only the twelve paths in its allow-list
 * and refuses anything else with `reason: "unknownAvatar"`.
 */
const AVATAR_PATH = "/api/:apiVersion/player/avatar";

/** Stores the avatar and records it on the session; resolves with the stored path. */
export const setAvatar = async (id: AvatarId): Promise<string> => {
  const response = await post<SetAvatarResponse>(AVATAR_PATH, { avatar: avatarPath(id) });
  setSessionPicSquare(response.pic_square);
  return response.pic_square;
};

/** `GET /api/:apiVersion/player/account`: who is signed in and what they may change. */
const ACCOUNT_PATH = "/api/:apiVersion/player/account";
/** `POST /api/:apiVersion/player/changeusername`: 5 an hour, then a long cooldown per name. */
const CHANGE_USERNAME_PATH = "/api/:apiVersion/player/changeusername";
/** `POST /api/:apiVersion/player/settings`: the whole settings block, echoed back; JSON, because its schema wants a real boolean. */
const SETTINGS_PATH = "/api/:apiVersion/player/settings";

export interface AccountInfo {
  readonly username: string;
  readonly canChangeUsername: boolean;
  /** When the next rename is allowed; null when one is allowed now. */
  readonly nextChangeAt: string | null;
  /** Shiny Lock: while on, the server refuses every Shiny spend. */
  readonly shinyLocked: boolean;
  /** The privacy switches (friends WP9). */
  readonly privacy: PrivacySettings;
  /** The player's country and the chat room it opens (owner 3 Nov 2026). */
  readonly country: CountrySettings;
  /** The bell's notification categories turned off; none by default (owner 11 Nov 2026). */
  readonly notificationsOff: readonly NotificationCategoryId[];
}

export const fetchAccount = async (): Promise<AccountInfo> => {
  const response = await get<AccountResponse>(ACCOUNT_PATH);
  return {
    username: response.username,
    canChangeUsername: response.canChangeUsername,
    nextChangeAt: response.nextChangeAt,
    shinyLocked: response.settings?.shinyLocked === true,
    privacy: privacyOf(response.settings),
    country: countryOf(response.settings),
    notificationsOff: notificationsOffOf(response.settings),
  };
};

/** Renames the account and the session; resolves with when the next rename is allowed. */
export const changeUsername = async (username: string): Promise<{ username: string; nextChangeAt: string }> => {
  const response = await post<ChangeUsernameResponse>(CHANGE_USERNAME_PATH, { username });
  setSessionUsername(response.username);
  return { username: response.username, nextChangeAt: response.nextChangeAt };
};

/** Turns Shiny Lock on or off; resolves with the stored state. */
export const setShinyLocked = async (shinyLocked: boolean): Promise<boolean> => {
  const response = await postJson<SettingsResponse>(SETTINGS_PATH, { shinyLocked });
  return response.settings.shinyLocked;
};

/**
 * Map Room 2's tilted camera (MR2 look plan step 4) as the account has it:
 * whether the server's MR2_TILT switch lets the map tilt at all, and the
 * player's own choice, tilted unless they switched the map flat.
 */
export interface MapTiltSettings {
  readonly allowed: boolean;
  readonly tilted: boolean;
}

export const mapTiltOf = (settings: AccountResponse["settings"]): MapTiltSettings => ({
  allowed: settings?.mapTiltAllowed === true,
  tilted: settings?.tiltedMap !== false,
});

/** Reads the tilt switch and the player's choice from `GET /player/account`. */
export const fetchMapTilt = async (): Promise<MapTiltSettings> =>
  mapTiltOf((await get<AccountResponse>(ACCOUNT_PATH)).settings);

/**
 * Map Room 2's hex shape (MR2 look plan step 1: the server's MR2_HEX_SHAPE
 * switch, flat-top unless it says pointy) and its tilt, both of the map's
 * account answers from ONE `GET /player/account` (the map
 * used to ask twice on its first open: once for the shape, once for the tilt).
 */
export const fetchMapSettings = async (): Promise<{ hexShape: HexShape; tilt: MapTiltSettings }> => {
  const settings = (await get<AccountResponse>(ACCOUNT_PATH)).settings;
  return { hexShape: hexShapeOf(settings?.mapHexShape), tilt: mapTiltOf(settings) };
};

/** Stores the player's choice on the account; resolves with what the server now has. */
export const setTiltedMap = async (tilted: boolean): Promise<MapTiltSettings> =>
  mapTiltOf((await postJson<SettingsResponse>(SETTINGS_PATH, { tiltedMap: tilted })).settings);
