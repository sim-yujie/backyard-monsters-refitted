import { AttackPermission } from "../../enums/MapRoom.js";
import type { NeighbourData } from "../../types/NeighbourData.js";

/** Full cache TTL once >= 10 neighbours are found. */
export const CACHE_VALIDITY_HOURS = 24 * 7 * 2;

/** Retry interval when the cached list is thin or has too few attackable neighbours. */
export const RETRY_CACHE_MINUTES = 30;

/** A cached list with fewer neighbours than this is retried after {@link RETRY_CACHE_MINUTES}. */
export const THIN_LIST = 10;

/**
 * A Map Room 1 list with fewer neighbours attackable right now than this is
 * also retried after {@link RETRY_CACHE_MINUTES} (`docs/design/bot-neighbours.md`
 * §4.3): bots under protection otherwise leave a two-week list with nothing
 * to attack.
 */
export const MIN_ATTACKABLE = 5;

export type NeighbourCache = { neighborsLastCalculated?: Date; neighbors: unknown[] };

/**
 * A Map Room 1 neighbour dropped from a player's list by the 10 attacks a day
 * cap (`registerAttacker`), and the day it happened (issue #247).
 */
export interface DroppedNeighbour {
  userid: number;
  /** The start of the day of the drop, in unix seconds ({@link dayStart}). */
  day: number;
}

/** The start of `now`'s day in unix seconds: the day the attack cap counts in. */
export const dayStart = (now: Date): number => new Date(now).setHours(0, 0, 0, 0) / 1000;

/**
 * The neighbours dropped on `now`'s day, whom a re-search leaves out until
 * the day rolls over (issue #247).
 *
 * @param {DroppedNeighbour[] | null | undefined} dropped - The maproom row's dropped list
 * @param {Date} now - The current time
 * @returns {number[]} Their user ids
 */
export const droppedToday = (dropped: DroppedNeighbour[] | null | undefined, now: Date): number[] => {
  const today = dayStart(now);
  return (dropped ?? []).filter((entry) => entry.day === today).map((entry) => entry.userid);
};

/**
 * The dropped list with `userid` noted as dropped today. Earlier days'
 * entries are let go, so the list never holds more than one day's drops.
 *
 * @param {DroppedNeighbour[] | null | undefined} dropped - The maproom row's dropped list
 * @param {number} userid - The neighbour just dropped
 * @param {Date} now - The current time
 * @returns {DroppedNeighbour[]} The new list
 */
export const noteDropped = (
  dropped: DroppedNeighbour[] | null | undefined,
  userid: number,
  now: Date
): DroppedNeighbour[] => {
  const day = dayStart(now);
  const kept = (dropped ?? []).filter((entry) => entry.day === day && entry.userid !== userid);
  return [...kept, { userid, day }];
};

/**
 * Determines whether a new neighbour search should be run.
 *
 * Returns true immediately if no search has ever been run. Otherwise applies
 * a short retry TTL when the cached list is thin (< 10), or the full cache TTL
 * when the list is healthy (>= 10).
 *
 * @param {NeighbourCache} cache - The maproom record holding the neighbour list and last-calculated timestamp
 * @param {Date} now - The current time
 * @returns {boolean} - True if a new search should be run
 */
export const needsNewNeighbours = (cache: NeighbourCache, now: Date): boolean => {
  if (!cache.neighborsLastCalculated) return true;

  if (cache.neighbors.length < THIN_LIST) return cache.neighborsLastCalculated < retryExpiry(now);

  return cache.neighborsLastCalculated < new Date(now.getTime() - CACHE_VALIDITY_HOURS * 60 * 60 * 1000);
};

/**
 * Whether a Map Room 1 list, its live fields just refreshed, should be
 * searched again because fewer than {@link MIN_ATTACKABLE} of its neighbours
 * can be attacked now and the last search is older than the retry interval.
 * The player's own level changing is never a reason (decision 23).
 *
 * @param {NeighbourData[]} neighbours - The list after `updateNeighbourData`
 * @param {Date | undefined} lastCalculated - When the list was last searched
 * @param {Date} now - The current time
 * @returns {boolean} True if a new search should be run
 */
export const needsAttackableRetry = (
  neighbours: NeighbourData[],
  lastCalculated: Date | undefined,
  now: Date
): boolean => {
  if (lastCalculated && lastCalculated >= retryExpiry(now)) return false;

  const attackable = neighbours.filter((neighbour) => neighbour.attackpermitted === AttackPermission.ATTACKABLE);
  return attackable.length < MIN_ATTACKABLE;
};

/**
 * A fresh search's list, with the attack counters of neighbours who were
 * already on the old list carried over, so a re-search never forgets who
 * attacked whom.
 *
 * @param {NeighbourData[]} previous - The list being replaced
 * @param {NeighbourData[]} found - The fresh search's list
 * @returns {NeighbourData[]} The fresh list with the old counters
 */
export const carryAttackCounters = (previous: NeighbourData[], found: NeighbourData[]): NeighbourData[] =>
  found.map((newNeighbor) => {
    const existing = previous.find((old) => old.userid === newNeighbor.userid);
    if (existing) {
      return {
        ...newNeighbor,
        attacksfrom: existing.attacksfrom || 0,
        attacksto: existing.attacksto || 0,
        retaliatecount: existing.retaliatecount || 0,
      };
    }
    return newNeighbor;
  });

const retryExpiry = (now: Date) => new Date(now.getTime() - RETRY_CACHE_MINUTES * 60 * 1000);
