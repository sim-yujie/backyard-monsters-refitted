import { eventsForcedOn } from "../../config/GameConfig.js";
import { EVENTS, type EventDefinition } from "../../game-data/events/events.js";
import { eventWindow, statusAt } from "../events/schedule.js";

/**
 * The yard's seasonal dress and the yard hunts: Halloween's pumpkins and
 * Thanksgiving's roaming turkeys.
 *
 * While a hunt's event runs, the yard's mushrooms grow as that event's finds
 * (pumpkins, or turkeys that wander about near where they grew), once an hour
 * instead of once per 17,280 s (`mushrooms.ts` `mushroomRespawnSeconds`),
 * every one picked counts toward the event's ladder
 * (`controllers/yard/mushrooms.ts`), and the web client dresses the yard for
 * it. The base load tells it which event kinds are on (`activeevents`,
 * `controllers/base/load/baseLoad.ts`).
 *
 * When an event is on is the events list's business
 * (`game-data/events/events.ts`, `services/events/schedule.ts`), including
 * `EVENTS_FORCE_ON` for local testing.
 */

/** A yard hunt: the event whose finds the yard grows, and the pick report's field for its count. */
export interface YardHunt {
  readonly event: string;
  /** The `MushroomPickReport` field that carries the player's count. */
  readonly field: "pumpkins" | "turkeys";
}

/** The event whose pumpkins the yard grows and counts. */
export const PUMPKIN_HUNT_EVENT = "halloween-2026";

/** The event whose roaming turkeys the yard grows and counts. */
export const TURKEY_HUNT_EVENT = "thanksgiving-2026";

/** Every yard hunt; the first one on wins if two ever overlap. */
export const YARD_HUNTS: readonly YardHunt[] = [
  { event: PUMPKIN_HUNT_EVENT, field: "pumpkins" },
  { event: TURKEY_HUNT_EVENT, field: "turkeys" },
];

const isOn = (event: EventDefinition, now: number, forced: ReadonlySet<string>): boolean =>
  statusAt(eventWindow(event, now, forced), now) === "active";

/** Forced events first (`EVENTS_FORCE_ON`), so a forced one wins over one that is really on. */
const forcedFirst = <T>(items: readonly T[], idOf: (item: T) => string, forced: ReadonlySet<string>): T[] => [
  ...items.filter((item) => forced.has(idOf(item))),
  ...items.filter((item) => !forced.has(idOf(item))),
];

/**
 * The kinds of the events on at `now`, for the web client (each kind once).
 * The client dresses the yard for the first kind that has a season, so a
 * forced event's kind comes first.
 */
export const activeEventKinds = (
  now: number,
  events: readonly EventDefinition[] = EVENTS,
  forced: ReadonlySet<string> = eventsForcedOn(process.env)
): string[] => [
  ...new Set(
    forcedFirst(events, (event) => event.id, forced)
      .filter((event) => isOn(event, now, forced))
      .map((event) => event.kind)
  ),
];

/** The yard hunt on at `now` (a forced one first), or null. */
export const yardHuntAt = (
  now: number,
  events: readonly EventDefinition[] = EVENTS,
  forced: ReadonlySet<string> = eventsForcedOn(process.env)
): YardHunt | null =>
  forcedFirst(YARD_HUNTS, (hunt) => hunt.event, forced).find((hunt) =>
    events.some((event) => event.id === hunt.event && isOn(event, now, forced))
  ) ?? null;

/** Whether any yard hunt (pumpkins or turkeys) is on at `now`: mushrooms then grow hourly. */
export const yardHuntOn = (
  now: number,
  events: readonly EventDefinition[] = EVENTS,
  forced: ReadonlySet<string> = eventsForcedOn(process.env)
): boolean => yardHuntAt(now, events, forced) !== null;

/** Whether the Halloween pumpkin hunt is on at `now`. */
export const pumpkinHuntOn = (
  now: number,
  events: readonly EventDefinition[] = EVENTS,
  forced: ReadonlySet<string> = eventsForcedOn(process.env)
): boolean => yardHuntAt(now, events, forced)?.event === PUMPKIN_HUNT_EVENT;
