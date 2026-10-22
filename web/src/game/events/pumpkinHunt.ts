import type { EventView } from "@/api/events";

/**
 * The Halloween pumpkin hunt's count between reads of the events list.
 *
 * Every pumpkin picked during the event raises the player's count on the
 * server (`server/src/controllers/yard/mushrooms.ts`), and the pick's answer
 * says the new count (`report.pumpkins`). The pick passes it on here, so the
 * Events button's badge and the page's ladder (`game/yard/plugins/events.ts`)
 * move at once rather than at the next read.
 */

/** The event kind whose ladder counts pumpkins (server `game-data/events/events.ts`). */
export const PUMPKIN_HUNT_KIND = "halloween";

type Listener = (count: number) => void;
const listeners = new Set<Listener>();

/** A pick's answer said the count is now `count`. */
export const notePumpkins = (count: number): void => {
  for (const listener of listeners) listener(count);
};

/** Calls `listener` with each new count. Returns the unsubscribe. */
export const onPumpkins = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The list with the pumpkin hunt's ladder counter raised to `count` (never lowered). */
export const withPumpkinCount = (events: readonly EventView[], count: number): EventView[] =>
  events.map((event) =>
    event.kind === PUMPKIN_HUNT_KIND && event.status === "active" && event.ladder && event.ladder.counter < count
      ? { ...event, ladder: { ...event.ladder, counter: count } }
      : event,
  );
