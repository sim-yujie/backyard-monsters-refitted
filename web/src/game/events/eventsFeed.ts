import type { EventView } from "@/api/events";
import type { ServerClock } from "./eventsModel";

/**
 * The events list the Events button last read (`GET /bm/events`, the yard's
 * events plugin), with the server clock it came with, for other pieces of the
 * yard that show an event's time (the reset clock's Krallen Hunt row) without
 * a second read. Lives as long as the page; null until the first read.
 */

let events: readonly EventView[] | null = null;
let clock: ServerClock | null = null;

/** Takes the list the Events button just read and its server clock. */
export const setEventsFeed = (next: readonly EventView[], nextClock: ServerClock): void => {
  events = next;
  clock = nextClock;
};

/** The last list read, or null before the first. */
export const eventsFeed = (): readonly EventView[] | null => events;

/** The server clock that came with it, or null before the first read. */
export const eventsFeedClock = (): ServerClock | null => clock;

/** For tests: back to nothing read. */
export const resetEventsFeed = (): void => {
  events = null;
  clock = null;
};
