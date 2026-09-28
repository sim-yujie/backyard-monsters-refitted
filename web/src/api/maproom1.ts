import { ApiError, get } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * The Map Room 1 read (issue #132): the four wild monster tribes with their
 * level and respawn time, the neighbour list and the caller's own protection,
 * in one call. Read-only; the screen re-asks every 15-20 s while it is on
 * screen, as the Flash map did (`PlayerLayer.as:88-90`, `:148`).
 *
 * The neighbour rows are `bm/neighbours/get`'s (`server/src/types/
 * NeighbourData.ts`, refreshed by `services/maproom/updateNeighbourData.ts`),
 * so only the fields the screen reads are typed and the rest are left to the
 * index signature.
 */
export const MAP_ROOM_1_PATH = "/api/:apiVersion/bm/maproom1";

/** `attackpermitted` on a neighbour (`server/src/enums/MapRoom.ts`, AttackPermission). */
export const AttackPermission = {
  ATTACKABLE: 1,
  HIGHER_LEVEL: 2,
  LEVEL_RESTRICTION: 3,
  VENGEANCE_MODE: 4,
  DAMAGE_PROTECTION: 5,
  /** Starter protection: a new player's first days. */
  SPECIAL_PROTECTION: 6,
  UNDER_ATTACK: 7,
  TRUCE_ACTIVE: 9,
} as const;

/**
 * One tribe as the route sends it (`services/maproom/v1/mapRoom1View.ts`;
 * `docs/server-api.md` "Map Room 1 read"). Always four, in the order
 * Legionnaire, Kozu, Abunakki, Dreadnaut.
 */
export interface MapRoom1TribeWire {
  /** A string, e.g. "3": sent back as-is on `wmview`, `wmattack` and `/base/save`. */
  baseid: string | number;
  /** "Legionnaire" | "Kozu" | "Abunakki" | "Dreadnaut"; the base id decides if absent. */
  tribe?: string;
  /** Pin level: your level -1, 0, +1, +2, at least 1. */
  level: number;
  /** 1 while wrecked. */
  destroyed?: number | boolean;
  /** Unix seconds a wrecked camp is back; 0 while it stands. */
  respawnAt?: number | null;
  /** Difficulty tier by Town Hall: "NEW" (1-2), "TH3", "TH4", "TH5", "HIGH" (6+). */
  tier?: string;
  /** The last attack's damage this tribe life, 0-100; 0 when fresh. */
  damage?: number;
  [key: string]: unknown;
}

/** One neighbour as `bm/neighbours/get` sends it. */
export interface MapRoom1NeighbourWire {
  userid: number;
  baseid: string | number;
  level: number;
  username?: string;
  basename?: string;
  /** Times the caller attacked them. */
  attacksto?: number;
  /** Times they attacked the caller. */
  attacksfrom?: number;
  /** Seed for the map position (`PlayerLayer.as:313`). */
  baseseed?: number;
  /** Last save, unix seconds; within 62 s means they are in their yard. */
  saved?: number;
  attackpermitted?: number;
  /** The attacker's name while `attackpermitted` is UNDER_ATTACK. */
  attacker?: string;
  pic?: string;
  /** `requested`, `accepted`, … (`server/src/enums/TruceStatus.ts`). */
  trucestate?: string;
  /** Seconds the truce has left. */
  truceexpire?: number;
  /** Unix seconds their damage protection ends; 0 without any. */
  protectedUntil?: number;
  [key: string]: unknown;
}

export interface MapRoom1Response extends ApiEnvelope {
  error: number;
  /** Server time, unix seconds. */
  now?: number;
  /** Your base level. */
  level?: number;
  tribes?: MapRoom1TribeWire[];
  neighbours?: MapRoom1NeighbourWire[];
  /** Your own damage protection end, unix seconds; 0 without any. */
  protectedUntil?: number;
}

/**
 * Why the route refused: `notMapRoom1` once the player's main save is on Map
 * Room 2 (a real 409, `errorDetails.data.reason`).
 */
export const NOT_MAP_ROOM_1 = "notMapRoom1";

/** The route's refusal reason off a thrown `ApiError`, or null. */
export const mapRoom1Refusal = (caught: unknown): string | null => {
  if (!(caught instanceof ApiError)) return null;
  const data = caught.details?.data;
  const reason =
    typeof data === "object" && data !== null
      ? (data as { reason?: unknown }).reason
      : undefined;
  return typeof reason === "string" ? reason : null;
};

/**
 * Reads the whole Map Room 1 screen. It also does what opening Flash's map
 * did (`docs/server-api.md` "Map Room 1 read"): stands wrecked tribes back up
 * after ten minutes and refreshes the neighbour cache.
 */
export const loadMapRoom1 = (): Promise<MapRoom1Response> =>
  get<MapRoom1Response>(MAP_ROOM_1_PATH);
