import { describe, expect, test } from "bun:test";
import { catchUpYard } from "./catchUp.js";
import { catchUpTraining, type CatchUpTrainingSave } from "./catchUpTraining.js";

/**
 * Catch-up step 4, academy part: trainings that ended while the player was
 * away finish (`ACADEMY.Tick`, `client/scripts/ACADEMY.as:205-217`).
 */

const SAVED = 1_800_000_000;

const saveOf = (overrides: Partial<CatchUpTrainingSave> = {}): CatchUpTrainingSave => ({
  buildingdata: {
    "5": { id: 5, t: 26, x: 0, y: 0, l: 3, upg: "C2" },
    "6": { id: 6, t: 26, x: 0, y: 0, l: 1 },
  },
  academy: {
    C1: { level: 1 },
    C2: { level: 3, powerup: 1, time: SAVED + 100, duration: 36_000 },
  },
  ...overrides,
});

describe("catchUpTraining", () => {
  test("finishes a training whose time has passed: level up, fields and upg cleared", () => {
    const save = saveOf();
    const jobs = catchUpTraining(save, SAVED, SAVED + 100);

    expect(jobs).toEqual([
      { kind: "train", id: "C2", t: null, at: SAVED + 100, detail: { level: 4, academy: 5 } },
    ]);
    expect(save.academy).toEqual({ C1: { level: 1 }, C2: { level: 4, powerup: 1 } });
    expect(save.buildingdata!["5"]).not.toHaveProperty("upg");
  });

  test("leaves a training that has not ended, and is idempotent", () => {
    const save = saveOf();
    expect(catchUpTraining(save, SAVED, SAVED + 99)).toEqual([]);
    expect(save).toEqual(saveOf());

    catchUpTraining(save, SAVED, SAVED + 200);
    const after = structuredClone(save);
    expect(catchUpTraining(save, SAVED + 200, SAVED + 200)).toEqual([]);
    expect(save).toEqual(after);
  });

  test("makes a legacy relative time absolute once, from savetime", () => {
    const save = saveOf({ academy: { C2: { level: 2, time: 3_600, duration: 21_600 } } });
    expect(catchUpTraining(save, SAVED, SAVED + 10)).toEqual([]);
    expect(save.academy!.C2).toEqual({ level: 2, time: SAVED + 3_600, duration: 21_600 });

    // The next catch-up reads it as the date it now is.
    expect(catchUpTraining(save, SAVED + 10, SAVED + 3_600)).toHaveLength(1);
    expect(save.academy!.C2).toEqual({ level: 3 });
  });

  test("drops a stale upg and rewrites the legacy C100", () => {
    const save = saveOf({
      buildingdata: {
        "5": { id: 5, t: 26, x: 0, y: 0, l: 3, upg: "C1" },
        "6": { id: 6, t: 26, x: 0, y: 0, l: 3, upg: "C100" },
        "9": { id: 9, t: 116, x: 0, y: 0, l: 1, upg: "C1" },
      },
      academy: { C1: { level: 2 }, C100: { level: 2, time: SAVED + 50, duration: 100 } },
    });
    expect(catchUpTraining(save, SAVED, SAVED + 10)).toEqual([]);
    expect(save.academy).toEqual({ C1: { level: 2 }, C12: { level: 2, time: SAVED + 50, duration: 100 } });
    expect(save.buildingdata!["5"]).not.toHaveProperty("upg");
    expect(save.buildingdata!["6"]).toMatchObject({ upg: "C12" });
    // A lab's upg is its research, not this step's.
    expect(save.buildingdata!["9"]).toMatchObject({ upg: "C1" });
  });

  test("finishes a training with no academy naming it, and ignores Inferno ids", () => {
    const save = saveOf({
      buildingdata: {},
      academy: { C5: { level: 1, time: SAVED + 5 }, IC1: { level: 1, time: SAVED + 5 } },
    });
    expect(catchUpTraining(save, SAVED, SAVED + 10)).toEqual([
      { kind: "train", id: "C5", t: null, at: SAVED + 5, detail: { level: 2, academy: null } },
    ]);
    expect(save.academy!.IC1).toEqual({ level: 1, time: SAVED + 5 });
  });

  test("runs in catchUpYard and reports in completed", () => {
    const save = { ...saveOf(), savetime: SAVED };
    const completed = catchUpYard(save, SAVED + 500);
    expect(completed.filter((job) => job.kind === "train")).toEqual([
      { kind: "train", id: "C2", t: null, at: SAVED + 100, detail: { level: 4, academy: 5 } },
    ]);
    expect(save.savetime).toBe(SAVED + 500);
  });
});
