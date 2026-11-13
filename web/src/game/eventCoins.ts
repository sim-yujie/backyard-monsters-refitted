/**
 * EVENT COINS (beta 7 grill item 29): the currency big events pay (their
 * login calendar and ladder, owner 8 Nov 2026; weekend events 50 a day for
 * checking in, owner 13 Nov 2026) and
 * the decorations shop takes. The server owns the balance
 * (`server/src/services/events/eventCoins.ts`); the client only shows it.
 *
 * The purse arrives on the owner's main-yard load (`eventcoins`) and on
 * every yard answer that changed it (`YardStore`). Each arrival goes through
 * {@link noteCoins}; the top bar's Glimmers readout floats each change of
 * balance ("+25", "-40") as the resource readouts do (`ui/Hud.ts`). Gains
 * raise no toast (owner, 13 Nov 2026): the bar shows them.
 */

let balance: number | null = null;
const balanceListeners = new Set<(balance: number, before: number | null) => void>();

/** The last balance the server sent this session, or null before the first. */
export const coinBalance = (): number | null => balance;

/** A new balance from the server. */
export const noteCoins = (next: number): void => {
  if (!Number.isFinite(next) || next < 0) return;
  const before = balance;
  balance = next;
  if (before !== next) for (const listener of balanceListeners) listener(next, before);
};

/**
 * Calls `listener` whenever the balance changes, with the balance before it
 * (null for the session's first, or the first after a sign-out); returns the unsubscribe.
 */
export const onCoinBalance = (listener: (balance: number, before: number | null) => void): (() => void) => {
  balanceListeners.add(listener);
  return () => balanceListeners.delete(listener);
};

/**
 * Sign-out: forgets the balance, so the next account's first balance floats
 * no "+N" measured against this one's. Listeners stay.
 */
export const forgetCoinBalance = (): void => {
  balance = null;
};

/** Forgets everything (tests). */
export const resetCoins = (): void => {
  balance = null;
  balanceListeners.clear();
};
