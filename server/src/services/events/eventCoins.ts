import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

/**
 * EVENT COINS (beta 7 grill item 29, owner decision 6 Nov 2026): a currency
 * only events pay, and the one the decorations shop takes (a decoration
 * costs its Flash Shiny price in coins, `services/yard/decor.ts`). Coins
 * never expire.
 *
 * The server owns the balance: it lives in `bym.event_coins` (migration
 * `20261113_CreateEventCoinsTables.ts`), never in the save the client
 * writes, and every change is one atomic statement:
 *
 * - {@link EventCoinStore.grant} adds coins. With an `awardKey` it pays at
 *   most once per player and key (a weekend's "played", say): a second call
 *   finds the key in the log and pays nothing.
 * - {@link EventCoinStore.spend} takes coins only while the balance covers
 *   them, so two tabs racing to spend the last 50 cannot both win.
 *
 * Inside a yard action, pass the action's transaction (`em`): the coins then
 * land or roll back with the yard, and the wrapper reports the new balance
 * ({@link coinNotes}). The row lock order is always the main yard first,
 * then the coin row; nothing here ever locks a save, so a coin write outside
 * a yard action cannot wait on one.
 *
 * Where coins come from (owner's figures): about 400 per full 14-day event
 * (15 a day from its login calendar, an `eventCoins` reward,
 * `game-data/events/eventRewards.ts`, plus about 190 from its ladder), and
 * about 100 per weekend event (`weekendCoins.ts`: 25 for playing, 75 for
 * using the boost).
 */

/** The most coins a balance holds (the `integer` column). */
export const COINS_MAX = 2_147_483_647;

/** One payment, for the answer and the client's "+25" moment. */
export interface CoinGain {
  readonly amount: number;
  /** A short reason, e.g. `weekend-played`, `calendar`, `ladder`. */
  readonly reason: string;
}

export interface EventCoinStore {
  /** The player's balance, 0 for a player with no row. */
  balance(em: EntityManager, userid: number): Promise<number>;
  /**
   * Adds `amount` (a whole number above 0) and returns the new balance, or
   * null when `awardKey` was paid to this player already (nothing changes).
   */
  grant(em: EntityManager, userid: number, amount: number, reason: string, awardKey?: string): Promise<number | null>;
  /** Which of `awardKeys` this player has been paid. */
  awarded(em: EntityManager, userid: number, awardKeys: readonly string[]): Promise<Set<string>>;
  /**
   * Takes `amount` (a whole number above 0) and returns the new balance, or
   * null when the balance is short (nothing changes).
   */
  spend(em: EntityManager, userid: number, amount: number, reason: string): Promise<number | null>;
}

/** A whole amount above 0, at most {@link COINS_MAX}; 0 for anything else. */
export const coinAmount = (raw: unknown): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1 ? Math.min(COINS_MAX, Math.floor(value)) : 0;
};

/** The yard action hands over the core entity manager; the store needs its SQL. */
const sql = (em: EntityManager): SqlEntityManager => em as SqlEntityManager;

/* ── What changed in one request (the yard answer reports it) ─────────── */

interface CoinNote {
  balance: number;
  gained: CoinGain[];
}

const notes = new WeakMap<object, CoinNote>();

const note = (em: EntityManager, balance: number, gain?: CoinGain): void => {
  const current = notes.get(em) ?? { balance, gained: [] };
  current.balance = balance;
  if (gain) current.gained.push(gain);
  notes.set(em, current);
};

/**
 * The balance after the last coin change made through `em`, and what was
 * paid, or null when nothing changed: a yard action's answer carries it
 * (`eventcoins`, `coinsGained`) so the client's purse never needs a read of
 * its own.
 */
export const coinNotes = (em: EntityManager): { balance: number; gained: readonly CoinGain[] } | null =>
  notes.get(em) ?? null;

/* ── The store on `bym.event_coins` ───────────────────────────────────── */

export const sqlCoinStore: EventCoinStore = {
  async balance(em, userid) {
    const rows = await sql(em).execute<{ balance: number | string }[]>(
      `SELECT balance FROM bym.event_coins WHERE userid = ?`,
      [userid]
    );
    return Number(rows[0]?.balance) || 0;
  },

  async grant(em, userid, raw, reason, awardKey) {
    const amount = coinAmount(raw);
    if (amount === 0) return null;
    // The log row first: with a key, a second payment conflicts and the
    // balance statement then has nothing to add. One statement, so a
    // racing request sees either both rows or neither.
    const rows = await sql(em).execute<{ balance: number | string }[]>(
      `WITH paid AS (
         INSERT INTO bym.event_coin_log (userid, amount, reason, award_key)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (userid, award_key) WHERE award_key IS NOT NULL DO NOTHING
         RETURNING amount
       )
       INSERT INTO bym.event_coins AS c (userid, balance, earned)
       SELECT ?, amount, amount FROM paid
       ON CONFLICT (userid) DO UPDATE
          SET balance = LEAST(c.balance::bigint + EXCLUDED.balance, ?)::integer,
              earned = LEAST(c.earned::bigint + EXCLUDED.earned, ?)::integer,
              updated_at = now()
       RETURNING balance`,
      [userid, amount, reason, awardKey ?? null, userid, COINS_MAX, COINS_MAX]
    );
    if (rows.length === 0) return null;
    const balance = Number(rows[0]!.balance) || 0;
    note(em, balance, { amount, reason });
    return balance;
  },

  async awarded(em, userid, awardKeys) {
    if (awardKeys.length === 0) return new Set();
    const rows = await sql(em).execute<{ award_key: string }[]>(
      `SELECT award_key FROM bym.event_coin_log
        WHERE userid = ? AND award_key IN (${awardKeys.map(() => "?").join(", ")})`,
      [userid, ...awardKeys]
    );
    return new Set(rows.map((row) => row.award_key));
  },

  async spend(em, userid, raw, reason) {
    const amount = coinAmount(raw);
    if (amount === 0) return null;
    const rows = await sql(em).execute<{ balance: number | string }[]>(
      `WITH taken AS (
         UPDATE bym.event_coins
            SET balance = balance - ?, spent = LEAST(spent::bigint + ?, ?)::integer, updated_at = now()
          WHERE userid = ? AND balance >= ?
         RETURNING balance
       ), logged AS (
         INSERT INTO bym.event_coin_log (userid, amount, reason)
         SELECT ?, ?, ? FROM taken
       )
       SELECT balance FROM taken`,
      [amount, amount, COINS_MAX, userid, amount, userid, -amount, reason]
    );
    if (rows.length === 0) return null;
    const balance = Number(rows[0]!.balance) || 0;
    note(em, balance);
    return balance;
  },
};

/**
 * The same rules on Maps, for tests and anything else without a database.
 * Single-threaded, so each call is atomic as the SQL statements are. It
 * notes changes as the SQL store does.
 */
export const memoryCoinStore = (): EventCoinStore & {
  balances: Map<number, number>;
  log: { userid: number; amount: number; reason: string; awardKey: string | null }[];
} => {
  const balances = new Map<number, number>();
  const log: { userid: number; amount: number; reason: string; awardKey: string | null }[] = [];
  return {
    balances,
    log,
    async balance(_em, userid) {
      return balances.get(userid) ?? 0;
    },
    async grant(em, userid, raw, reason, awardKey) {
      const amount = coinAmount(raw);
      if (amount === 0) return null;
      if (awardKey !== undefined && log.some((row) => row.userid === userid && row.awardKey === awardKey)) return null;
      log.push({ userid, amount, reason, awardKey: awardKey ?? null });
      const balance = Math.min(COINS_MAX, (balances.get(userid) ?? 0) + amount);
      balances.set(userid, balance);
      note(em, balance, { amount, reason });
      return balance;
    },
    async awarded(_em, userid, awardKeys) {
      return new Set(
        log.filter((row) => row.userid === userid && row.awardKey !== null && awardKeys.includes(row.awardKey)).map((row) => row.awardKey!)
      );
    },
    async spend(em, userid, raw, reason) {
      const amount = coinAmount(raw);
      const have = balances.get(userid) ?? 0;
      if (amount === 0 || have < amount) return null;
      balances.set(userid, have - amount);
      log.push({ userid, amount: -amount, reason, awardKey: null });
      note(em, have - amount);
      return have - amount;
    },
  };
};

/** The store the game uses; tests swap it ({@link useCoinStore}). */
let current: EventCoinStore = sqlCoinStore;

export const coinStore = (): EventCoinStore => current;

/** Swaps the store (tests); returns the one it replaced. */
export const useCoinStore = (store: EventCoinStore): EventCoinStore => {
  const previous = current;
  current = store;
  return previous;
};
