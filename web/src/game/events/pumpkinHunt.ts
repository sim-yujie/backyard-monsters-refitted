import type { EventView } from "@/api/events";

/**
 * The yard hunts' counts between reads of the events list: Halloween's
 * pumpkins and Thanksgiving's turkeys.
 *
 * Every find picked during a hunt raises the player's count on the server
 * (`server/src/controllers/yard/mushrooms.ts`), and the pick's answer says
 * the new count (`report.pumpkins` or `report.turkeys`). The pick passes it
 * on here, so the Events button's badge and the page's ladder
 * (`game/yard/plugins/events.ts`) can move at once rather than at the next read.
 */

/** The event kind whose ladder counts pumpkins (server `game-data/events/events.ts`). */
export const PUMPKIN_HUNT_KIND = "halloween";

/** The event kind whose ladder counts turkeys. */
export const TURKEY_HUNT_KIND = "thanksgiving";

type Listener = (count: number, kind: string) => void;
const listeners = new Set<Listener>();

/** A pick's answer said the count of the `kind` hunt is now `count`. */
export const noteHuntCount = (kind: string, count: number): void => {
  for (const listener of listeners) listener(count, kind);
};

/** A pick's answer said the pumpkin count is now `count`. */
export const notePumpkins = (count: number): void => noteHuntCount(PUMPKIN_HUNT_KIND, count);

/** Calls `listener` with each new count (and its hunt's kind). Returns the unsubscribe. */
export const onHuntCount = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Calls `listener` with each new pumpkin count. Returns the unsubscribe. */
export const onPumpkins = (listener: (count: number) => void): (() => void) =>
  onHuntCount((count, kind) => {
    if (kind === PUMPKIN_HUNT_KIND) listener(count);
  });

/** The list with the `kind` hunt's ladder counter raised to `count` (never lowered). */
export const withHuntCount = (events: readonly EventView[], kind: string, count: number): EventView[] =>
  events.map((event) =>
    event.kind === kind && event.status === "active" && event.ladder && event.ladder.counter < count
      ? { ...event, ladder: { ...event.ladder, counter: count } }
      : event,
  );

/** The list with the pumpkin hunt's ladder counter raised to `count` (never lowered). */
export const withPumpkinCount = (events: readonly EventView[], count: number): EventView[] =>
  withHuntCount(events, PUMPKIN_HUNT_KIND, count);
