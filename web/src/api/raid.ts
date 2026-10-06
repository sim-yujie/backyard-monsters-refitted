import type { RaidEvent, Roster } from "@/game/combat/rules";
import { ApiError, postJson } from "./http";
import type { ApiEnvelope, BuildingDataMap, BuildingHealthData, Resources } from "./types";

/**
 * Wild monster raids on the player's own yard (issue #226 WP4,
 * `docs/design/wild-raids.md` §4.2; wire contract in `docs/server-api.md`
 * "Wild monster raids").
 *
 * The presence ping opens a raid (`api/presence.ts`, its answer's `raid`);
 * these are the player's answers to it:
 *
 *   POST /api/:apiVersion/bm/raid/engage     { id }   "Engage now"
 *   POST /api/:apiVersion/bm/raid/prepare    { id }   "Prepare defences"
 *   POST /api/:apiVersion/bm/raid/start      { id }   the fight, fought by the server
 *   POST /api/:apiVersion/bm/raid/finish     { id }   the fight is over here; lands it
 *   POST /api/:apiVersion/bm/raid/frequency  { preference }
 *   POST /api/:apiVersion/bm/raid/dev/due    (local server only)
 *
 * Each is a real game action, so watching a raid keeps the player online.
 */

const RAID_PATH = "/api/:apiVersion/bm/raid";

/** An open raid as the server shows it: never its outcome. Times are unix seconds. */
export interface RaidView {
  readonly id: string;
  readonly phase: "warning" | "fighting";
  /** "Legionnaire", "Kozu", "Abunakki" or "Dreadnaut". */
  readonly tribe: string;
  /** The army, by monster id. */
  readonly monsters: Roster;
  /** When the fight is due; now or past once "Engage now" was pressed. */
  readonly attackAt: number;
  /** 1 once "Prepare defences" was pressed: the top bar counts down. */
  readonly warned: 0 | 1;
  readonly startedAt?: number;
  /** The earliest finish the server takes. */
  readonly finishFrom?: number;
}

/** What `/raid/start` hands over: the fight the server fought, to play again here. */
export interface RaidFight {
  readonly seed: number;
  readonly events: readonly RaidEvent[];
  /** The tick the server's fight ended on. */
  readonly tick: number;
  /** Its length at 1x, seconds. */
  readonly seconds: number;
  /** The yard as the fight found it. */
  readonly yard: {
    readonly buildingdata: BuildingDataMap;
    readonly buildinghealthdata: BuildingHealthData;
    readonly resources: Resources;
  };
  /** The player's bunkers, academy levels and caged champion (`parseDefenderForces`). */
  readonly defence: unknown;
}

/** What landed. */
export interface RaidResult {
  readonly id: string;
  readonly tribe: string;
  /** When the fight started. */
  readonly at: number;
  /** The yard held at 90% or more: +10 Shiny. */
  readonly defended: boolean;
  /** What is left of the yard, 0 to 1. */
  readonly health: number;
  /** What the raiders took, bank and harvesters together. */
  readonly stolen: { readonly r1: number; readonly r2: number; readonly r3: number; readonly r4: number };
  readonly shiny: number;
  /** Buildings left damaged, all repairing now. */
  readonly damaged: readonly number[];
  /** Housed monsters lost with fallen Housings. */
  readonly housedLost: number;
}

/** The frequency popup's three answers. */
export type RaidPreference = "more" | "same" | "less";

export interface RaidViewResponse extends ApiEnvelope {
  readonly raid: RaidView;
}

export interface RaidStartResponse extends ApiEnvelope {
  readonly raid: RaidView;
  readonly fight: RaidFight;
}

export interface RaidFinishResponse extends ApiEnvelope {
  readonly result: RaidResult;
}

export interface RaidFrequencyResponse extends ApiEnvelope {
  readonly preference: 1 | 0 | -1;
  readonly nextAttack: number;
}

export const engageRaid = (id: string): Promise<RaidViewResponse> =>
  postJson<RaidViewResponse>(`${RAID_PATH}/engage`, { id });

export const prepareRaid = (id: string): Promise<RaidViewResponse> =>
  postJson<RaidViewResponse>(`${RAID_PATH}/prepare`, { id });

export const startRaid = (id: string): Promise<RaidStartResponse> =>
  postJson<RaidStartResponse>(`${RAID_PATH}/start`, { id });

export const finishRaid = (id: string): Promise<RaidFinishResponse> =>
  postJson<RaidFinishResponse>(`${RAID_PATH}/finish`, { id });

export const setRaidFrequency = (preference: RaidPreference): Promise<RaidFrequencyResponse> =>
  postJson<RaidFrequencyResponse>(`${RAID_PATH}/frequency`, { preference });

/** DEV only: a local server makes the next raid due now. */
export const makeRaidDue = (): Promise<ApiEnvelope & { readonly nextAttack: number }> =>
  postJson<ApiEnvelope & { readonly nextAttack: number }>(`${RAID_PATH}/dev/due`);

/** The calls the raid screens make, as one object a test can replace. */
export interface RaidApi {
  engage(id: string): Promise<RaidViewResponse>;
  prepare(id: string): Promise<RaidViewResponse>;
  start(id: string): Promise<RaidStartResponse>;
  finish(id: string): Promise<RaidFinishResponse>;
  frequency(preference: RaidPreference): Promise<RaidFrequencyResponse>;
}

export const raidApi: RaidApi = {
  engage: engageRaid,
  prepare: prepareRaid,
  start: startRaid,
  finish: finishRaid,
  frequency: setRaidFrequency,
};

/** A refusal off a thrown `ApiError`: the reason, and `attackAt` or `readyAt` where the server named one. */
export interface RaidRefusal {
  readonly reason: string;
  readonly attackAt?: number;
  readonly readyAt?: number;
}

/** The route's refusal (`errorDetails.data`, `raidRefusedErr`), or null for any other failure. */
export const raidRefusal = (caught: unknown): RaidRefusal | null => {
  if (!(caught instanceof ApiError)) return null;
  const data = caught.details?.data;
  if (typeof data !== "object" || data === null) return null;
  const { reason, attackAt, readyAt } = data as { reason?: unknown; attackAt?: unknown; readyAt?: unknown };
  if (typeof reason !== "string") return null;
  return {
    reason,
    ...(typeof attackAt === "number" ? { attackAt } : {}),
    ...(typeof readyAt === "number" ? { readyAt } : {}),
  };
};

/** A presence answer's `raid`, checked; null when it is missing or not a raid. */
export const parseRaidView = (raw: unknown): RaidView | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const { id, phase, tribe, monsters, attackAt, warned } = value;
  if (typeof id !== "string" || (phase !== "warning" && phase !== "fighting")) return null;
  if (typeof tribe !== "string" || typeof attackAt !== "number" || !Number.isFinite(attackAt)) return null;
  const army: Record<string, number> = {};
  if (typeof monsters === "object" && monsters !== null) {
    for (const [monster, count] of Object.entries(monsters)) {
      if (typeof count === "number" && count > 0) army[monster] = count;
    }
  }
  return {
    id,
    phase,
    tribe,
    monsters: army,
    attackAt,
    warned: warned === 1 ? 1 : 0,
    ...(typeof value["startedAt"] === "number" ? { startedAt: value["startedAt"] } : {}),
    ...(typeof value["finishFrom"] === "number" ? { finishFrom: value["finishFrom"] } : {}),
  };
};
