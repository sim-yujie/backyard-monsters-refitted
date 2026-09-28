import { getSession } from "@/api/auth";
import type { BaseLoadResponse, BuildingDataMap } from "@/api/types";

/**
 * Which map a player's Map button opens (issue #162).
 *
 * A player who has moved to Map Room 2 keeps the hex world. Below it, the
 * Map Room building decides, as Flash's `GLOBAL.ShowMap` did
 * (`client/scripts/GLOBAL.as:1362-1376`, `MAPROOM.as:80-133`): a built Map
 * Room opens Map Room 1, and with none there is no map at all, only the way
 * to build one. Such a player is never sent to the Map Room 2 world: with
 * no home cell in it, every cell there says no flinger can reach it.
 */

export const MapRoomChoice = {
  /** No Map Room built: the Map button asks the player to build one. */
  NONE: "none",
  MAP_ROOM_1: "mr1",
  MAP_ROOM_2: "mr2",
} as const;
export type MapRoomChoice = (typeof MapRoomChoice)[keyof typeof MapRoomChoice];

/** Building type 11, the Map Room (`YARD_PROPS.as:1110-1168`). */
const MAP_ROOM_TYPE = 11;
/** The Map Room level that is Map Room 2 (D16). */
const MAP_ROOM_2_LEVEL = 2;

/**
 * The highest built Map Room level in a save's `buildingdata`; 0 when there
 * is none, or only one still on its first build (`cB`). A row without `l` is
 * level 1, as everywhere else the save is read.
 */
export const mapRoomLevelIn = (buildingdata: BuildingDataMap | null | undefined): number => {
  let level = 0;
  for (const row of Object.values(buildingdata ?? {})) {
    if (!row || row.t !== MAP_ROOM_TYPE) continue;
    if (typeof row.cB === "number" && row.cB > 0) continue;
    level = Math.max(level, typeof row.l === "number" ? row.l : 1);
  }
  return level;
};

export interface MapRoomFacts {
  /** The load's `flags`, whose `mr2upgraded` the server sets on the move. */
  readonly flags?: Record<string, unknown> | undefined;
  /** The highest built Map Room level ({@link mapRoomLevelIn}). */
  readonly mapRoomLevel: number;
}

/**
 * The map for these facts. Map Room 2 when the server says the player moved
 * (`flags.mr2upgraded`) or a level 2 Map Room stands in the yard: the server
 * finishes the move with that upgrade, and gives every save already on Map
 * Room 2 (`mapversion` 2, which the load does not send) a level 2 Map Room
 * (`server/src/services/yard/mapRoom.ts`). Map Room 1 for any other built
 * Map Room; none otherwise.
 *
 * A home cell is no sign of Map Room 2: a new account is placed in a world
 * when it is made, Town Hall 1 and all.
 */
export const mapRoomFor = (facts: MapRoomFacts): MapRoomChoice => {
  if (Number(facts.flags?.["mr2upgraded"]) > 0) return MapRoomChoice.MAP_ROOM_2;
  if (facts.mapRoomLevel >= MAP_ROOM_2_LEVEL) return MapRoomChoice.MAP_ROOM_2;
  if (facts.mapRoomLevel >= 1) return MapRoomChoice.MAP_ROOM_1;
  return MapRoomChoice.NONE;
};

/** {@link mapRoomFor} straight off an own-yard load. */
export const mapRoomOf = (save: BaseLoadResponse): MapRoomChoice =>
  mapRoomFor({ flags: save.flags, mapRoomLevel: mapRoomLevelIn(save.buildingdata) });

/** What the Map button says when there is no Map Room yet. */
export const NO_MAP_ROOM_TEXT =
  "Build a Map Room to see your neighbours and the wild monster tribes.";

/* ── The deciding load, handed on ──────────────────────────────────────── */

/**
 * How long a deciding load may stand in for the next screen's own. Long
 * enough for the switch, short enough that nothing stale is drawn.
 */
const PRIMED_MAX_AGE_MS = 15_000;

let primed: { userId: number | null; at: number; save: BaseLoadResponse } | null = null;

/**
 * Keeps the own-yard load that decided which map to open, so the map it
 * opens does not load the same yard a second time.
 */
export const primeOwnYard = (save: BaseLoadResponse, at = Date.now()): void => {
  primed = { userId: getSession()?.userId ?? null, at, save };
};

/**
 * Takes the primed own-yard load, once, when it is the signed-in account's
 * and still fresh; otherwise null and the caller loads its own.
 */
export const takePrimedOwnYard = (at = Date.now()): BaseLoadResponse | null => {
  const held = primed;
  primed = null;
  if (!held || held.userId !== (getSession()?.userId ?? null)) return null;
  return at - held.at <= PRIMED_MAX_AGE_MS ? held.save : null;
};
