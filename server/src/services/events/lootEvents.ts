import type { EntityManager } from "@mikro-orm/core";

import { EVENTS, type EventDefinition } from "../../game-data/events/events.js";
import type { ResourceAmounts } from "../../game-rules/combat/index.js";
import { logger } from "../../utils/logger.js";
import { RESOURCE_KEYS } from "../base/economy/resourceBudget.js";
import { eventPlayerOf, lockedReason, type EventPlayerSave } from "./eventPlayer.js";
import { sqlProgressStore, type EventProgressStore } from "./progressStore.js";
import { eventWindow, statusAt } from "./schedule.js";

/**
 * Attack loot for the events that count it: every ladder whose `source` is
 * `"attackLoot"` (the monthly Krallen Hunt, `game-data/events/events.ts`).
 *
 * Called where an attack's loot lands on the attacker, once per attack:
 * the save that ends an attack (`controllers/base/save/baseSave.ts`), the
 * finaliser that lands an abandoned attack or an auto-attack
 * (`services/base/finaliseAttack.ts`) and the save that ends a Map Room 1
 * tribe attack (`services/maproom/v1/scaledMR1Tribes.ts`). Each holds the
 * attack's final lock and ends the attack before letting go, so an attack
 * adds its loot once. Raids on players, wild monster camps and tribes all
 * pass there; outpost income does not (`maproom/v2/autobank.ts`).
 *
 * What counts is the battle's credit before the storage cap
 * (`bankAttackLoot` fits it afterwards): Twigs, Pebbles, Putty and Goo added
 * up, loot that did not fit included. Only at the moment the loot lands
 * inside the event's window, and only for a player who may take part
 * (`EventDefinition.requires`, read off the main yard).
 *
 * Runs after the attack's rows are written, outside their flush, and never
 * fails the attack: a counter that cannot be written is logged and lost.
 */

/** The events that count attack loot and are on at `now`. */
export const lootEventsOn = (now: number, events: readonly EventDefinition[] = EVENTS): EventDefinition[] =>
  events.filter((event) => event.ladder?.source === "attackLoot" && statusAt(eventWindow(event, now), now) === "active");

/** Twigs, Pebbles, Putty and Goo added up, each a whole amount of at least 0. */
export const lootTotal = (credit: Partial<ResourceAmounts> | null | undefined): number => {
  let total = 0;
  for (const key of RESOURCE_KEYS) {
    const value = Number(credit?.[key]);
    if (Number.isFinite(value) && value > 0) total += Math.floor(value);
  }
  return total;
};

export interface CountLootOptions {
  store?: EventProgressStore;
  events?: readonly EventDefinition[];
  /** Off production the guided start counts as done (`eventPlayerOf`). */
  skipTutorial?: boolean;
}

/**
 * Adds an attack's loot to every attack-loot event on now, for a player who
 * may take part. Returns the new counter of each event counted, by id.
 *
 * @param userid - The attacker.
 * @param save - The attacker's main save (Town Hall, guided start).
 * @param credit - The battle's credit, before the storage cap.
 */
export const countAttackLoot = async (
  em: EntityManager,
  userid: number,
  save: EventPlayerSave | null | undefined,
  credit: Partial<ResourceAmounts> | null | undefined,
  now: number,
  options: CountLootOptions = {}
): Promise<Map<string, number>> => {
  const counted = new Map<string, number>();
  const total = lootTotal(credit);
  if (total <= 0) return counted;
  const events = lootEventsOn(now, options.events);
  if (events.length === 0) return counted;

  const player = eventPlayerOf(save, options.skipTutorial);
  const store = options.store ?? sqlProgressStore;
  for (const event of events) {
    if (lockedReason(event, player) !== null) continue;
    try {
      counted.set(event.id, await store.addToCounter(em, userid, event.id, total));
    } catch (error) {
      logger.error("Could not count attack loot for {userid} in {event}: {error}", {
        event: "event-loot-count-failed",
        userid,
        eventId: event.id,
        total,
        error: String(error),
      });
    }
  }
  return counted;
};
