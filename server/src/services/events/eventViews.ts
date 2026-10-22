import { KRALLEN_MAX_LEVEL, type EventReward } from "../../game-data/events/eventRewards.js";
import { lockedReason, type EventPlayer } from "./eventPlayer.js";
import { NO_PROGRESS, type EventProgress } from "./progressStore.js";
import { claimsUntil, nextUtcMidnight, utcDay, type ScheduledEvent } from "./schedule.js";

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
  /** "ended": over, with a ladder tier the player can still claim until `claimUntil`. */
  status: "active" | "upcoming" | "ended";
  /** Unix seconds. */
  startsAt: number;
  endsAt: number;
  /** When ladder claims close (unix s), for an event with claim days after its end; else null. */
  claimUntil: number | null;
  /** Why the player cannot take part (`EventDefinition.requires`), or null. Such a player counts nothing. */
  locked: string | null;
  calendar: CalendarView | null;
  ladder: LadderView | null;
  /** For an event that pays Krallen: her level now (0 for none) and the top an event raises her to. */
  krallen: { level: number; maxLevel: number } | null;
}

/** A player with nothing known: may take part, no Krallen. */
const ANYONE: EventPlayer = { townHall: Number.POSITIVE_INFINITY, tutorialDone: true, krallenLevel: 0 };

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

export const eventView = (
  scheduled: ScheduledEvent,
  progress: EventProgress = NO_PROGRESS,
  now: number,
  player: EventPlayer = ANYONE
): EventView => {
  const { event, window, status } = scheduled;
  const active = status === "active";
  const paysKrallen = (event.ladder?.tiers ?? []).some((tier) => tier.rewards.some((reward) => reward.kind === "krallen"));
  return {
    id: event.id,
    title: event.title,
    text: status === "upcoming" ? (event.upcomingText ?? event.text) : event.text,
    kind: event.kind,
    banner: event.banner ?? null,
    status,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    claimUntil: event.claimDays ? claimsUntil(event, window) : null,
    locked: lockedReason(event, player),
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
    krallen: paysKrallen ? { level: player.krallenLevel, maxLevel: KRALLEN_MAX_LEVEL } : null,
  };
};

/**
 * Whether the player has a ladder tier reached and not yet claimed that would
 * pay something: a Krallen at the top already takes nothing from the hunt.
 */
export const hasTierToClaim = (view: EventView): boolean =>
  !(view.krallen && view.krallen.level >= view.krallen.maxLevel) &&
  (view.ladder?.tiers ?? []).some((tier) => !tier.claimed && (view.ladder?.counter ?? 0) >= tier.need);
