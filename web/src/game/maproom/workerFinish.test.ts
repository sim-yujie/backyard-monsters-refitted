import { describe, expect, it } from "vitest";
import type { MapCell } from "@/api/types";
import { FINISH_GRACE_SECONDS, MAX_TRIES, RETRY_SECONDS, WorkerFinishWatch } from "./workerFinish";

/**
 * The map's construction badge goes when the job ends (owner, 12 Nov 2026):
 * an own outpost whose `wf` has passed is asked for again, once, without the
 * player opening the yard.
 */
const OUTPOST = { col: 240, row: 208 };
const FINISH = 1_800_000_000;

const cells = (payload: Partial<{ wb: 1; wi: 1; wf: number }> | undefined) => {
  const map = new Map<string, MapCell>();
  if (payload) map.set(`${OUTPOST.col},${OUTPOST.row}`, payload as unknown as MapCell);
  return (col: number, row: number) => map.get(`${col},${row}`);
};

describe("the outpost's build finishing on the map", () => {
  it("is not asked about before the job ends", () => {
    const watch = new WorkerFinishWatch();
    expect(watch.due([OUTPOST], cells({ wb: 1, wf: FINISH }), FINISH - 30)).toEqual([]);
    expect(watch.due([OUTPOST], cells({ wb: 1, wf: FINISH }), FINISH)).toEqual([]);
  });

  it("is asked about once the end has passed, and not again straight away", () => {
    const watch = new WorkerFinishWatch();
    const at = FINISH + FINISH_GRACE_SECONDS;
    expect(watch.due([OUTPOST], cells({ wb: 1, wf: FINISH }), at)).toEqual([OUTPOST]);
    expect(watch.due([OUTPOST], cells({ wb: 1, wf: FINISH }), at + 1)).toEqual([]);
  });

  it("asks again a few times while the server still says busy, then stops", () => {
    const watch = new WorkerFinishWatch();
    const lookup = cells({ wb: 1, wf: FINISH });
    let now = FINISH + FINISH_GRACE_SECONDS;
    let asked = 0;
    for (let i = 0; i < 10; i++, now += RETRY_SECONDS) asked += watch.due([OUTPOST], lookup, now).length;
    expect(asked).toBe(MAX_TRIES);
  });

  it("a new job with a new end is watched afresh", () => {
    const watch = new WorkerFinishWatch();
    expect(watch.due([OUTPOST], cells({ wb: 1, wf: FINISH }), FINISH + 5)).toHaveLength(1);
    const later = FINISH + 600;
    expect(watch.due([OUTPOST], cells({ wb: 1, wf: later }), FINISH + 10)).toEqual([]);
    expect(watch.due([OUTPOST], cells({ wb: 1, wf: later }), later + 5)).toEqual([OUTPOST]);
  });

  it("a free worker, a paused job (no wf) or an unloaded cell is left alone", () => {
    const watch = new WorkerFinishWatch();
    expect(watch.due([OUTPOST], cells({ wi: 1 }), FINISH + 60)).toEqual([]);
    expect(watch.due([OUTPOST], cells({ wb: 1 }), FINISH + 60)).toEqual([]);
    expect(watch.due([OUTPOST], cells(undefined), FINISH + 60)).toEqual([]);
  });
});
