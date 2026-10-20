/**
 * The yard's seasonal dress: which event, if any, re-skins the yard right now.
 *
 * During Halloween (`halloween-2026`, `server/src/game-data/events/events.ts`)
 * the ground turns dusky, the yard's mushrooms grow as pumpkins and the golden
 * one is a glowing jack-o'-lantern. Outside an event the season is `normal`
 * and everything looks as it always has.
 *
 * The server decides when an event is on (its clock, and `EVENTS_FORCE_ON`
 * in development); the client only follows what it is told, through
 * {@link setSeason}. Until it is told, the season is `normal`.
 */

export type Season = "normal" | "halloween";

/** The season an active event kind brings, or null if it brings none. */
const SEASON_BY_KIND: Readonly<Record<string, Season>> = { halloween: "halloween" };

/** The season the active events dress the yard in: the first that has one, else `normal`. */
export const seasonFor = (activeKinds: readonly string[]): Season => {
  for (const kind of activeKinds) {
    const season = SEASON_BY_KIND[kind];
    if (season) return season;
  }
  return "normal";
};

type Listener = (season: Season) => void;

let current: Season = "normal";
const listeners = new Set<Listener>();

/** The season now. */
export const currentSeason = (): Season => current;

/** Sets the season; listeners hear only a change. */
export const setSeason = (season: Season): void => {
  if (season === current) return;
  current = season;
  for (const listener of listeners) listener(season);
};

/** Calls `listener` on every change of season. Returns the unsubscribe. */
export const onSeasonChange = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * One mushroom (pumpkin) grows per this many seconds: once an hour in the
 * Halloween pumpkin hunt, else the usual 17,280 s. Mirrors
 * `server/src/services/yard/mushrooms.ts` `mushroomRespawnSeconds`.
 */
export const MUSHROOM_RESPAWN_SECONDS_BY_SEASON: Readonly<Record<Season, number>> = {
  normal: 17_280,
  halloween: 3_600,
};
