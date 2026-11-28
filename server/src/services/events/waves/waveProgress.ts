import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import { noteEventPlayer } from "../../stats/activity.js";

/**
 * A player's place in a wave event run, on `bym.event_progress` (the events'
 * own table, keyed by the run's id, `waveRuns.ts` `runId`): `counter` is the
 * waves beaten, so the next wave is `counter + 1`; `data.lost` counts lost
 * waves (retries and surrenders). Flash kept the same in its `wmi_wave` stat.
 */

export interface WaveProgress {
  /** Waves beaten: the next wave to call is `beaten + 1`. */
  readonly beaten: number;
  /** Waves lost or surrendered. */
  readonly lost: number;
}

export const NO_WAVE_PROGRESS: WaveProgress = { beaten: 0, lost: 0 };

export interface WaveProgressStore {
  read(em: EntityManager, userid: number, runId: string): Promise<WaveProgress>;
  /**
   * Records wave `wave` beaten, only when it is the next one (`beaten` is
   * `wave - 1`). Returns whether it was recorded: a wave counts once.
   */
  beat(em: EntityManager, userid: number, runId: string, wave: number): Promise<boolean>;
  /** Records a lost wave. */
  lose(em: EntityManager, userid: number, runId: string): Promise<void>;
}

const sql = (em: EntityManager): SqlEntityManager => em as SqlEntityManager;

const count = (raw: unknown): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
};

export const sqlWaveProgressStore: WaveProgressStore = {
  async read(em, userid, runId) {
    const [row] = await sql(em).execute<{ counter: number | string; data: unknown }[]>(
      `SELECT counter, data FROM bym.event_progress WHERE userid = ? AND event_id = ?`,
      [userid, runId]
    );
    if (!row) return NO_WAVE_PROGRESS;
    const data = (typeof row.data === "string" ? JSON.parse(row.data) : row.data) as { lost?: unknown } | null;
    return { beaten: count(row.counter), lost: count(data?.lost) };
  },

  async beat(em, userid, runId, wave) {
    if (!Number.isInteger(wave) || wave < 1) return false;
    const rows = await sql(em).execute<{ counter: number }[]>(
      wave === 1
        ? `INSERT INTO bym.event_progress AS p (userid, event_id, counter) VALUES (?, ?, 1)
           ON CONFLICT (userid, event_id) DO UPDATE SET counter = 1, updated_at = now()
            WHERE p.counter = 0
           RETURNING counter`
        : `UPDATE bym.event_progress SET counter = ?, updated_at = now()
            WHERE userid = ? AND event_id = ? AND counter = ?
           RETURNING counter`,
      wave === 1 ? [userid, runId] : [wave, userid, runId, wave - 1]
    );
    if (rows.length > 0) noteEventPlayer(runId, userid);
    return rows.length > 0;
  },

  async lose(em, userid, runId) {
    await sql(em).execute(
      `INSERT INTO bym.event_progress AS p (userid, event_id, data) VALUES (?, ?, '{"lost":1}'::jsonb)
       ON CONFLICT (userid, event_id) DO UPDATE
          SET data = p.data || jsonb_build_object('lost', COALESCE((p.data->>'lost')::int, 0) + 1), updated_at = now()`,
      [userid, runId]
    );
    noteEventPlayer(runId, userid);
  },
};

/** An in-memory store for tests. */
export const memoryWaveProgressStore = (): WaveProgressStore & { rows: Map<string, WaveProgress> } => {
  const rows = new Map<string, WaveProgress>();
  const key = (userid: number, runId: string) => `${userid}:${runId}`;
  return {
    rows,
    async read(_em, userid, runId) {
      return rows.get(key(userid, runId)) ?? NO_WAVE_PROGRESS;
    },
    async beat(_em, userid, runId, wave) {
      const now = rows.get(key(userid, runId)) ?? NO_WAVE_PROGRESS;
      if (now.beaten !== wave - 1) return false;
      rows.set(key(userid, runId), { ...now, beaten: wave });
      return true;
    },
    async lose(_em, userid, runId) {
      const now = rows.get(key(userid, runId)) ?? NO_WAVE_PROGRESS;
      rows.set(key(userid, runId), { ...now, lost: now.lost + 1 });
    },
  };
};

let current: WaveProgressStore = sqlWaveProgressStore;
export const waveProgressStore = (): WaveProgressStore => current;
/** Swaps the store (tests); returns the one it replaced. */
export const useWaveProgressStore = (store: WaveProgressStore): WaveProgressStore => {
  const before = current;
  current = store;
  return before;
};
