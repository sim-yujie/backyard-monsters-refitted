import { Env } from "../../enums/Env.js";

/**
 * The yard's seasonal dress and the Halloween pumpkin hunt.
 *
 * While Halloween 2026 runs the yard's mushrooms grow as pumpkins, once an
 * hour instead of once per 17,280 s (`mushrooms.ts` `mushroomRespawnSeconds`),
 * and the web client dresses the yard for it: dusky ground, pumpkins, a
 * jack-o'-lantern for the golden one. The base load tells it which event
 * kinds are on (`activeevents`, `controllers/base/load/baseLoad.ts`).
 *
 * The window matches `halloween-2026` in the events list. `EVENTS_FORCE_ON`
 * switches it on locally from today's UTC midnight for its usual length,
 * as the events framework does; never on production.
 */

export interface SeasonalEvent {
  readonly id: string;
  /** What the web client dresses the yard by (`web/src/game/season.ts`). */
  readonly kind: string;
  /** UTC, ISO 8601. */
  readonly startsAt: string;
  /** UTC, ISO 8601; the first moment it is over. */
  readonly endsAt: string;
}

export const HALLOWEEN_2026: SeasonalEvent = {
  id: "halloween-2026",
  kind: "halloween",
  startsAt: "2026-10-28T00:00:00Z",
  endsAt: "2026-11-11T00:00:00Z",
};

export const SEASONAL_EVENTS: readonly SeasonalEvent[] = [HALLOWEEN_2026];

const DAY_SECONDS = 24 * 60 * 60;
const seconds = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/** Event ids forced on for local testing (`EVENTS_FORCE_ON=id[,id…]`); empty on production. */
export const forcedEvents = (env: Record<string, string | undefined> = process.env): ReadonlySet<string> =>
  env.ENV === Env.PROD
    ? new Set()
    : new Set(
        (env.EVENTS_FORCE_ON ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      );

/** Whether `event` is on at `now` (unix seconds). */
export const seasonalEventOn = (
  event: SeasonalEvent,
  now: number,
  forced: ReadonlySet<string> = forcedEvents()
): boolean => {
  let startsAt = seconds(event.startsAt);
  let endsAt = seconds(event.endsAt);
  if (forced.has(event.id)) {
    const length = endsAt - startsAt;
    startsAt = Math.floor(now / DAY_SECONDS) * DAY_SECONDS;
    endsAt = startsAt + length;
  }
  return now >= startsAt && now < endsAt;
};

/** The kinds of the seasonal events on at `now`, for the web client. */
export const activeEventKinds = (now: number, forced: ReadonlySet<string> = forcedEvents()): string[] =>
  SEASONAL_EVENTS.filter((event) => seasonalEventOn(event, now, forced)).map((event) => event.kind);

/** Whether the Halloween pumpkin hunt is on at `now`. */
export const pumpkinHuntOn = (now: number, forced: ReadonlySet<string> = forcedEvents()): boolean =>
  seasonalEventOn(HALLOWEEN_2026, now, forced);
