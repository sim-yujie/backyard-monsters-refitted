import { describe, expect, it, vi } from "vitest";
import type { CompletedJob } from "@/api/types";
import { FinishedMonstersJobs, finishedText, monstersJobsIn } from "./finishedJobs";

const job = (kind: string): CompletedJob => ({ kind, id: 1, t: null, at: 0, detail: {} });

describe("monstersJobsIn", () => {
  it("counts unlocks, trainings and research, not hatches or buildings", () => {
    expect(
      monstersJobsIn([job("unlock"), job("train"), job("research"), job("hatch"), job("hatched"), job("upgrade")]),
    ).toBe(3);
    expect(monstersJobsIn([])).toBe(0);
  });
});

describe("FinishedMonstersJobs", () => {
  it("adds up answers, tells its listeners, and clears when the screen opens", () => {
    const finished = new FinishedMonstersJobs();
    const heard = vi.fn();
    const stop = finished.subscribe(heard);

    finished.add([job("upgrade"), job("hatch")]);
    expect(finished.value).toBe(0);
    expect(heard).not.toHaveBeenCalled();

    finished.add([job("unlock")]);
    finished.add([job("train"), job("research")]);
    expect(finished.value).toBe(3);
    expect(heard).toHaveBeenLastCalledWith(3);

    finished.clear();
    expect(finished.value).toBe(0);
    expect(heard).toHaveBeenLastCalledWith(0);
    heard.mockClear();
    finished.clear();
    expect(heard).not.toHaveBeenCalled();

    stop();
    finished.add([job("unlock")]);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe("finishedText", () => {
  it("counts one and many", () => {
    expect(finishedText(1)).toBe("1 monster job finished");
    expect(finishedText(4)).toBe("4 monster jobs finished");
  });
});
