import { eventsForcedOn } from "../../config/GameConfig.js";
import { EVENTS, UPCOMING_DAYS, type EventDefinition } from "../../game-data/events/events.js";

/**
 * When each event runs, and which ones a player sees now
 * (`game-data/events/events.ts`). Pure: the clock and the forced list are
 * passed in. Times are unix seconds; a "day" is a UTC calendar day.
 */

export const DAY_SECONDS = 24 * 60 * 60;

/** `YYYY-MM-DD` of the UTC day `now` falls on. */
export const utcDay = (now: number): string => new Date(Math.floor(now) * 1000).toISOString().slice(0, 10);

/** The next UTC midnight after `now`, unix seconds. */
export const nextUtcMidnight = (now: number): number => (Math.floor(now / DAY_SECONDS) + 1) * DAY_SECONDS;

/** An event's window: on from `startsAt`, over at `endsAt`. */
export interface EventWindow {
  readonly startsAt: number;
  readonly endsAt: number;
}

export type EventStatus = "active" | "upcoming" | "past";

const seconds = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/**
 * The event's window. A forced event (`eventsForcedOn`) starts at today's UTC
 * midnight and lasts as long as its real window does.
 */
export const eventWindow = (
  event: EventDefinition,
  now: number,
  forced: ReadonlySet<string> = eventsForcedOn(process.env)
): EventWindow => {
  const startsAt = seconds(event.startsAt);
  const endsAt = seconds(event.endsAt);
  if (!forced.has(event.id)) return { startsAt, endsAt };
  const today = Math.floor(now / DAY_SECONDS) * DAY_SECONDS;
  return { startsAt: today, endsAt: today + (endsAt - startsAt) };
};

/** Where `now` falls against the window. */
export const statusAt = (window: EventWindow, now: number): EventStatus =>
  now < window.startsAt ? "upcoming" : now < window.endsAt ? "active" : "past";

/**
 * When the event's ladder tiers stop being claimable: `claimDays` after its
 * end (`game-data/events/events.ts`), or at its end without any.
 */
export const claimsUntil = (event: EventDefinition, window: EventWindow): number =>
  window.endsAt + Math.max(0, Math.floor(event.claimDays ?? 0)) * DAY_SECONDS;

/** An event a player can see, with its window. "ended": over, but its tiers can still be claimed. */
export interface ScheduledEvent {
  readonly event: EventDefinition;
  readonly window: EventWindow;
  readonly status: "active" | "upcoming" | "ended";
}

/**
 * The events to show now: every active one, then the ones starting within
 * {@link UPCOMING_DAYS}, each in start order, then the ones that are over
 * but still within their {@link claimsUntil} (whose page shows them only to
 * players with a tier left to claim, `eventsState.ts`). Other past events
 * are left out.
 */
export const visibleEvents = (
  now: number,
  events: readonly EventDefinition[] = EVENTS,
  forced: ReadonlySet<string> = eventsForcedOn(process.env)
): ScheduledEvent[] => {
  const shown: ScheduledEvent[] = [];
  for (const event of events) {
    const window = eventWindow(event, now, forced);
    const status = statusAt(window, now);
    if (status === "past") {
      if (now < claimsUntil(event, window)) shown.push({ event, window, status: "ended" });
      continue;
    }
    if (status === "upcoming" && window.startsAt - now > UPCOMING_DAYS * DAY_SECONDS) continue;
    shown.push({ event, window, status });
  }
  const RANKS = { active: 0, upcoming: 1, ended: 2 } as const;
  const rank = (one: ScheduledEvent) => RANKS[one.status];
  return shown.sort((a, b) => rank(a) - rank(b) || a.window.startsAt - b.window.startsAt);
};
