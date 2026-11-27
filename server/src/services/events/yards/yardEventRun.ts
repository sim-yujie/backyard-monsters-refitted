import type { EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import type { EventDefinition } from "../../../game-data/events/events.js";
import { yardEventByKey, YARD_EVENTS, type YardEventDefinition } from "../../../game-data/events/yardEvents.js";
import type { YardEventKey } from "../../../game-data/tribes/events/index.js";
import { logger } from "../../../utils/logger.js";

/**
 * Which Brukkarg attack event runs now: the ONE place the yard events read
 * their run from (bruk-port, beta 10).
 *
 * ── THE HOOK (for whoever merges this after `feat/wave-events`) ──────────
 * The owner starts and stops events from the dashboard's generic event
 * control, one event at a time, which `feat/wave-events` builds
 * (`services/events/waves/waveRuns.ts`, `controllers/admin/waveEvents.ts`,
 * `web/src/admin/waveEvents.ts`). Once it is in:
 *
 * 1. Register both events in its `WAVE_EVENTS` (`waves/waveEvents.ts`):
 *    `{ key: "carnage", waves: [], prizes: [], ... }` and `{ key: "brukwar",
 *    waves: BRUKWAR_WAVES, prizes: <25 wave prizes>, ... }`, with the titles,
 *    words, days and banners of {@link YARD_EVENTS}. Its dashboard box then
 *    lists them, `liveWaveEvent(now)` covers them and its Events page entry
 *    (`waveRunEvents`) shows them.
 * 2. Replace this file's store with wave-events' runs, ENDED ONES TOO:
 *    `yardEventRuns = () => waveRuns().filter((run) => isYardEventKey(run.event))`
 *    (the same `{ event, startsAt, endsAt }` shape), so that
 *    {@link liveYardEventRun} AND {@link yardRunIdAt} read them. The landing
 *    and the rowless finaliser find an attack's run with `yardRunIdAt` from
 *    its start time, also after the run ended: an empty list there makes
 *    every event yard save fail (`eventYardGone`) and the finaliser drop the
 *    attack. Then `yardEventRunEvents = () => []` (wave-events' own Events
 *    entry shows the run) and drop {@link startYardEventRefresh} from `server.ts`.
 * 3. `brukwarWavesBeaten` (`yardEventGate.ts`) reads
 *    `waveProgressStore().read(em, userid, runId).beaten`.
 * The run id is the same here and there: `<key>-<startsAt>`, so the players'
 * progress rows carry over.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Until then a run is kept as Monster Madness keeps its runs
 * (`monsterMadnessRuns.ts`): in `bym.game_setting` under {@link SETTING_KEY}
 * as `{ runs: [{ event, startsAt, endsAt }] }` (the wave runs' shape), held
 * in memory and read again every minute. There is no dashboard box for it on
 * purpose: `scripts/yardEventRun.ts start carnage` starts one locally.
 */

export const SETTING_KEY = "yard_events";
export const REFRESH_MS = 60_000;
const MAX_RUNS = 20;
const DAY_SECONDS = 24 * 60 * 60;

export interface YardEventRun {
  readonly event: YardEventKey;
  readonly startsAt: number;
  readonly endsAt: number;
}

/** A run's id, the key of its players' progress rows: `carnage-1764230400` (as `waveRuns.ts` `runId`). */
export const yardRunId = (run: Pick<YardEventRun, "event" | "startsAt">): string => `${run.event}-${Math.floor(run.startsAt)}`;

export const isYardEventKey = (key: unknown): key is YardEventKey => typeof key === "string" && yardEventByKey(key) !== null;

let runs: readonly YardEventRun[] = [];

const whole = (raw: unknown): number | null => {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
};

/** The stored value's runs, each of a known event with a start before its end. */
export const readYardRuns = (raw: unknown): YardEventRun[] => {
  const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  const list = value && typeof value === "object" ? (value as { runs?: unknown }).runs : null;
  if (!Array.isArray(list)) return [];
  return list.flatMap((one: unknown) => {
    const row = one && typeof one === "object" ? (one as Record<string, unknown>) : {};
    const startsAt = whole(row.startsAt);
    const endsAt = whole(row.endsAt);
    return isYardEventKey(row.event) && startsAt !== null && endsAt !== null && endsAt > startsAt
      ? [{ event: row.event, startsAt, endsAt }]
      : [];
  });
};

export const yardEventRuns = (): readonly YardEventRun[] => runs;

/** Replaces the runs in memory: tests, and after a read or a write. */
export const setYardEventRuns = (next: readonly YardEventRun[]): void => {
  runs = next;
};

/** The run on at `now` and its event, or null. */
export const liveYardEventRun = (
  now: number,
  list: readonly YardEventRun[] = runs
): { run: YardEventRun; event: YardEventDefinition; id: string } | null => {
  const run = list.find((one) => one.startsAt <= now && now < one.endsAt);
  const event = run ? yardEventByKey(run.event) : null;
  return run && event ? { run, event, id: yardRunId(run) } : null;
};

/**
 * The id of the run of `key` that covered `at` (an attack's start), so an
 * attack lands on the run it began in even after that run ended; the
 * latest run begun by then when none covers it, null when none had begun.
 */
export const yardRunIdAt = (key: YardEventKey, at: number, list: readonly YardEventRun[] = runs): string | null => {
  const begun = list.filter((run) => run.event === key && run.startsAt <= at);
  const run = begun.find((one) => at < one.endsAt) ?? begun.at(-1);
  return run ? yardRunId(run) : null;
};

/** The runs after starting `key` at `now`, or null while any run is on. */
export const startYardRun = (list: readonly YardEventRun[], key: YardEventKey, now: number, days?: number): YardEventRun[] | null => {
  if (liveYardEventRun(now, list)) return null;
  const event = yardEventByKey(key)!;
  const length = Math.max(1, Math.min(30, Math.floor(days ?? event.days))) * DAY_SECONDS;
  const startsAt = list.some((run) => run.event === key && run.startsAt === now) ? now + 1 : now;
  return [...list, { event: key, startsAt, endsAt: startsAt + length }].slice(-MAX_RUNS);
};

/** The runs after stopping the one on at `now`, or null when none is on. */
export const stopYardRun = (list: readonly YardEventRun[], now: number): YardEventRun[] | null => {
  const on = liveYardEventRun(now, list);
  if (!on) return null;
  return list.map((run) => (run === on.run ? { ...run, endsAt: Math.max(now, run.startsAt + 1) } : run));
};

const iso = (seconds: number): string => new Date(seconds * 1000).toISOString().replace(".000Z", "Z");

/** Each run as an Events page entry (kind `yards`); the card's yards come from `GET /bm/events/yards`. */
export const yardEventRunEvents = (list: readonly YardEventRun[] = runs): EventDefinition[] =>
  list.flatMap((run) => {
    const event = yardEventByKey(run.event);
    if (!event) return [];
    return [
      {
        id: yardRunId(run),
        title: event.title,
        text: event.text,
        kind: "yards",
        series: `yards-${event.key}`,
        startsAt: iso(run.startsAt),
        endsAt: iso(run.endsAt),
        banner: event.banner.modern,
        requires: { tutorial: true },
      },
    ];
  });

const sql = (em: EntityManager): SqlEntityManager => em as SqlEntityManager;

/** Reads the row into memory. A failed read keeps what was there. */
export const loadYardEventRuns = async (em: EntityManager): Promise<readonly YardEventRun[]> => {
  try {
    const [row] = await sql(em).execute<{ value: unknown }[]>(`SELECT value FROM bym.game_setting WHERE key = ?`, [SETTING_KEY]);
    runs = row ? readYardRuns(row.value) : [];
  } catch (error) {
    logger.warn("Yard event runs not read, keeping the last ones: {error}", { error: String(error) });
  }
  return runs;
};

/** Writes the runs and takes them into memory at once (the local script). */
export const saveYardEventRuns = async (em: EntityManager, next: readonly YardEventRun[], by: number): Promise<void> => {
  await sql(em).execute(
    `INSERT INTO bym.game_setting (key, value, updated_at, updated_by) VALUES (?, ?::jsonb, now(), ?)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [SETTING_KEY, JSON.stringify({ runs: next }), by]
  );
  runs = next;
};

let timer: ReturnType<typeof setInterval> | null = null;

/** Reads the runs now and every {@link REFRESH_MS}. */
export const startYardEventRefresh = (em: () => EntityManager): void => {
  void loadYardEventRuns(em());
  if (timer) return;
  timer = setInterval(() => void loadYardEventRuns(em()), REFRESH_MS);
  timer.unref?.();
};

/** For tests: every event key. */
export const YARD_EVENT_KEYS = YARD_EVENTS.map((event) => event.key);
