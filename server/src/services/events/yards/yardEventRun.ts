import { yardEventByKey, YARD_EVENTS, type YardEventDefinition } from "../../../game-data/events/yardEvents.js";
import type { YardEventKey } from "../../../game-data/tribes/events/index.js";
import { runId, setWaveRuns, waveRuns, type WaveRun } from "../waves/waveRuns.js";

/**
 * Which Brukkarg attack event runs now: the ONE place the yard events read
 * their run from (bruk-port, beta 10).
 *
 * The owner starts and stops them from the dashboard's generic event control
 * (`services/events/waves/waveRuns.ts`, `controllers/admin/waveEvents.ts`,
 * `web/src/admin/waveEvents.ts`), one event at a time with the wave events:
 * both are registered in `WAVE_EVENTS` (`waves/waveEvents.ts`), whose runs
 * this file reads, filtered to the yard events' keys. Their Events page entry
 * is the wave runs' own (`waves/waveRunEvents.ts`, kind `yards`).
 *
 * Ended runs count too: the landing and the rowless finaliser find an
 * attack's run with {@link yardRunIdAt} from its start time, also after the
 * run ended, so the attack still lands on it.
 *
 * A run's id is `<key>-<startsAt>` here and in the wave runs, so Brukkarg
 * War's wave progress (`event_progress.counter`, `waves/waveProgress.ts`) and
 * its yards (`yardStore.ts`) share one row.
 */

export type YardEventRun = WaveRun & { readonly event: YardEventKey };

/** A run's id, the key of its players' progress rows: `carnage-1764230400` (`waveRuns.ts` `runId`). */
export const yardRunId = (run: Pick<YardEventRun, "event" | "startsAt">): string => runId(run);

export const isYardEventKey = (key: unknown): key is YardEventKey => typeof key === "string" && yardEventByKey(key) !== null;

/** The yard events' runs among the event control's, ended ones too. */
export const yardEventRuns = (list: readonly WaveRun[] = waveRuns()): YardEventRun[] =>
  list.filter((run): run is YardEventRun => isYardEventKey(run.event));

/** Replaces the event control's runs in memory (tests). */
export const setYardEventRuns = (next: readonly WaveRun[]): void => setWaveRuns(next);

/** The run on at `now` and its event, or null (also while a wave event is on instead). */
export const liveYardEventRun = (
  now: number,
  list: readonly WaveRun[] = waveRuns()
): { run: YardEventRun; event: YardEventDefinition; id: string } | null => {
  const run = yardEventRuns(list).find((one) => one.startsAt <= now && now < one.endsAt);
  const event = run ? yardEventByKey(run.event) : null;
  return run && event ? { run, event, id: yardRunId(run) } : null;
};

/**
 * The id of the run of `key` that covered `at` (an attack's start), so an
 * attack lands on the run it began in even after that run ended; the
 * latest run begun by then when none covers it, null when none had begun.
 */
export const yardRunIdAt = (key: YardEventKey, at: number, list: readonly WaveRun[] = waveRuns()): string | null => {
  const begun = yardEventRuns(list).filter((run) => run.event === key && run.startsAt <= at);
  const run = begun.find((one) => at < one.endsAt) ?? begun.at(-1);
  return run ? yardRunId(run) : null;
};

/** For tests: every event key. */
export const YARD_EVENT_KEYS = YARD_EVENTS.map((event) => event.key);
