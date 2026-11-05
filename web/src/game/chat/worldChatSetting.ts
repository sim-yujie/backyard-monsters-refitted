/**
 * The "World chat" switch in Account settings (owner, 1 Nov 2026): Off takes
 * the chat box off every screen and closes world chat's connection, so no chat
 * messages arrive, until the player turns it On again; On brings both back
 * without a reload.
 *
 * Kept in this browser only, like the Music choice (`game/classicLook.ts`):
 * nothing is sent to the server. On unless switched off; site data that cannot
 * be read counts as On.
 */

export const WORLD_CHAT_KEY = "bymr.worldChat";

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** The saved choice; On when nothing (or something unknown) is saved. */
export const savedWorldChatOn = (store: Storage | null = storage()): boolean => {
  try {
    return store?.getItem(WORLD_CHAT_KEY) !== "off";
  } catch {
    return true;
  }
};

/** Saves the choice. True if it was saved. */
export const saveWorldChatOn = (on: boolean, store: Storage | null = storage()): boolean => {
  try {
    if (on) store?.removeItem(WORLD_CHAT_KEY);
    else store?.setItem(WORLD_CHAT_KEY, "off");
    return store !== null;
  } catch {
    return false;
  }
};

let on = savedWorldChatOn();
const listeners = new Set<(on: boolean) => void>();

/** Whether world chat is on now. */
export const worldChatOn = (): boolean => on;

/**
 * Turns world chat on or off now and saves it for the next load. It changes at
 * once even when the save fails; the return says whether it was saved.
 */
export const setWorldChatOn = (wanted: boolean, store: Storage | null = storage()): boolean => {
  const saved = saveWorldChatOn(wanted, store);
  if (wanted !== on) {
    on = wanted;
    for (const listener of [...listeners]) listener(on);
  }
  return saved;
};

/** Calls `listener` on every change (not now); returns the way to stop. */
export const onWorldChatChange = (listener: (on: boolean) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
