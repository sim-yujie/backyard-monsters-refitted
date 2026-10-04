import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { JobKind, type YardJob } from "@/game/yard/jobs";
import { secondsOf, spaceOf } from "./hatchPlan";
import { predictHatches } from "./hatchPredict";
import { housingSummary } from "./housing";

/** A predicted hatch houses its monster at once, ahead of the server (#272). */

const T0 = 1_700_000_000;

/** A Hatchery (5), a Housing (6) and whatever else, with the monsters blob given. */
const yardWith = (
  monsters: Record<string, unknown>,
  extra: { buildings?: Record<string, unknown>; storedata?: Record<string, unknown> } = {},
): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "1",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: T0,
    savetime: T0,
    buildingdata: {
      "5": { id: 5, t: 13, l: 1, X: 0, Y: 0 },
      "6": { id: 6, t: 15, l: 1, X: 200, Y: 0 },
      ...extra.buildings,
    },
    buildinghealthdata: {},
    storedata: extra.storedata ?? {},
    monsters: { saved: T0, housed: {}, hid: [5], hstage: [1], ...monsters },
  }) as unknown as BaseLoadResponse;

const hatchAt = (endsAt: number, building = 5): YardJob => ({
  kind: JobKind.HATCH,
  key: `hatch:${building}`,
  id: building,
  buildingId: building,
  endsAt,
  holdsWorker: false,
});

describe("predictHatches", () => {
  it("houses the finished monster at once, so every housing count shows it", () => {
    const save = yardWith({ h: [["C1", 30, []]] });
    const before = housingSummary(save, T0 + 30).used;
    const { save: after, hatched } = predictHatches(save, [hatchAt(T0 + 30)]);
    expect(hatched).toEqual([{ hatchery: 5, monster: "C1", housed: true }]);
    expect(after.monsters?.housed?.["C1"]).toBe(1);
    expect(housingSummary(after, T0 + 30).used).toBe(before + spaceOf("C1", 1));
    // Nothing queued: the hatchery goes idle, as the server writes it.
    expect(after.monsters?.h?.[0]).toEqual(["", 0, []]);
    expect(after.monsters?.hstage?.[0]).toBe(0);
  });

  it("starts the next from the hatchery's own queue, timed from when the last one finished", () => {
    const save = yardWith({ h: [["C1", 30, [["C2", 2, 1]], 1]] });
    const { save: after } = predictHatches(save, [hatchAt(T0 + 30)]);
    // Countdowns count from `saved`: 30 s already done, then the Bolt's own time.
    expect(after.monsters?.h?.[0]).toEqual(["C2", 30 + secondsOf("C2", 1), [["C2", 1, 1]], 1]);
    expect(after.monsters?.hstage?.[0]).toBe(1);
  });

  it("takes the HCC's shared queue when the hatchery's own is empty", () => {
    const save = yardWith(
      { h: [["C1", 30, []]], hcc: [["C3", 1, 1]] },
      { buildings: { "7": { id: 7, t: 16, l: 1, X: 400, Y: 0 } } },
    );
    const { save: after } = predictHatches(save, [hatchAt(T0 + 30)]);
    expect(after.monsters?.h?.[0]?.[0]).toBe("C3");
    expect(after.monsters?.["hcc"]).toEqual([]);
  });

  it("times the next one by work done under an overdrive", () => {
    // A 4x overdrive running the whole time: 30 s of work took 7.5 s.
    const save = yardWith(
      { h: [["C1", 30, [["C2", 1, 1]], 1]] },
      { storedata: { HOD: { e: T0 + 1000 } } },
    );
    const { save: after } = predictHatches(save, [hatchAt(T0 + 7.5)]);
    expect(after.monsters?.h?.[0]?.[1]).toBe(30 + secondsOf("C2", 1));
  });

  it("stalls a hatch housing has no room for, and houses nothing", () => {
    // No Housing at all.
    const save = yardWith({ h: [["C1", 30, []]] });
    delete (save.buildingdata as Record<string, unknown>)["6"];
    const { save: after, hatched } = predictHatches(save, [hatchAt(T0 + 30)]);
    expect(hatched).toEqual([{ hatchery: 5, monster: "C1", housed: false }]);
    expect(after.monsters?.housed?.["C1"]).toBeUndefined();
    expect(after.monsters?.hstage?.[0]).toBe(2);
  });

  it("ignores other jobs and a hatchery that is not producing", () => {
    const save = yardWith({ h: [["", 0, []]], hstage: [0] });
    const upgrade: YardJob = { ...hatchAt(T0), kind: JobKind.UPGRADE, key: "upgrade:5" };
    expect(predictHatches(save, [upgrade, hatchAt(T0)])).toEqual({ save, hatched: [] });
  });
});
