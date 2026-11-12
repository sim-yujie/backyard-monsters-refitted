import type { EntityManager } from "@mikro-orm/core";

import { logger } from "../../utils/logger.js";
import { coinStore, type EventCoinStore } from "./eventCoins.js";
import { activeRun, type WeekendRun } from "./weekendSchedule.js";
import type { WeekendSettings } from "../../game-data/events/weekendEvents.js";
import { weekendSettings } from "./weekendSettings.js";

/**
 * A weekend event's Glimmers (beta 7 grill item 29, owner 6 Nov 2026; off
 * 8 Nov, back on 12 Nov: "builder's weekend pay glimmer"): about
 * 100 per weekend, {@link WEEKEND_COINS}`.played` for playing during it and
 * `.boost` for using its boost. Each is paid once per player per run (the
 * run's `key`: its Saturday, or `forced-<since>` for a forced one), through
 * the coin log's award key, so a race or a retry never pays twice.
 *
 * - Played: the first time the player's own main yard loads during the run
 *   (`controllers/base/load/baseLoad.ts`). ASSUMED: loading the yard is
 *   "playing".
 * - Boost: the first time the player uses the boost (`weekendBoosts.ts`
 *   `weekendBoostUsed`): an upgrade at the Builder's Weekend price, a
 *   training or research in a Study Weekend, monsters hatched in a Hatch
 *   Rush, tribe loot banked in Tribe Plunder. Using the boost also counts as
 *   playing (ASSUMED), so it pays "played" too when that is still unpaid.
 */
export const WEEKEND_COINS = { played: 25, boost: 75 } as const;

export type WeekendCoinPart = keyof typeof WEEKEND_COINS;

/** The coin log's award key for `part` of `run`. */
export const weekendAwardKey = (run: Pick<WeekendRun, "key">, part: WeekendCoinPart): string =>
  `weekend:${run.key}:${part}`;

/**
 * Keys already paid (or found paid) in this process, so a busy player's
 * every yard load is not a database write. Only a cache: the log's unique
 * index is the rule. Emptied when it grows past {@link SEEN_MAX}.
 */
const seen = new Set<string>();
const SEEN_MAX = 200_000;

const remember = (key: string): void => {
  if (seen.size >= SEEN_MAX) seen.clear();
  seen.add(key);
};

/** Forgets the cache (tests). */
export const forgetWeekendCoinCache = (): void => seen.clear();

export interface WeekendCoinOptions {
  readonly settings?: WeekendSettings;
  readonly store?: EventCoinStore;
}

/**
 * Pays `parts` of the weekend run on at `now` to `userid`, each at most
 * once; returns the coins paid now (0 when no run is on or all were paid).
 * Errors go to the caller: inside a yard action they roll the action back
 * (it is retried), elsewhere call {@link awardWeekendCoinsSafely}.
 */
export const awardWeekendCoins = async (
  em: EntityManager,
  userid: number,
  parts: readonly WeekendCoinPart[],
  now: number,
  options: WeekendCoinOptions = {}
): Promise<number> => {
  const run = activeRun(options.settings ?? weekendSettings(), now);
  if (!run) return 0;
  const store = options.store ?? coinStore();
  let paid = 0;
  for (const part of parts) {
    const key = weekendAwardKey(run, part);
    const cacheKey = `${userid}:${key}`;
    if (seen.has(cacheKey)) continue;
    const balance = await store.grant(em, userid, WEEKEND_COINS[part], `weekend-${part}`, key);
    if (balance !== null) paid += WEEKEND_COINS[part];
    // Remembered only once found paid already: a payment made inside a yard
    // action may still roll back, and the next call must try again.
    else remember(cacheKey);
  }
  return paid;
};

/**
 * {@link awardWeekendCoins} for the places that must not fail on it (a
 * yard load, an attack already committed): a failure is logged and the
 * coins are paid at the next chance instead.
 */
export const awardWeekendCoinsSafely = async (
  em: EntityManager,
  userid: number,
  parts: readonly WeekendCoinPart[],
  now: number,
  options: WeekendCoinOptions = {}
): Promise<number> => {
  try {
    return await awardWeekendCoins(em, userid, parts, now, options);
  } catch (error) {
    logger.error("Could not pay weekend coins to {userid}: {error}", {
      event: "weekend-coins-failed",
      userid,
      parts,
      error,
    });
    return 0;
  }
};

/** What the weekend pop-up shows: the run on now and which parts this player has been paid. */
export interface WeekendCoinState {
  readonly key: string;
  readonly played: boolean;
  readonly boost: boolean;
  readonly coins: typeof WEEKEND_COINS;
}

export const weekendCoinState = async (
  em: EntityManager,
  userid: number,
  now: number,
  options: WeekendCoinOptions = {}
): Promise<WeekendCoinState | null> => {
  const run = activeRun(options.settings ?? weekendSettings(), now);
  if (!run) return null;
  const store = options.store ?? coinStore();
  const paid = await store.awarded(em, userid, [weekendAwardKey(run, "played"), weekendAwardKey(run, "boost")]);
  return {
    key: run.key,
    played: paid.has(weekendAwardKey(run, "played")),
    boost: paid.has(weekendAwardKey(run, "boost")),
    coins: WEEKEND_COINS,
  };
};
