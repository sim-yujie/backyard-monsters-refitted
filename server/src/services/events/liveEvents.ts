import { eventsForcedOn } from "../../config/GameConfig.js";
import { EVENTS, type EventDefinition } from "../../game-data/events/events.js";
import { MONSTER_MADNESS_ID, MONSTER_MADNESS_TEMPLATE } from "../../game-data/events/monsterMadness.js";
import { monsterMadnessEvents } from "./monsterMadnessRuns.js";

/**
 * Every event as the server sees it now: the calendar's ({@link EVENTS}) and
 * the Monster Madness runs the owner has started from the dashboard
 * (`monsterMadnessRuns.ts`), which are on no calendar. Locally,
 * `EVENTS_FORCE_ON=monster-madness` adds one more run, moved to today by
 * `eventWindow` like any forced event.
 */
export const liveEvents = (forced: ReadonlySet<string> = eventsForcedOn(process.env)): readonly EventDefinition[] => {
  const started = monsterMadnessEvents();
  const local = forced.has(MONSTER_MADNESS_ID) ? [MONSTER_MADNESS_TEMPLATE] : [];
  return started.length === 0 && local.length === 0 ? EVENTS : [...EVENTS, ...local, ...started];
};
