import { eventsForcedOn } from "../../config/GameConfig.js";
import { EVENTS, type EventDefinition } from "../../game-data/events/events.js";
import { eventWindow, statusAt } from "../events/schedule.js";

/**
 * The yard's seasonal dress and the Halloween pumpkin hunt.
 *
 * While Halloween 2026 runs the yard's mushrooms grow as pumpkins, once an
 * hour instead of once per 17,280 s (`mushrooms.ts` `mushroomRespawnSeconds`),
 * every one picked counts toward the event's ladder
 * (`controllers/yard/mushrooms.ts`), and the web client dresses the yard for
 * it: dusky ground, pumpkins, a jack-o'-lantern for the golden one. The base
 * load tells it which event kinds are on (`activeevents`,
 * `controllers/base/load/baseLoad.ts`).
 *
 * When an event is on is the events list's business
 * (`game-data/events/events.ts`, `services/events/schedule.ts`), including
 * `EVENTS_FORCE_ON` for local testing.
 */

/** The event whose pumpkins the yard grows and counts. */
export const PUMPKIN_HUNT_EVENT = "halloween-2026";

const isOn = (event: EventDefinition, now: number, forced: ReadonlySet<string>): boolean =>
  statusAt(eventWindow(event, now, forced), now) === "active";

/** The kinds of the events on at `now`, for the web client (each kind once). */
export const activeEventKinds = (
  now: number,
  events: readonly EventDefinition[] = EVENTS,
  forced: ReadonlySet<string> = eventsForcedOn(process.env)
): string[] => [...new Set(events.filter((event) => isOn(event, now, forced)).map((event) => event.kind))];

/** Whether the Halloween pumpkin hunt is on at `now`. */
export const pumpkinHuntOn = (
  now: number,
  events: readonly EventDefinition[] = EVENTS,
  forced: ReadonlySet<string> = eventsForcedOn(process.env)
): boolean => events.some((event) => event.id === PUMPKIN_HUNT_EVENT && isOn(event, now, forced));
