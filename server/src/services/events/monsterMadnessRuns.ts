import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import type { EventDefinition } from "../../game-data/events/events.js";
import { MONSTER_MADNESS_DAYS, monsterMadnessRun } from "../../game-data/events/monsterMadness.js";
import { logger } from "../../utils/logger.js";

const DAY_SECONDS = 24 * 60 * 60;

/**
 * The Monster Madness runs the owner has started (`game-data/events/monsterMadness.ts`).
 * The event is on no calendar: a run exists only once the owner starts it from
 * the dashboard (`controllers/admin/monsterMadness.ts`). Kept in
 * `bym.game_setting` under {@link SETTING_KEY} as `{ runs: [{ startsAt,
 * endsAt }] }` (unix s, latest last), and held in memory so the events list,
 * the takeover and the claims read them without a query. The copy in memory
 * is read again every {@link REFRESH_MS} and at once on the server that made
 * the change. No row, or one not read yet: no run, the event is off.
 *
 * Stopping a run ends it now (its `endsAt` moves to now): its points stop
 * counting, and goals already reached can still be claimed for the claim days.
 */

export const SETTING_KEY = "monster_madness";

export const REFRESH_MS = 60_000;

/** At most this many runs are kept: older ones are long past their claims. */
export const MAX_RUNS = 12;

export interface MonsterMadnessRun {
  readonly startsAt: number;
  readonly endsAt: number;
}

let runs: readonly MonsterMadnessRun[] = [];
let meta: { updatedAt: string | null; updatedBy: number | null } = { updatedAt: null, updatedBy: null };

const whole = (raw: unknown): number | null => {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
};

/** The stored value's runs, each with a start before its end; anything else dropped. */
export const readRuns = (raw: unknown): MonsterMadnessRun[] => {
  const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  const list = value && typeof value === "object" ? (value as { runs?: unknown }).runs : null;
  if (!Array.isArray(list)) return [];
  return list.flatMap((one: unknown) => {
    const row = one && typeof one === "object" ? (one as Record<string, unknown>) : {};
    const startsAt = whole(row.startsAt);
    const endsAt = whole(row.endsAt);
    return startsAt !== null && endsAt !== null && endsAt > startsAt ? [{ startsAt, endsAt }] : [];
  });
};

/** The runs in memory. */
export const monsterMadnessRuns = (): readonly MonsterMadnessRun[] => runs;

/** When and by whom the runs were last changed, for the dashboard. */
export const monsterMadnessMeta = () => meta;

/** Replaces the runs in memory: tests, and after a read or a write. */
export const setMonsterMadnessRuns = (next: readonly MonsterMadnessRun[]): void => {
  runs = next;
};

/** The run on at `now`, or null. */
export const runningRun = (now: number, list: readonly MonsterMadnessRun[] = runs): MonsterMadnessRun | null =>
  list.find((run) => run.startsAt <= now && now < run.endsAt) ?? null;

/** Each run as an event, with its own id and its window (a stopped run ends when it was stopped). */
export const monsterMadnessEvents = (list: readonly MonsterMadnessRun[] = runs): EventDefinition[] =>
  list.map((run) => ({
    ...monsterMadnessRun(run.startsAt),
    endsAt: new Date(run.endsAt * 1000).toISOString().replace(".000Z", "Z"),
  }));

/** The runs after starting one at `now`: none while one is on. */
export const startRun = (list: readonly MonsterMadnessRun[], now: number): MonsterMadnessRun[] | null => {
  if (runningRun(now, list)) return null;
  // Two runs never share a start second: their ids would be the same.
  if (list.some((run) => run.startsAt === now)) return null;
  return [...list, { startsAt: now, endsAt: now + MONSTER_MADNESS_DAYS * DAY_SECONDS }].slice(-MAX_RUNS);
};

/** The runs after stopping the one on at `now`: null when none is on. */
export const stopRun = (list: readonly MonsterMadnessRun[], now: number): MonsterMadnessRun[] | null => {
  const on = runningRun(now, list);
  if (!on) return null;
  return list.map((run) => (run === on ? { startsAt: run.startsAt, endsAt: Math.max(now, run.startsAt + 1) } : run));
};

const sql = (em: EntityManager): SqlEntityManager => em as SqlEntityManager;

/** Reads the row into memory. A failed read keeps what was there. */
export const loadMonsterMadnessRuns = async (em: EntityManager): Promise<readonly MonsterMadnessRun[]> => {
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
    logger.warn("Monster Madness runs not read, keeping the last ones: {error}", { error: String(error) });
  }
  return runs;
};

/** Writes the runs and takes them into memory at once. */
export const saveMonsterMadnessRuns = async (
  em: EntityManager,
  next: readonly MonsterMadnessRun[],
  by: number
): Promise<void> => {
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
export const startMonsterMadnessRefresh = (em: () => EntityManager): void => {
  void loadMonsterMadnessRuns(em());
  if (timer) return;
  timer = setInterval(() => void loadMonsterMadnessRuns(em()), REFRESH_MS);
  timer.unref?.();
};
