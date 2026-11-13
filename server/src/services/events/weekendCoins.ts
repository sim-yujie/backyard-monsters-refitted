import type { EntityManager } from "@mikro-orm/core";

import { coinStore, type EventCoinStore } from "./eventCoins.js";
import { activeRun, type WeekendRun } from "./weekendSchedule.js";
import type { WeekendSettings } from "../../game-data/events/weekendEvents.js";
import { weekendSettings } from "./weekendSettings.js";

/**
 * A weekend event's Glimmers: a DAILY CHECK-IN (owner, 13 Nov 2026: "reward
 * based on attendance (Check in on the event itself to receive 50 glimmer
 * each day)"). While a weekend event runs, a player may check in once per
 * event day, from the event's card on the Events page or its pop-up, and
 * each check-in pays {@link WEEKEND_CHECKIN_COINS}. A 48-hour weekend has
 * two days, so 100 at most. Using the event's discount pays nothing (the
 * old 25 "played" + 75 "boost" Glimmers are gone).
 *
 * An event DAY is each 24-hour block from the run's start: a scheduled
 * weekend starts Saturday 00:00 in the settings' zone (UTC by default), so
 * day 1 is Saturday and day 2 Sunday. A weekend the dashboard lengthens
 * gets more days (72 h: 3); one it shortens fewer (24 h: 1); a last block
 * shorter than 24 h still counts as a day. A run forced from the dashboard
 * ("Run now") counts its days from the moment it was switched on.
 *
 * Each day is paid at most once per player through the coin log's award
 * key `weekend:<run key>:day<n>` (unique per player), so a double click,
 * two tabs or a retry never pays twice. No new table or column.
 */
export const WEEKEND_CHECKIN_COINS = 50;

/** The coin log's reason for a check-in. */
export const WEEKEND_CHECKIN_REASON = "weekend-checkin";

const DAY = 86_400;

/** Above this many days (a long forced test run) the card shows only yesterday and today. */
export const WEEKEND_CHECKIN_MAX_MARKS = 7;

/** The run's day at `now`, 1-based (24-hour blocks from its start). */
export const weekendDayOf = (run: Pick<WeekendRun, "startsAt">, now: number): number =>
  Math.floor((now - run.startsAt) / DAY) + 1;

/** How many days the run has (its last, shorter block counts). */
export const weekendDaysOf = (run: Pick<WeekendRun, "startsAt" | "endsAt">): number =>
  Math.max(1, Math.ceil((run.endsAt - run.startsAt) / DAY));

/** The run on at `now` that has started (a forced run is "on" before its `since`; it has no day then). */
const runAt = (settings: WeekendSettings, now: number): WeekendRun | null => {
  const run = activeRun(settings, now);
  return run && run.startsAt <= now ? run : null;
};

/** The coin log's award key for day `day` of `run`. */
export const weekendCheckinKey = (run: Pick<WeekendRun, "key">, day: number): string =>
  `weekend:${run.key}:day${day}`;

/** When day `day + 1` starts, or null when `day` is the run's last. */
const nextDayAt = (run: Pick<WeekendRun, "startsAt" | "endsAt">, day: number): number | null => {
  const at = run.startsAt + day * DAY;
  return at < run.endsAt ? at : null;
};

/** One day of the run as the card shows it. */
export interface WeekendCheckinMark {
  readonly day: number;
  readonly claimed: boolean;
}

/** The player's check-in for the weekend run on now (the card's button and day marks). */
export interface WeekendCheckinState {
  /** The run's key, so the client never reads one weekend's state for another. */
  readonly key: string;
  /** What one check-in pays. */
  readonly amount: number;
  /** Today's day of the run, 1-based. */
  readonly day: number;
  /** The run's days. */
  readonly days: number;
  /** Whether today has been checked in. */
  readonly claimedToday: boolean;
  /** The days to draw: every day of the run, or for a run longer than {@link WEEKEND_CHECKIN_MAX_MARKS} days yesterday and today. */
  readonly marks: readonly WeekendCheckinMark[];
  /** When the next day starts (unix s), or null on the last day. */
  readonly nextAt: number | null;
}

export interface WeekendCheckinOptions {
  readonly settings?: WeekendSettings;
  readonly store?: EventCoinStore;
}

/** The days {@link WeekendCheckinState.marks} draws. */
const markDays = (day: number, days: number): number[] => {
  const first = days <= WEEKEND_CHECKIN_MAX_MARKS ? 1 : Math.max(1, day - 1);
  const last = days <= WEEKEND_CHECKIN_MAX_MARKS ? days : day;
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
};

/** The state of `run` at `now` for `userid`, read through `store`. */
const stateOf = async (
  em: EntityManager,
  store: EventCoinStore,
  userid: number,
  run: WeekendRun,
  now: number
): Promise<WeekendCheckinState> => {
  const day = weekendDayOf(run, now);
  const days = weekendDaysOf(run);
  const shown = markDays(day, days);
  const paid = await store.awarded(em, userid, shown.map((d) => weekendCheckinKey(run, d)));
  const marks = shown.map((d) => ({ day: d, claimed: paid.has(weekendCheckinKey(run, d)) }));
  return {
    key: run.key,
    amount: WEEKEND_CHECKIN_COINS,
    day,
    days,
    claimedToday: paid.has(weekendCheckinKey(run, day)),
    marks,
    nextAt: nextDayAt(run, day),
  };
};

/** The player's check-in state for the weekend run on at `now`, or null when none runs. */
export const weekendCheckinState = async (
  em: EntityManager,
  userid: number,
  now: number,
  options: WeekendCheckinOptions = {}
): Promise<WeekendCheckinState | null> => {
  const run = runAt(options.settings ?? weekendSettings(), now);
  if (!run) return null;
  return stateOf(em, options.store ?? coinStore(), userid, run, now);
};

/** Why a check-in was refused. */
export type WeekendCheckinRefusal =
  | { readonly refused: "noWeekend" }
  | { readonly refused: "checkedInToday"; readonly state: WeekendCheckinState };

export type WeekendCheckinResult =
  | { readonly refused?: undefined; readonly paid: number; readonly state: WeekendCheckinState }
  | WeekendCheckinRefusal;

/**
 * Checks `userid` in for today of the weekend run on at `now`: pays
 * {@link WEEKEND_CHECKIN_COINS} once per day. Refused when no weekend event
 * runs, or today was paid already (a second click, another tab). Inside a
 * yard action pass its transaction: the coins land or roll back with it, and
 * the action's answer reports the new balance.
 */
export const checkInWeekend = async (
  em: EntityManager,
  userid: number,
  now: number,
  options: WeekendCheckinOptions = {}
): Promise<WeekendCheckinResult> => {
  const run = runAt(options.settings ?? weekendSettings(), now);
  if (!run) return { refused: "noWeekend" };
  const store = options.store ?? coinStore();
  const day = weekendDayOf(run, now);
  const balance = await store.grant(em, userid, WEEKEND_CHECKIN_COINS, WEEKEND_CHECKIN_REASON, weekendCheckinKey(run, day));
  const state = await stateOf(em, store, userid, run, now);
  if (balance === null) return { refused: "checkedInToday", state };
  return { paid: WEEKEND_CHECKIN_COINS, state };
};
