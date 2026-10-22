import z from "zod";

import { EVENTS, eventById, type EventDefinition } from "../../game-data/events/events.js";
import { planGrant, type GrantedReward } from "../../services/events/grant.js";
import type { EventProgressStore } from "../../services/events/progressStore.js";
import {
  claimsUntil,
  eventWindow,
  nextUtcMidnight as nextDayAt,
  statusAt,
  utcDay,
} from "../../services/events/schedule.js";
import { yardBadRequestErr, yardRefusedErr } from "../../services/yard/yardErrors.js";
import { defineYardAction } from "./yardAction.js";

/**
 * The event claims (`game-data/events/events.ts`), as yard actions on the
 * main yard: each runs under the save row lock, records the claim in
 * `bym.event_progress` through the same transaction and pays through the
 * wrapper's outcome (`services/events/grant.ts`), so the claim and its
 * reward commit or roll back together. Bound to routes in `events.ts`; the
 * store is a parameter so tests run without a database.
 *
 * - `events/calendar/claim { event }`: today's calendar reward. One a UTC
 *   day; the next claim is the next day number, whenever the player comes
 *   back (a missed day is not lost, there are just fewer days left to reach
 *   the end). Refusals: `400 unknownEvent`, `409 eventNotActive {startsAt,
 *   endsAt}`, `409 claimedToday {nextAt}`, `409 calendarDone`.
 * - `events/ladder/claim { event, tier }`: one collection-ladder tier, once
 *   the counter reaches it, while the event is on or, for an event with
 *   `claimDays`, until that many days after its end (the counter stops at
 *   the end, so only a tier reached in time can be claimed then).
 *   Refusals: `400 unknownEvent`, `400 unknownTier`, `409 eventNotActive`,
 *   `409 tierClaimed`, `409 tierLocked {have, need}`. A tier paying Krallen
 *   at her top level is claimed and pays nothing (`granted` says
 *   `raised: false`).
 *
 * The report says which day or tier was paid and what each reward came to
 * (`granted`; resources after the storage cap).
 */

export const CalendarClaimSchema = z.object({ event: z.string().min(1).max(64) });
export const LadderClaimSchema = z.object({
  event: z.string().min(1).max(64),
  tier: z.coerce.number().int().min(0).max(999),
});

export interface CalendarClaimReport {
  event: string;
  /** The day paid, 1-based. */
  day: number;
  granted: GrantedReward[];
  /** When the next day can be claimed (unix s), or null after the last day. */
  nextAt: number | null;
}

export interface LadderClaimReport {
  event: string;
  tier: number;
  granted: GrantedReward[];
}

/**
 * The event, on now, or the refusal. `claims`: a ladder claim, which an event
 * with `claimDays` also takes for that long after it ends.
 */
const activeEvent = (
  id: string,
  now: number,
  events: readonly EventDefinition[],
  claims = false
): EventDefinition => {
  const event = eventById(id, events);
  if (!event) throw yardBadRequestErr("There is no such event.", { event: id }, "unknownEvent");
  const window = eventWindow(event, now);
  const status = statusAt(window, now);
  const open = status === "active" || (claims && status === "past" && now < claimsUntil(event, window));
  if (!open) {
    throw yardRefusedErr("eventNotActive", "That event is not on right now.", {
      event: id,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });
  }
  return event;
};

/** The two claim actions over `store` (and, for tests, a different event list). */
export const eventsActions = (store: EventProgressStore, events: readonly EventDefinition[] = EVENTS) => ({
  calendarClaim: defineYardAction({
    schema: CalendarClaimSchema,
    run: async ({ save, user, body, now, em }) => {
      const event = activeEvent(body.event, now, events);
      const calendar = event.calendar ?? [];
      if (calendar.length === 0) {
        throw yardBadRequestErr("That event has no calendar.", { event: event.id }, "unknownEvent");
      }

      const today = utcDay(now);
      const day = await store.claimCalendarDay(em, user.userid, event.id, today, calendar.length);
      if (day === null) {
        const progress = (await store.read(em, user.userid, [event.id])).get(event.id);
        if ((progress?.calendarDays ?? 0) >= calendar.length) {
          throw yardRefusedErr("calendarDone", "You have claimed every day of this calendar.", { event: event.id });
        }
        throw yardRefusedErr("claimedToday", "You have claimed today's reward. Come back tomorrow!", {
          event: event.id,
          nextAt: nextDayAt(now),
        });
      }

      const plan = planGrant(save, calendar[day - 1]!.rewards, now);
      const report: CalendarClaimReport = {
        event: event.id,
        day,
        granted: plan.granted,
        nextAt: day < calendar.length ? nextDayAt(now) : null,
      };
      return { report, credit: plan.credit, grantShiny: plan.grantShiny, slices: plan.slices };
    },
  }),

  ladderClaim: defineYardAction({
    schema: LadderClaimSchema,
    run: async ({ save, user, body, now, em }) => {
      const event = activeEvent(body.event, now, events, true);
      const tier = event.ladder?.tiers[body.tier];
      if (!tier) throw yardBadRequestErr("There is no such tier.", { event: event.id, tier: body.tier }, "unknownTier");

      if (!(await store.claimTier(em, user.userid, event.id, body.tier, tier.need))) {
        const progress = (await store.read(em, user.userid, [event.id])).get(event.id);
        if (progress?.claimedTiers.includes(body.tier)) {
          throw yardRefusedErr("tierClaimed", "You have claimed that reward already.", { event: event.id, tier: body.tier });
        }
        throw yardRefusedErr("tierLocked", "You have not collected enough for that reward yet.", {
          event: event.id,
          tier: body.tier,
          have: progress?.counter ?? 0,
          need: tier.need,
        });
      }

      const plan = planGrant(save, tier.rewards, now);
      const report: LadderClaimReport = { event: event.id, tier: body.tier, granted: plan.granted };
      return { report, credit: plan.credit, grantShiny: plan.grantShiny, slices: plan.slices };
    },
  }),
});
