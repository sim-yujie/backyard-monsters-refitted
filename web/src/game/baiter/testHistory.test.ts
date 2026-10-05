import { afterEach, describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { emptyArmy, type BaiterRun } from "./baiterSession";
import { TEST_HISTORY_SIZE, clearTestHistory, recentTests, recordTest, replayOf } from "./testHistory";
import type { TestReport } from "./testReport";

/** The kept tests (#22, WP5): the last five, newest first, each on a yard of its own. */

const saveOf = (): BaseLoadResponse =>
  ({
    baseid: "3510",
    buildingdata: { "2": { id: 2, t: 20, l: 1, X: 60, Y: 60 } },
    buildinghealthdata: {},
    academy: {},
  }) as unknown as BaseLoadResponse;

const runOf = (save = saveOf()): BaiterRun => ({ save, army: emptyArmy(save), baiterLevel: 1 });

const reportOf = (resultLine: string): TestReport => ({ resultLine }) as unknown as TestReport;

const record = (line: string, run = runOf()) =>
  recordTest({
    run,
    seed: 7,
    events: [{ kind: "fling", t: 0, x: 1, y: 2, r: 100, monsters: { C1: 1 } }],
    endTick: 400,
    report: reportOf(line),
  });

describe("the Baiter's recent tests", () => {
  afterEach(() => clearTestHistory());

  it("keeps the last five, newest first", () => {
    for (let index = 1; index <= TEST_HISTORY_SIZE + 2; index += 1) record(`test ${index}`);
    const kept = recentTests();
    expect(TEST_HISTORY_SIZE).toBe(5);
    expect(kept.map((test) => test.report.resultLine)).toEqual(["test 7", "test 6", "test 5", "test 4", "test 3"]);
    expect(new Set(kept.map((test) => test.id)).size).toBe(5);
  });

  it("keeps its own copy of the yard, so a later change to the yard leaves it as it was", () => {
    const save = saveOf();
    const recorded = record("held", runOf(save));
    save.buildinghealthdata = { "2": 10 };
    (save.buildingdata as Record<string, { l: number }>)["2"]!.l = 5;
    expect(recorded.run.save.buildinghealthdata).toEqual({});
    expect((recorded.run.save.buildingdata as Record<string, { l: number }>)["2"]!.l).toBe(1);
  });

  it("plays back through a run that carries the seed, the drops, the end tick and the report", () => {
    const recorded = record("held");
    const run = replayOf(recorded);
    expect(run.save).toBe(recorded.run.save);
    expect(run.army).toBe(recorded.run.army);
    expect(run.replay).toEqual({ seed: 7, events: recorded.events, endTick: 400, report: recorded.report });
  });

  it("forgets a replay's own replay, so a recorded run is always a plain test", () => {
    const recorded = record("held", { ...runOf(), replay: { seed: 1, events: [], endTick: 0, report: reportOf("x") } });
    expect(recorded.run.replay).toBeUndefined();
  });
});
