import type { RaidFight, RaidResult, RaidView } from "./raid";
import { get, postJson } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * The wave event on now (beta 10: Wild Monster Invasion, later Blitzkrieg,
 * Brukkarg War's waves and Christmas; server `services/events/waves/`).
 *
 *   GET  /api/:apiVersion/bm/events/wave       → { wave: WaveStatus | null }
 *   POST /api/:apiVersion/bm/events/wave/next  → { raid, fight, wave }
 *
 * "Next wave" answers as `/raid/start` does, so the raid scene plays it; it
 * lands through `/raid/finish`, whose result carries {@link WaveResult}.
 */

/** One monster of the next wave (`G1`-`G3` for a champion), for the preview. */
export interface WavePreviewGroup {
  readonly monster: string;
  readonly count: number;
}

export interface WaveStatus {
  /** The event's key (`wmi1`, `wmi2`). */
  readonly event: string;
  readonly title: string;
  readonly run: string;
  /** Unix seconds the run ends. */
  readonly endsAt: number;
  readonly waves: number;
  readonly firstBonusWave: number;
  readonly beaten: number;
  readonly lost: number;
  /** The wave "Next wave" calls, or null once every wave is beaten. */
  readonly next: number | null;
  /** The next wave's monsters; empty for a bonus wave (a secret). */
  readonly preview: readonly WavePreviewGroup[];
  readonly size: number;
  readonly prize: { readonly glimmers: number; readonly totemLevel?: number } | null;
  readonly totemType: number | null;
  readonly totemLevel: number;
  readonly banner: { readonly modern: string; readonly classic: string };
}

/** A landed wave, on the raid's result (`RaidResult.wave`). */
export interface WaveResult {
  readonly event: string;
  readonly run: string;
  readonly wave: number;
  readonly waves: number;
  readonly firstBonusWave: number;
  /** Absent from a result landed before it was sent. */
  readonly totemType?: number | null;
  readonly beaten: boolean;
  readonly surrendered: boolean;
  readonly next: number | null;
  readonly glimmers: number;
  readonly totem?: { readonly type: number; readonly level: number; readonly placed: boolean };
}

export interface WaveStatusResponse extends ApiEnvelope {
  readonly wave: WaveStatus | null;
}

export interface WaveNextResponse extends ApiEnvelope {
  readonly raid: RaidView;
  readonly fight: RaidFight;
  readonly wave: WaveStatus;
}

export const getWaveStatus = (): Promise<WaveStatusResponse> => get<WaveStatusResponse>("/api/:apiVersion/bm/events/wave");

export const nextWave = (): Promise<WaveNextResponse> => postJson<WaveNextResponse>("/api/:apiVersion/bm/events/wave/next");

/** The calls the wave HUD makes, as one object a test can replace. */
export interface WaveApi {
  status(): Promise<WaveStatusResponse>;
  next(): Promise<WaveNextResponse>;
}

export const waveApi: WaveApi = { status: getWaveStatus, next: nextWave };

/** "Wave 7", "Bonus wave 1". */
export const waveName = (wave: number, firstBonusWave: number): string =>
  wave >= firstBonusWave ? `Bonus wave ${wave - firstBonusWave + 1}` : `Wave ${wave}`;

export interface WaveSurrenderResponse extends ApiEnvelope {
  readonly result: RaidResult;
}

/** Surrender: the wave lost, landing only the damage done up to `tick` (owner's pick A). */
export const surrenderWave = (id: string, tick: number): Promise<WaveSurrenderResponse> =>
  postJson<WaveSurrenderResponse>("/api/:apiVersion/bm/events/wave/surrender", { id, tick: Math.max(0, Math.floor(tick)) });
