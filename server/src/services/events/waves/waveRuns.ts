import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import { logger } from "../../../utils/logger.js";
import { WAVE_EVENTS, waveEventByKey } from "./waveEvents.js";
import type { WaveEventDefinition } from "./waveTypes.js";

const DAY_SECONDS = 24 * 60 * 60;

/**
 * The wave event runs the owner has started from the dashboard (beta 10,
 * owner 27 Nov 2026: started and stopped by hand, like Monster Madness, one
 * wave event at a time). The generic event control: every event in
 * `waveEvents.ts` is started and stopped here.
 *
 * Kept in `bym.game_setting` under {@link SETTING_KEY} as `{ runs: [{ event,
 * startsAt, endsAt }] }` (unix s, latest last) and held in memory, read again
 * every {@link REFRESH_MS} and at once on the server that made the change
 * (`monsterMadnessRuns.ts`'s pattern). Stopping a run ends it now.
 */

export const SETTING_KEY = "wave_events";
export const REFRESH_MS = 60_000;
/** Older runs are dropped past this many. */
export const MAX_RUNS = 20;

export interface WaveRun {
  /** The event's key (`wmi1`). */
  readonly event: string;
  readonly startsAt: number;
  readonly endsAt: number;
}

/** A run's id: the players' progress rows' key, `wmi1-1764230400`. */
export const runId = (run: Pick<WaveRun, "event" | "startsAt">): string => `${run.event}-${Math.floor(run.startsAt)}`;

let runs: readonly WaveRun[] = [];
let meta: { updatedAt: string | null; updatedBy: number | null } = { updatedAt: null, updatedBy: null };

const whole = (raw: unknown): number | null => {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
};

/** The stored value's runs, each of a known event with a start before its end; anything else dropped. */
export const readRuns = (raw: unknown): WaveRun[] => {
  const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  const list = value && typeof value === "object" ? (value as { runs?: unknown }).runs : null;
  if (!Array.isArray(list)) return [];
  return list.flatMap((one: unknown) => {
    const row = one && typeof one === "object" ? (one as Record<string, unknown>) : {};
    const event = typeof row.event === "string" && waveEventByKey(row.event) ? row.event : null;
    const startsAt = whole(row.startsAt);
    const endsAt = whole(row.endsAt);
    return event && startsAt !== null && endsAt !== null && endsAt > startsAt ? [{ event, startsAt, endsAt }] : [];
  });
};

export const waveRuns = (): readonly WaveRun[] => runs;
export const waveRunsMeta = () => meta;
export const setWaveRuns = (next: readonly WaveRun[]): void => {
  runs = next;
};

/** The run on at `now` (any event), or null: only one at a time. */
export const runningWaveRun = (now: number, list: readonly WaveRun[] = runs): WaveRun | null =>
  list.find((run) => run.startsAt <= now && now < run.endsAt) ?? null;

/** The live run and its event, or null. */
export const liveWaveEvent = (now: number, list: readonly WaveRun[] = runs): { run: WaveRun; event: WaveEventDefinition } | null => {
  const run = runningWaveRun(now, list);
  const event = run ? waveEventByKey(run.event) : null;
  return run && event ? { run, event } : null;
};

export type StartRefusal = "unknownEvent" | "alreadyRunning";

/** The runs after starting `key` at `now` for `days` (the event's own when absent), or why not. */
export const startWaveRun = (
  list: readonly WaveRun[],
  key: string,
  now: number,
  days?: number
): WaveRun[] | StartRefusal => {
  const event = waveEventByKey(key);
  if (!event) return "unknownEvent";
  if (runningWaveRun(now, list)) return "alreadyRunning";
  const length = Math.max(1, Math.min(30, Math.floor(days ?? event.days))) * DAY_SECONDS;
  // A second run of one event never shares a start second: their ids would match.
  const startsAt = list.some((run) => run.event === key && run.startsAt === now) ? now + 1 : now;
  return [...list, { event: key, startsAt, endsAt: startsAt + length }].slice(-MAX_RUNS);
};

/** The runs after stopping the one on at `now`: null when none is on. */
export const stopWaveRun = (list: readonly WaveRun[], now: number): WaveRun[] | null => {
  const on = runningWaveRun(now, list);
  if (!on) return null;
  return list.map((run) => (run === on ? { ...run, endsAt: Math.max(now, run.startsAt + 1) } : run));
};

/** Each event with its last run, for the dashboard. */
export const waveEventsPanel = (now: number, list: readonly WaveRun[] = runs) => ({
  now,
  running: runningWaveRun(now, list),
  events: WAVE_EVENTS.map((event) => ({
    key: event.key,
    title: event.title,
    days: event.days,
    waves: event.waves.length,
    last: [...list].reverse().find((run) => run.event === event.key) ?? null,
  })),
  ...meta,
});

const sql = (em: EntityManager): SqlEntityManager => em as SqlEntityManager;

/** Reads the row into memory. A failed read keeps what was there. */
export const loadWaveRuns = async (em: EntityManager): Promise<readonly WaveRun[]> => {
  try {
    const [row] = await sql(em).execute<{ value: unknown; updated_at: Date | string | null; updated_by: number | null }[]>(
      `SELECT value, updated_at, updated_by FROM bym.game_setting WHERE key = ?`,
      [SETTING_KEY]
    );
    runs = row ? readRuns(row.value) : [];
    meta = {
      updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
      updatedBy: row?.updated_by ?? null,
    };
  } catch (error) {
    logger.warn("Wave event runs not read, keeping the last ones: {error}", { error: String(error) });
  }
  return runs;
};

/** Writes the runs and takes them into memory at once. */
export const saveWaveRuns = async (em: EntityManager, next: readonly WaveRun[], by: number): Promise<void> => {
  await sql(em).execute(
    `INSERT INTO bym.game_setting (key, value, updated_at, updated_by) VALUES (?, ?::jsonb, now(), ?)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [SETTING_KEY, JSON.stringify({ runs: next }), by]
  );
  runs = next;
  meta = { updatedAt: new Date().toISOString(), updatedBy: by };
};

let timer: ReturnType<typeof setInterval> | null = null;

/** Reads the runs now and every {@link REFRESH_MS}. */
export const startWaveRunsRefresh = (em: () => EntityManager): void => {
  void loadWaveRuns(em());
  if (timer) return;
  timer = setInterval(() => void loadWaveRuns(em()), REFRESH_MS);
  timer.unref?.();
};
