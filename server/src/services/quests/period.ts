import { DAY_SECONDS, nextUtcMidnight, utcDay } from "../events/schedule.js";

/**
 * The quests' clock: one reset for everyone (owner, 2 Nov 2026). A day starts
 * at 00:00 UTC, a week at Monday 00:00 UTC. Times are unix seconds; a period
 * is named by the `YYYY-MM-DD` of its first UTC day.
 */

export { DAY_SECONDS, nextUtcMidnight, utcDay };

export const WEEK_SECONDS = 7 * DAY_SECONDS;

/** Unix seconds of the Monday 00:00 UTC that starts the week `now` falls in. */
export const utcWeekStart = (now: number): number => {
  const dayStart = Math.floor(now / DAY_SECONDS) * DAY_SECONDS;
  // getUTCDay: Sunday 0 .. Saturday 6; days since Monday 0 .. 6.
  const sinceMonday = (new Date(dayStart * 1000).getUTCDay() + 6) % 7;
  return dayStart - sinceMonday * DAY_SECONDS;
};

/** `YYYY-MM-DD` of the Monday that starts the week `now` falls in. */
export const utcWeek = (now: number): string => utcDay(utcWeekStart(now));

/** The next Monday 00:00 UTC after `now`, unix seconds. */
export const nextUtcMonday = (now: number): number => utcWeekStart(now) + WEEK_SECONDS;
