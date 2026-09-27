import { describe, expect, test } from "bun:test";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { planInstantUpgrade, type InstantUpgradeSave } from "./instantUpgrade.js";

const NOW = 1_800_000_000;

/** A Town Hall at `hall` and whatever else the test adds. */
const yardOf = (extra: BuildingDataMap, hall = 3): InstantUpgradeSave => ({
  buildingdata: { "0": { id: 0, t: 14, x: 0, y: 0, l: hall }, ...extra },
  buildinghealthdata: {},
});

const cannon = (fields: Record<string, unknown> = {}): BuildingDataMap => ({
  "1": { id: 1, t: 20, x: 100, y: 100, l: 1, ...fields },
});

/** The refusal a call throws: status, reason and detail. */
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

describe("planInstantUpgrade", () => {
  test("raises the level now, charges the formula price, awards the step's points", () => {
    const plan = planInstantUpgrade(yardOf(cannon()), 1, NOW);

    expect(plan.shiny).toBe(35);
    expect(plan.points).toBe(6966);
    expect(plan.buildingdata["1"]).toEqual({ id: 1, t: 20, x: 100, y: 100, l: 2 });
    expect(plan.report).toEqual({ id: 1, from: 1, to: 2, credits: 35, points: 6966 });
    expect(plan.job).toMatchObject({ kind: "upgrade", id: 1, t: 20, at: NOW });
  });

  test("a building with no `l` is level 1", () => {
    const plan = planInstantUpgrade(yardOf(cannon({ l: undefined })), 1, NOW);
    expect(plan.report).toMatchObject({ from: 1, to: 2 });
  });

  test("the Town Hall itself upgrades against its own gate", () => {
    const plan = planInstantUpgrade(yardOf({}, 1), 0, NOW);

    expect(plan.shiny).toBe(30);
    expect(plan.buildingdata["0"]).toMatchObject({ l: 2 });
  });
});

describe("planInstantUpgrade: gates, in order", () => {
  test("unknown id: 400 badRequest", () => {
    expect(refusal(() => planInstantUpgrade(yardOf({}), 9, NOW))).toMatchObject({
      status: 400,
      reason: "badRequest",
    });
  });

  test("walls and traps: 400 useBatchRoute", () => {
    const yard = yardOf({
      "2": { id: 2, t: 17, x: 0, y: 0, l: 1 },
      "3": { id: 3, t: 24, x: 0, y: 0, l: 1 },
    });
    expect(refusal(() => planInstantUpgrade(yard, 2, NOW))).toMatchObject({
      status: 400,
      reason: "useBatchRoute",
    });
    expect(refusal(() => planInstantUpgrade(yard, 3, NOW)).reason).toBe("useBatchRoute");
  });

  test("a mushroom has no ladder: 400 badRequest", () => {
    const yard = yardOf({ "2": { id: 2, t: 7, x: 0, y: 0 } });
    expect(refusal(() => planInstantUpgrade(yard, 2, NOW))).toMatchObject({
      status: 400,
      reason: "badRequest",
    });
  });

  test("Map Room: 409 mapRoom", () => {
    const yard = yardOf({ "2": { id: 2, t: 11, x: 0, y: 0, l: 1 } }, 6);
    expect(refusal(() => planInstantUpgrade(yard, 2, NOW)).reason).toBe("mapRoom");
  });

  test("busy with a build, upgrade or fortify: 409 busy", () => {
    for (const field of ["cB", "cU", "cF"]) {
      expect(refusal(() => planInstantUpgrade(yardOf(cannon({ [field]: 60 })), 1, NOW))).toMatchObject({
        status: 409,
        reason: "busy",
      });
    }
  });

  test("busy wins over damaged", () => {
    expect(refusal(() => planInstantUpgrade(yardOf(cannon({ cU: 60, hp: 5 })), 1, NOW)).reason).toBe(
      "busy"
    );
  });

  test("damaged (hp, rE, or a health entry): 409 damaged", () => {
    expect(refusal(() => planInstantUpgrade(yardOf(cannon({ hp: 5 })), 1, NOW)).reason).toBe("damaged");
    expect(refusal(() => planInstantUpgrade(yardOf(cannon({ rE: 1 })), 1, NOW)).reason).toBe("damaged");
    const yard = { ...yardOf(cannon()), buildinghealthdata: { "1": 100 } };
    expect(refusal(() => planInstantUpgrade(yard, 1, NOW)).reason).toBe("damaged");
  });

  test("no Town Hall: 409 townHall {have: 0, need: 1}", () => {
    const yard: InstantUpgradeSave = { buildingdata: cannon(), buildinghealthdata: {} };
    expect(refusal(() => planInstantUpgrade(yard, 1, NOW))).toMatchObject({
      status: 409,
      reason: "townHall",
      data: { townHall: { have: 0, need: 1 } },
    });
  });

  test("top of the ladder: 409 maxLevel", () => {
    expect(refusal(() => planInstantUpgrade(yardOf(cannon({ l: 10 })), 1, NOW))).toMatchObject({
      reason: "maxLevel",
      data: { level: 10, max: 10 },
    });
  });

  test("the step's Town Hall requirement: 409 townHall {have, need}", () => {
    // Cannon 2→3 wants Town Hall 3.
    expect(refusal(() => planInstantUpgrade(yardOf(cannon({ l: 2 }), 2), 1, NOW))).toMatchObject({
      reason: "townHall",
      data: { townHall: { have: 2, need: 3 } },
    });
  });

  test("other buildings required: 409 requirements", () => {
    // Housing 1→2 wants Town Hall 3 and a Monster Locker (8) at level 1.
    const yard = yardOf({ "2": { id: 2, t: 15, x: 0, y: 0, l: 1 } }, 5);
    expect(refusal(() => planInstantUpgrade(yard, 2, NOW))).toMatchObject({
      reason: "requirements",
      data: { requirements: [[8, 1, 1]] },
    });
  });

  test("resources and workers are not gates", () => {
    const yard: InstantUpgradeSave = {
      ...yardOf({ ...cannon(), "5": { id: 5, t: 20, x: 0, y: 0, l: 1, cU: 999 } }),
    };
    // One worker, already busy on building 5; no resources in the slice at all.
    expect(planInstantUpgrade(yard, 1, NOW).report.to).toBe(2);
  });
});
