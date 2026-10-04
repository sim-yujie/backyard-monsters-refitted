import { describe, expect, test } from "bun:test";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import { maxHp } from "../../game-rules/combat/stats.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { repairRate } from "./repair.js";
import { planSpeedup, type SpeedupSave } from "./speedup.js";

const NOW = 1_800_000_000;

/** A Town Hall 3 and a Cannon Tower (type 20) at level 1 with `cU` seconds left, plus extras. */
const yardOf = (cannon: Record<string, unknown> = {}, extra: BuildingDataMap = {}): SpeedupSave => ({
  buildingdata: {
    "0": { id: 0, t: 14, x: 0, y: 0, l: 3 },
    "1": { id: 1, t: 20, x: 100, y: 100, l: 1, ...cannon },
    ...extra,
  },
  buildinghealthdata: {},
});

/** The `reason` a planSpeedup call is refused with, and its status. */
const refusal = (run: () => unknown): { status: number; reason: unknown; data: object } => {
  try {
    run();
  } catch (err) {
    if (err instanceof ClientSafeError) {
      return { status: err.status, reason: (err.data as { reason?: unknown }).reason, data: err.data as object };
    }
    throw err;
  }
  throw new Error("expected a refusal");
};

describe("planSpeedup: SP rules per remaining time", () => {
  test("SP1 at 300 s finishes the upgrade for free, with the step's points", () => {
    const plan = planSpeedup(yardOf({ cU: 300 }), 1, "SP1", NOW);

    expect(plan.shiny).toBe(0);
    expect(plan.buildingdata["1"]).toMatchObject({ l: 2 });
    expect(plan.buildingdata["1"].cU).toBeUndefined();
    // Cannon 1→2 is [10000, 7500, 2500, 0, 900]: floor(20900 / 3).
    expect(plan.points).toBe(6966);
    expect(plan.report).toEqual({
      id: 1,
      item: "SP1",
      credits: 0,
      remaining: 0,
      finished: {
        kind: "upgrade",
        id: 1,
        t: 20,
        at: NOW,
        detail: { from: 1, level: 2, points: 6966 },
      },
    });
  });

  test("SP1 at 301 s is refused", () => {
    expect(refusal(() => planSpeedup(yardOf({ cU: 301 }), 1, "SP1", NOW))).toMatchObject({
      status: 409,
      reason: "itemRefused",
      data: { id: 1, item: "SP1", remaining: 301 },
    });
  });

  test("SP2 takes an hour off for 20 and leaves the job running", () => {
    const plan = planSpeedup(yardOf({ cU: 5000 }), 1, "SP2", NOW);

    expect(plan.shiny).toBe(20);
    expect(plan.points).toBe(0);
    expect(plan.buildingdata["1"]).toMatchObject({ l: 1, cU: 1400 });
    expect(plan.report).toMatchObject({ credits: 20, remaining: 1400, finished: null });
  });

  test("a speed-up keeps the job's length and a finish clears it (#136)", () => {
    // Part way: the countdown drops, the length it is measured against stays.
    const partial = planSpeedup(yardOf({ cU: 5000, cL: 7200 }), 1, "SP2", NOW);
    expect(partial.buildingdata["1"]).toMatchObject({ cU: 1400, cL: 7200 });

    // Finished: the job is gone, so its length goes with it.
    const done = planSpeedup(yardOf({ cU: 300, cL: 900 }), 1, "SP1", NOW);
    expect(done.buildingdata["1"]).toMatchObject({ l: 2 });
    expect(done.buildingdata["1"].cU).toBeUndefined();
    expect(done.buildingdata["1"].cL).toBeUndefined();
  });

  test("SP2 at exactly an hour finishes the job", () => {
    const plan = planSpeedup(yardOf({ cU: 3600 }), 1, "SP2", NOW);

    expect(plan.buildingdata["1"]).toMatchObject({ l: 2 });
    expect(plan.report).toMatchObject({ remaining: 0, finished: { kind: "upgrade" } });
  });

  test("SP2 under an hour and SP3 under two hours are refused", () => {
    expect(refusal(() => planSpeedup(yardOf({ cU: 3599 }), 1, "SP2", NOW)).reason).toBe(
      "itemRefused"
    );
    expect(refusal(() => planSpeedup(yardOf({ cU: 7199 }), 1, "SP3", NOW)).reason).toBe(
      "itemRefused"
    );
  });

  test("SP3 takes two hours off for 40", () => {
    const plan = planSpeedup(yardOf({ cU: 10000 }), 1, "SP3", NOW);

    expect(plan.shiny).toBe(40);
    expect(plan.buildingdata["1"]).toMatchObject({ cU: 2800 });
  });

  test("SP4 finishes a 24 h job for 262", () => {
    const plan = planSpeedup(yardOf({ cU: 86400 }), 1, "SP4", NOW);

    expect(plan.shiny).toBe(262);
    expect(plan.buildingdata["1"]).toMatchObject({ l: 2 });
    expect(plan.report).toMatchObject({ credits: 262, remaining: 0 });
  });

  test("SP4 at 300 s or less is refused (Close enough is free)", () => {
    expect(refusal(() => planSpeedup(yardOf({ cU: 300 }), 1, "SP4", NOW)).reason).toBe(
      "itemRefused"
    );
  });

  test("SP4 on a build countdown constructs the building at level 1 with build points", () => {
    const plan = planSpeedup(yardOf({ cB: 900, l: undefined }), 1, "SP4", NOW);

    expect(plan.shiny).toBe(5);
    expect(plan.buildingdata["1"].cB).toBeUndefined();
    // Cannon build is [2000, 1500, 500, 0, 30]: floor(30 / 2 + 4000 / 10) = 415.
    expect(plan.report.finished).toMatchObject({
      kind: "build",
      detail: { from: 0, level: 1, points: 415 },
    });
    expect(plan.points).toBe(415);
  });

  test("the rest of the yard is left as it was", () => {
    const yard = yardOf({ cU: 5000 });
    const plan = planSpeedup(yard, 1, "SP2", NOW);

    expect(plan.buildingdata["0"]).toBe(yard.buildingdata!["0"]);
    expect(yard.buildingdata!["1"]).toMatchObject({ cU: 5000 });
  });
});

describe("planSpeedup: refusals", () => {
  test("an id the yard does not hold is a 400", () => {
    expect(refusal(() => planSpeedup(yardOf(), 42, "SP4", NOW))).toMatchObject({
      status: 400,
      reason: "badRequest",
    });
  });

  test("nothing running is 409 notRunning (a fortify does not count)", () => {
    expect(refusal(() => planSpeedup(yardOf(), 1, "SP4", NOW)).reason).toBe("notRunning");
    expect(refusal(() => planSpeedup(yardOf({ cF: 5000 }), 1, "SP4", NOW)).reason).toBe(
      "notRunning"
    );
  });

  test("a damaged or repairing building is 409 damaged", () => {
    expect(refusal(() => planSpeedup(yardOf({ cU: 5000, hp: 10 }), 1, "SP4", NOW)).reason).toBe(
      "damaged"
    );
    expect(refusal(() => planSpeedup(yardOf({ cU: 5000, rE: 1 }), 1, "SP4", NOW)).reason).toBe(
      "damaged"
    );
    const yard = { ...yardOf({ cU: 5000 }), buildinghealthdata: { "1": 5 } };
    expect(refusal(() => planSpeedup(yard, 1, "SP4", NOW)).reason).toBe("damaged");
  });

  test("a damaged building that is not repairing, with nothing running, is 409 notRunning", () => {
    const yard = { ...yardOf({ rE: 0 }), buildinghealthdata: { "1": 5 } };
    expect(refusal(() => planSpeedup(yard, 1, "SP1", NOW)).reason).toBe("notRunning");
  });

  test("a Map Room is 409 mapRoom", () => {
    const yard = yardOf({}, { "2": { id: 2, t: 11, x: 0, y: 0, l: 1, cU: 345600 } });
    expect(refusal(() => planSpeedup(yard, 2, "SP4", NOW)).reason).toBe("mapRoom");
  });
});

describe("planSpeedup: SP1 on a repair (#279)", () => {
  // The Cannon Tower at level 1: its full health and how much it heals a second.
  const MAX = maxHp(20, 1);
  const RATE = repairRate(20, 1, MAX);
  /** The cannon repairing with `seconds` of repair left, by the server's own count. */
  const repairing = (seconds: number, cannon: Record<string, unknown> = {}): SpeedupSave => ({
    ...yardOf({ rE: 1, hp: MAX - seconds * RATE, ...cannon }),
    buildinghealthdata: { "1": MAX - seconds * RATE },
  });

  test("with 300 s left it heals to full for free", () => {
    const plan = planSpeedup(repairing(300), 1, "SP1", NOW);

    expect(plan.shiny).toBe(0);
    expect(plan.points).toBe(0);
    expect(plan.buildingdata["1"]).toEqual({ id: 1, t: 20, x: 100, y: 100, l: 1 });
    expect(plan.buildinghealthdata).toEqual({});
    expect(plan.report).toEqual({
      id: 1,
      item: "SP1",
      credits: 0,
      remaining: 0,
      finished: null,
      repaired: true,
    });
  });

  test("with 301 s left it is refused, with the server's count of the time left", () => {
    expect(refusal(() => planSpeedup(repairing(301), 1, "SP1", NOW))).toMatchObject({
      status: 409,
      reason: "itemRefused",
      data: { id: 1, item: "SP1", remaining: 301 },
    });
  });

  test("the paid items are refused on a repair", () => {
    for (const item of ["SP2", "SP3", "SP4"] as const) {
      expect(refusal(() => planSpeedup(repairing(4000), 1, item, NOW)).reason).toBe("itemRefused");
    }
  });

  test("it finishes the repair, not the paused upgrade, which then runs again", () => {
    const plan = planSpeedup(repairing(60, { cU: 5000 }), 1, "SP1", NOW);

    expect(plan.buildingdata["1"]).toEqual({ id: 1, t: 20, x: 100, y: 100, l: 1, cU: 5000 });
    expect(plan.report.finished).toBeNull();
    expect(plan.report.repaired).toBe(true);
  });

  test("the rest of the health map is left as it was", () => {
    const yard = repairing(10);
    yard.buildinghealthdata = { ...yard.buildinghealthdata, "7": 42 };
    expect(planSpeedup(yard, 1, "SP1", NOW).buildinghealthdata).toEqual({ "7": 42 });
  });
});
