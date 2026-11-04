import { fetchAccount } from "@/api/account";
import { getAuthToken } from "@/api/http";

/**
 * Whether the signed-in account has Shiny Lock on, for the HUD's Shiny counter.
 *
 * While the lock is on the server sends the balance as 0 (`services/user/
 * shinyLock.ts` `visibleCredits`) and keeps the real one, so a plain "0"
 * read as "my Shiny is gone" (bug report #10: a locked player saw 0 after
 * golden pumpkins and thought rewards never came). The HUD shows a lock
 * instead; this module says when.
 *
 * Read once per sign-in from the account settings (`GET /player/account`),
 * and set again whenever the Account settings dialog reads or changes it.
 * Unknown (the read failed or has not come) counts as off: the counter then
 * shows the number, as before.
 */

/** The counter's words while the lock is on: tooltip, screen reader and the tap bubble. */
export const SHINY_LOCK_TEXT = "Shiny Lock is on. Turn it off in Account settings to see and spend your Shiny.";

type Listener = (locked: boolean) => void;

const listeners = new Set<Listener>();
let locked = false;
/** The token the state was read for, so a new sign-in reads it again. */
let readFor: string | null | undefined;

/** Whether the lock is on, as last read or set. */
export const shinyLocked = (): boolean => locked;

/** The lock is `on` now (read from the server or just changed); tells every listener of a change. */
export const noteShinyLock = (on: boolean): void => {
  readFor = getAuthToken();
  if (on === locked) return;
  locked = on;
  for (const listener of listeners) listener(on);
};

/** Calls `listener` with each change. Returns the unsubscribe. */
export const onShinyLock = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Reads the lock once for this sign-in; again only after another sign-in.
 * A failed read is forgotten so the next HUD tries again.
 */
export const loadShinyLock = (read: typeof fetchAccount = fetchAccount): void => {
  const token = getAuthToken();
  if (token === null || readFor === token) return;
  readFor = token;
  if (locked) noteShinyLock(false);
  read().then(
    (account) => {
      if (getAuthToken() === token) noteShinyLock(account.shinyLocked);
    },
    () => {
      if (readFor === token) readFor = undefined;
    },
  );
};

/** Tests only: back to unknown and off, with no listeners. */
export const resetShinyLockForTests = (): void => {
  listeners.clear();
  locked = false;
  readFor = undefined;
};
