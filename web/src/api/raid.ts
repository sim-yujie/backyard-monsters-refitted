import type { WaveResult } from "./waves";
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
  /** The raid's threat (beta 10); absent for the Trojan Horse, Moloch and older raids. */
  readonly threat?: number;
  /** How many sides it lands from (beta 10); absent 1. */
  readonly sides?: number;
  /** The wild champion it brings (beta 10): its type (1-4) and level. */
  readonly champion?: { readonly t: number; readonly l: number };
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
  /** A wave event's wave (beta 10): its own result. */
  readonly wave?: WaveResult;
  /** The threat this raid came at and the next raid's (beta 10); wild raids only. */
  readonly threat?: number;
  readonly nextThreat?: number;
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
    ...wholeField(value, "threat", 0),
    ...wholeField(value, "sides", 2),
    ...parseChampion(value["champion"]),
  };
};

/** `{ [key]: n }` for a whole number at least `least`, else nothing. */
const wholeField = <K extends string>(value: Record<string, unknown>, key: K, least: number): Partial<Record<K, number>> => {
  const n = value[key];
  return typeof n === "number" && Number.isInteger(n) && n >= least ? ({ [key]: n } as Record<K, number>) : {};
};

/** A raid's wild champion, checked: type 1-5 and level 1-6. */
const parseChampion = (raw: unknown): { champion?: { t: number; l: number } } => {
  if (typeof raw !== "object" || raw === null) return {};
  const { t, l } = raw as { t?: unknown; l?: unknown };
  if (typeof t !== "number" || !Number.isInteger(t) || t < 1 || t > 5) return {};
  if (typeof l !== "number" || !Number.isInteger(l) || l < 1 || l > 6) return {};
  return { champion: { t, l } };
};
