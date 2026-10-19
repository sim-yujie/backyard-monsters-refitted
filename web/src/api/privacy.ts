import { get, postJson } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * Privacy and blocking (friends WP9, `docs/design/friends.md` §3.6 and §6.2):
 * the two privacy switches ride on `POST /player/settings`, the block list is
 * `GET /player/blocked`, and `POST /player/block|unblock { userid }` change it.
 * Kept apart from the friends client so the settings dialog and the Block
 * buttons need only this small module.
 */
const SETTINGS_PATH = "/api/:apiVersion/player/settings";
const BLOCKED_PATH = "/api/:apiVersion/player/blocked";
const BLOCK_PATH = "/api/:apiVersion/player/block";
const UNBLOCK_PATH = "/api/:apiVersion/player/unblock";

export interface PrivacySettings {
  /** True when friends see no online dot or "seen" time. */
  readonly hideOnline: boolean;
  /** False when the player turned friend requests off. */
  readonly friendRequests: boolean;
}

/** One player this player has blocked. */
export interface BlockedPlayer {
  readonly userid: number;
  readonly username: string;
}

interface SettingsAnswer extends ApiEnvelope {
  settings?: { hideOnline?: unknown; friendRequests?: unknown };
}
interface BlockedAnswer extends ApiEnvelope {
  blocked?: { userid?: unknown; username?: unknown }[];
}

/** Reads the two switches out of a settings block; the defaults are "visible" and "accepting". */
export const privacyOf = (settings: SettingsAnswer["settings"]): PrivacySettings => ({
  hideOnline: settings?.hideOnline === true,
  friendRequests: settings?.friendRequests !== false,
});

/** Saves the switches given; resolves with the stored state. */
export const setPrivacy = async (change: Partial<PrivacySettings>): Promise<PrivacySettings> => {
  const response = await postJson<SettingsAnswer>(SETTINGS_PATH, {
    ...(change.hideOnline !== undefined && { hideOnline: change.hideOnline }),
    ...(change.friendRequests !== undefined && { friendRequests: change.friendRequests }),
  });
  return privacyOf(response.settings);
};

export const fetchBlocked = async (): Promise<BlockedPlayer[]> => {
  const response = await get<BlockedAnswer>(BLOCKED_PATH);
  return (response.blocked ?? []).map((row) => ({
    userid: Number(row.userid),
    username: typeof row.username === "string" ? row.username : "A player",
  }));
};

export const blockPlayer = async (userid: number): Promise<void> => {
  await postJson(BLOCK_PATH, { userid });
};

export const unblockPlayer = async (userid: number): Promise<void> => {
  await postJson(UNBLOCK_PATH, { userid });
};
