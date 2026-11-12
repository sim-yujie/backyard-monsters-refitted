import { postJson } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * Which of the bell's notification categories reach the player (owner, 11
 * Nov 2026: "configure what gets sent to a player's notifications").
 *
 * Kept on the server, on the account (`user.notifications_off`), so the
 * choice follows the player to any device, and applied there too: the bell's
 * list and count leave out what is turned off
 * (`server/src/services/notifications/notificationCategories.ts`). The
 * account's settings block carries the categories turned off
 * (`notificationsOff`); `POST /player/settings { notifications: { id: on } }`
 * changes one and answers with the block.
 *
 * A change tells {@link onNotificationSettingsChanged}'s listeners (the
 * yard's bell), so the count follows at once rather than at the next yard
 * answer.
 */

const SETTINGS_PATH = "/api/:apiVersion/player/settings";

/** The categories a player can turn off, as the server names them, in the order Settings lists them. */
export const NOTIFICATION_CATEGORY_IDS = ["attacks", "buildings", "monsters", "boosts", "friends", "achievements"] as const;

export type NotificationCategoryId = (typeof NOTIFICATION_CATEGORY_IDS)[number];

const isCategory = (id: unknown): id is NotificationCategoryId =>
  typeof id === "string" && (NOTIFICATION_CATEGORY_IDS as readonly string[]).includes(id);

/** The categories turned off, out of a settings block; none (all on) when it says nothing. */
export const notificationsOffOf = (settings: { notificationsOff?: unknown } | undefined): NotificationCategoryId[] =>
  Array.isArray(settings?.notificationsOff) ? settings.notificationsOff.filter(isCategory) : [];

interface SettingsAnswer extends ApiEnvelope {
  settings?: { notificationsOff?: unknown };
}

type Listener = (off: readonly NotificationCategoryId[]) => void;

const listeners = new Set<Listener>();

/** Calls `listener` after every saved change; returns how to stop. */
export const onNotificationSettingsChanged = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Turns one category on or off; resolves with the categories turned off as stored. */
export const setNotificationCategory = async (
  id: NotificationCategoryId,
  on: boolean,
): Promise<NotificationCategoryId[]> => {
  const response = await postJson<SettingsAnswer>(SETTINGS_PATH, { notifications: { [id]: on } });
  const off = notificationsOffOf(response.settings);
  for (const listener of [...listeners]) listener(off);
  return off;
};
