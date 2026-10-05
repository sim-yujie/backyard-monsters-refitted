import type { FlingEvent } from "@/game/combat/rules";
import type { BaiterRun } from "./baiterSession";
import type { TestReport } from "./testReport";

/**
 * The Baiter's recent tests (#22, WP5, `docs/design/baiter-simulator.md`
 * §5.3): every finished test is kept as a recorded run, a frozen copy of the
 * yard as it was, the test army, the seed, the drops and the tick it ended
 * on, with the report it ended with. The engine is deterministic, so a replay
 * of a recorded run is the same battle, frame for frame, even after the yard
 * has changed.
 *
 * The last {@link TEST_HISTORY_SIZE} are kept, in memory only: a page reload
 * forgets them (owner answer Q3). Nothing here talks to the server.
 */

/** How many finished tests are kept (owner answer Q3). */
export const TEST_HISTORY_SIZE = 5;

/** One finished test. */
export interface RecordedTest {
  /** Unique this page load, so a list can name a test. */
  readonly id: number;
  /** The test as it ran: its `save` is a copy no later change to the yard reaches. */
  readonly run: BaiterRun;
  readonly seed: number;
  readonly events: readonly FlingEvent[];
  readonly endTick: number;
  readonly report: TestReport;
  /** When it finished, as `Date.now()`. */
  readonly at: number;
}

let tests: RecordedTest[] = [];
let nextId = 1;

/**
 * Keeps a finished test, newest first, dropping the oldest past the limit.
 * The yard is copied here, so a later change to the yard leaves the replay
 * as it was.
 */
export const recordTest = (test: Omit<RecordedTest, "id" | "at"> & { readonly at?: number }): RecordedTest => {
  const { save, army, baiterLevel } = test.run;
  const recorded: RecordedTest = {
    ...test,
    id: nextId,
    run: { save: structuredClone(save), army, baiterLevel },
    events: test.events.map((event) => structuredClone(event)),
    at: test.at ?? Date.now(),
  };
  nextId += 1;
  tests = [recorded, ...tests].slice(0, TEST_HISTORY_SIZE);
  return recorded;
};

/** The kept tests, newest first. */
export const recentTests = (): readonly RecordedTest[] => tests;

/** The run that plays `test` back on the Baiter's replay scene. */
export const replayOf = (test: RecordedTest): BaiterRun => ({
  ...test.run,
  replay: { seed: test.seed, events: test.events, endTick: test.endTick, report: test.report },
});

/** For tests: forget every kept test. */
export const clearTestHistory = (): void => {
  tests = [];
  nextId = 1;
};
