import type { CoinGain } from "@/api/types";

/**
 * EVENT COINS (beta 7 grill item 29): the currency big events pay (their
 * login calendar and ladder, owner 8 Nov 2026; weekend events 25 + 75,
 * owner 12 Nov 2026) and
 * the decorations shop takes. The server owns the balance
 * (`server/src/services/events/eventCoins.ts`); the client only shows it.
 *
 * The purse arrives on the owner's main-yard load (`eventcoins`, and
 * `coinsgained` when the load paid a weekend's "played" Glimmers) and on
 * every yard answer that changed it (`YardStore`). Each arrival goes through
 * {@link noteCoins}, which works out what was gained for the "+25" moment
 * (`game/yard/plugins/eventCoins.ts`):
 *
 * - the answer says what it paid (`coinsGained`): that;
 * - otherwise, a balance higher than the last one this session saw (seen
 *   at the next yard load): the difference. The first balance of a session shows nothing.
 *
 * A gain noted before anyone listens (the load, before the yard's plugins
 * mount) waits for the first listener.
 */

/** One "+N coins" moment. */
export interface CoinsGained {
  readonly amount: number;
  readonly balance: number;
  /** What paid it, when the server said (`calendar`, `ladder`). */
  readonly reasons: readonly string[];
}

type Listener = (gained: CoinsGained) => void;

let balance: number | null = null;
let pending: CoinsGained | null = null;
const listeners = new Set<Listener>();
const balanceListeners = new Set<(balance: number) => void>();

const emit = (gained: CoinsGained): void => {
  if (listeners.size === 0) {
    pending = pending
      ? { amount: pending.amount + gained.amount, balance: gained.balance, reasons: [...pending.reasons, ...gained.reasons] }
      : gained;
    return;
  }
  for (const listener of listeners) listener(gained);
};

/** The last balance the server sent this session, or null before the first. */
export const coinBalance = (): number | null => balance;

/** A new balance from the server, and what it said was paid. */
export const noteCoins = (next: number, gained?: readonly CoinGain[] | null): void => {
  if (!Number.isFinite(next) || next < 0) return;
  const paid = (gained ?? []).filter((gain) => gain.amount > 0);
  const said = paid.reduce((sum, gain) => sum + gain.amount, 0);
  const before = balance;
  balance = next;
  if (said > 0) emit({ amount: said, balance: next, reasons: paid.map((gain) => gain.reason) });
  else if (before !== null && next > before) emit({ amount: next - before, balance: next, reasons: [] });
  if (before !== next) for (const listener of balanceListeners) listener(next);
};

/** Calls `listener` at each gain (and at once with any gain waiting); returns the unsubscribe. */
export const onCoinsGained = (listener: Listener): (() => void) => {
  listeners.add(listener);
  if (pending) {
    const waiting = pending;
    pending = null;
    listener(waiting);
  }
  return () => listeners.delete(listener);
};

/** Calls `listener` whenever the balance changes; returns the unsubscribe. */
export const onCoinBalance = (listener: (balance: number) => void): (() => void) => {
  balanceListeners.add(listener);
  return () => balanceListeners.delete(listener);
};

/**
 * Sign-out: forgets the balance and any waiting gain, so the next account's
 * first balance shows no "+N" measured against this one's. Listeners stay.
 */
export const forgetCoinBalance = (): void => {
  balance = null;
  pending = null;
};

/** Forgets everything (tests). */
export const resetCoins = (): void => {
  balance = null;
  pending = null;
  listeners.clear();
  balanceListeners.clear();
};
