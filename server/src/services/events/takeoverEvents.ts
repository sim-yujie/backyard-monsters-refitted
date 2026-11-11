import type { EntityManager } from "@mikro-orm/core";

import type { EventDefinition } from "../../game-data/events/events.js";
import { logger } from "../../utils/logger.js";
import { eventPlayerOf, lockedReason, type EventPlayerSave } from "./eventPlayer.js";
import { liveEvents } from "./liveEvents.js";
import { sqlProgressStore, type EventProgressStore } from "./progressStore.js";
import { eventWindow, statusAt } from "./schedule.js";

/**
 * Map Room 2 takeovers for the events that count them: every ladder whose
 * `source` is `"takeovers"` (Monster Madness, `game-data/events/monsterMadness.ts`).
 *
 * Called by the takeover (`controllers/maproom/v2/takeoverCell.ts`) after its
 * transaction has committed, so a counter that cannot be written is logged and
 * lost, never failing the takeover; and outside the save lock, as
 * `progressStore.ts` asks. Each outpost counts once per event, whoever held it
 * (`addTakeover`), so trading one back and forth scores once.
 *
 * What a takeover scores, as upstream's Monster Madness had it
 * (`services/events/monsterMadness/scoreOutpostTakeover.ts`,
 * `services/maproom/v2/tribeTakeoverValue.ts` there): a player's outpost its
 * empire value, worked out on the server from its buildings
 * (`maproom/v2/outpostValue.ts`); a wild tribe camp the empire value of a
 * player's outpost the client prices the same as it (`PopupTakeover.as:50-80`),
 * about 1.8 million at the lowest levels to about 3.2 million at level 44.
 */

/** The client's takeover price formulas (`PopupTakeover.as`), as `takeoverCost.ts` has them. */
const ROUND_TO = 250_000;
const MINIMUM_PRICE = 1_000_000;
const OUTPOST_SLOPE = 15_820_570.7;
const OUTPOST_INTERCEPT = -227_080_916.9;
const TRIBE_SLOPE = 562_500;
const TRIBE_INTERCEPT = -14_750_000;

/** What a tribe camp of `level` costs per resource, before half price and Conquest. */
const tribePrice = (level: number): number =>
  Math.max(Math.round((level * TRIBE_SLOPE + TRIBE_INTERCEPT) / ROUND_TO) * ROUND_TO, MINIMUM_PRICE);

/** A tribe camp's points: the empire value whose outpost price matches the camp's. */
export const tribeTakeoverPoints = (level: number): number =>
  Math.round(Math.exp((tribePrice(level) - OUTPOST_INTERCEPT) / OUTPOST_SLOPE));

/** The points one takeover scores: a tribe camp by its level, a player's outpost its empire value. */
export const takeoverPoints = (target: { tribe: boolean; level: number; empireValue: number }): number =>
  target.tribe ? tribeTakeoverPoints(target.level) : Math.max(0, Math.floor(target.empireValue) || 0);

/** The events that count takeovers and are on at `now`. */
export const takeoverEventsOn = (now: number, events: readonly EventDefinition[] = liveEvents()): EventDefinition[] =>
  events.filter((event) => event.ladder?.source === "takeovers" && statusAt(eventWindow(event, now), now) === "active");

export interface TakeoverScore {
  readonly event: string;
  /** What this takeover added (0 when the outpost had counted already). */
  readonly points: number;
  /** The player's points in the event now. */
  readonly total: number;
}

export interface CountTakeoverOptions {
  store?: EventProgressStore;
  events?: readonly EventDefinition[];
  skipTutorial?: boolean;
}

/**
 * Adds a takeover's points to every takeover event on now, for a player who
 * may take part. Returns what each event counted.
 *
 * @param userid - The player who took the outpost.
 * @param save - Their main save (guided start, Town Hall).
 * @param baseid - The outpost taken.
 * @param points - {@link takeoverPoints} of the outpost as it was before the takeover.
 */
export const countTakeover = async (
  em: EntityManager,
  userid: number,
  save: EventPlayerSave | null | undefined,
  baseid: string,
  points: number,
  now: number,
  options: CountTakeoverOptions = {}
): Promise<TakeoverScore[]> => {
  const scores: TakeoverScore[] = [];
  if (points <= 0) return scores;
  const events = takeoverEventsOn(now, options.events);
  if (events.length === 0) return scores;

  const player = eventPlayerOf(save, options.skipTutorial);
  const store = options.store ?? sqlProgressStore;
  for (const event of events) {
    if (lockedReason(event, player) !== null) continue;
    try {
      const total = await store.addTakeover(em, userid, event.id, String(baseid), points);
      if (total !== null) scores.push({ event: event.id, points, total });
    } catch (error) {
      logger.error("Could not count a takeover for {userid} in {eventId}: {error}", {
        event: "event-takeover-count-failed",
        userid,
        eventId: event.id,
        baseid,
        points,
        error: String(error),
      });
    }
  }
  return scores;
};
