import type { EventReward } from "../../game-data/events/eventRewards.js";
import { NO_PROGRESS, type EventProgress } from "./progressStore.js";
import { nextUtcMidnight, utcDay, type ScheduledEvent } from "./schedule.js";

/**
 * What `GET /bm/events` sends for one event: the event, its window, and the
 * player's progress in it. Pure.
 */

export interface CalendarView {
  /** Each day's rewards, day 1 first. */
  days: (readonly EventReward[])[];
  /** Days claimed so far. */
  claimed: number;
  /** Whether a claim today would be paid (the event is on, today's is not claimed, days are left). */
  canClaim: boolean;
  /** When the next day opens (unix s) while today's is claimed and days are left; else null. */
  nextAt: number | null;
}

export interface LadderView {
  label: string;
  counter: number;
  tiers: { need: number; rewards: readonly EventReward[]; claimed: boolean }[];
}

export interface EventView {
  id: string;
  title: string;
  text: string;
  kind: string;
  banner: string | null;
  status: "active" | "upcoming";
  /** Unix seconds. */
  startsAt: number;
  endsAt: number;
  calendar: CalendarView | null;
  ladder: LadderView | null;
}

/** The calendar as the player stands in it at `now`. */
export const calendarView = (
  days: readonly { rewards: readonly EventReward[] }[],
  progress: EventProgress,
  active: boolean,
  now: number
): CalendarView => {
  const claimed = Math.min(progress.calendarDays, days.length);
  const left = claimed < days.length;
  const claimedToday = progress.calendarLast !== null && progress.calendarLast >= utcDay(now);
  return {
    days: days.map((day) => day.rewards),
    claimed,
    canClaim: active && left && !claimedToday,
    nextAt: active && left && claimedToday ? nextUtcMidnight(now) : null,
  };
};

export const eventView = (scheduled: ScheduledEvent, progress: EventProgress = NO_PROGRESS, now: number): EventView => {
  const { event, window, status } = scheduled;
  const active = status === "active";
  return {
    id: event.id,
    title: event.title,
    text: event.text,
    kind: event.kind,
    banner: event.banner ?? null,
    status,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    calendar: event.calendar?.length ? calendarView(event.calendar, progress, active, now) : null,
    ladder: event.ladder
      ? {
          label: event.ladder.label,
          counter: progress.counter,
          tiers: event.ladder.tiers.map((tier, index) => ({
            need: tier.need,
            rewards: tier.rewards,
            claimed: progress.claimedTiers.includes(index),
          })),
        }
      : null,
  };
};
