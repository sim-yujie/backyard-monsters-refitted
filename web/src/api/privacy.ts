import { friendsApi, type BlockedPlayer } from "./friends";
import { postJson } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * Privacy and blocking (friends WP9, `docs/design/friends.md` §3.6 and §6.2):
 * the two privacy switches ride on `POST /player/settings`, the block list is
 * `GET /player/blocked`, and `POST /player/block|unblock { userid }` change it.
 * Kept apart from the friends client so the settings dialog and the Block
 * buttons need only this small module.
 */
const SETTINGS_PATH = "/api/:apiVersion/player/settings";

export interface PrivacySettings {
  /** True when friends see no online dot or "seen" time. */
  readonly hideOnline: boolean;
  /** False when the player turned friend requests off. */
  readonly friendRequests: boolean;
}

export type { BlockedPlayer };

interface SettingsAnswer extends ApiEnvelope {
  settings?: { hideOnline?: unknown; friendRequests?: unknown };
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

// Block, unblock and the blocked list are one implementation, in the friends client.
export const fetchBlocked = (): Promise<BlockedPlayer[]> => friendsApi.blocked();
export const blockPlayer = (userid: number): Promise<void> => friendsApi.block(userid);
export const unblockPlayer = (userid: number): Promise<void> => friendsApi.unblock(userid);
