import { avatarPath, type AvatarId } from "@/game/avatars";
import { setSessionPicSquare, setSessionUsername } from "./auth";
import { get, post, postJson } from "./http";
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
}

export const fetchAccount = async (): Promise<AccountInfo> => {
  const response = await get<AccountResponse>(ACCOUNT_PATH);
  return {
    username: response.username,
    canChangeUsername: response.canChangeUsername,
    nextChangeAt: response.nextChangeAt,
    shinyLocked: response.settings?.shinyLocked === true,
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
