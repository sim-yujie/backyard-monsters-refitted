import { describe, expect, test } from "bun:test";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { advanceBuildingTimers } from "../base/advanceBuildingTimers.js";
import { planCancelFortify, planFortify, type FortifySave } from "./fortify.js";

/**
 * Builder's Weekend discounts Fortify too (owner, 7 Nov), with the upgrade
 * rules (`services/yard/upgrade.ts`): the shortfall check, the charge and the
 * report use the lower price, the building keeps the percentage as `wd`, and a
 * cancel gives back what was paid, even after the weekend.
 *
 * Main-yard Cannon Tower (20) `fortify[0]` = 50,000 / 37,500 / 12,500,
 * 8,100 s, Town Hall 5. At 30% off: 35,000 / 26,250 / 8,750.
 */

const NOW = 1_700_000_000;
const OFF = 30;
const HALL = 14;
const CANNON = 20;
const SILO = 6;

const FULL = { r1: 50000, r2: 37500, r3: 12500, r4: 0 };
const CANNON_OFF = { r1: 35000, r2: 26250, r3: 8750, r4: 0 };
const RICH = { r1: 10_000_000, r2: 10_000_000, r3: 10_000_000, r4: 10_000_000 };

const yard = (overrides: Partial<FortifySave> = {}): FortifySave => ({
  type: "main",
  buildingdata: {
    "0": { id: 0, t: HALL, x: 0, y: 0, l: 5 },
    "1": { id: 1, t: CANNON, x: 0, y: 0, l: 5 },
    "3": { id: 3, t: SILO, x: 0, y: 0, l: 10 },
  },
  buildinghealthdata: {},
  resources: { ...RICH },
  storedata: {},
  ...overrides,
});

const refusal = (run: () => unknown): ClientSafeError => {
  try {
    run();
  } catch (err) {
    if (err instanceof ClientSafeError) return err;
    throw err;
  }
  throw new Error("expected a refusal");
};

describe("fortify during a Builder's Weekend", () => {
  test("charges and reports the lower price, writes wd on the building", () => {
    const outcome = planFortify(yard(), 1, NOW, OFF);

    expect(outcome.debit).toEqual(CANNON_OFF);
    expect(outcome.report).toEqual({ id: 1, from: 0, to: 1, seconds: 8100, cost: CANNON_OFF, weekendOff: OFF });
    expect(outcome.slices.buildingdata["1"]).toMatchObject({ cF: 8100, wd: OFF });
  });

  test("no weekend: full price, no wd and no weekendOff", () => {
    const outcome = planFortify(yard(), 1, NOW, 0);
    expect(outcome.debit).toEqual(FULL);
    expect(outcome.slices.buildingdata["1"]).not.toHaveProperty("wd");
    expect(outcome.report).not.toHaveProperty("weekendOff");
  });

  test("a stale wd is not carried into a full-price fortify", () => {
    const buildings: BuildingDataMap = { ...yard().buildingdata!, "1": { id: 1, t: CANNON, x: 0, y: 0, l: 5, wd: 30 } };
    const outcome = planFortify(yard({ buildingdata: buildings }), 1, NOW, 0);
    expect(outcome.slices.buildingdata["1"]).not.toHaveProperty("wd");
  });

  test("the shortfall check uses the lower price", () => {
    const poor = yard({ resources: { r1: 100, r2: 100, r3: 0, r4: 0 } });
    expect(refusal(() => planFortify(poor, 1, NOW, OFF)).data).toEqual({
      reason: "shortfall",
      shortfall: { r1: 34900, r2: 26150, r3: 8750, r4: 0 },
    });

    // Enough for the weekend price but not the full one: the fortify starts.
    const enough = yard({ resources: { ...CANNON_OFF } });
    expect(() => planFortify(enough, 1, NOW, 0)).toThrow();
    expect(planFortify(enough, 1, NOW, OFF).debit).toEqual(CANNON_OFF);
  });

  test("cancelling gives back what was paid and drops wd, even after the weekend", () => {
    const started = planFortify(yard(), 1, NOW, OFF);
    const save = yard({ buildingdata: started.slices.buildingdata, resources: { r1: 0, r2: 0, r3: 0, r4: 0 } });

    const cancelled = planCancelFortify(save, 1);

    expect(cancelled.credit).toEqual(CANNON_OFF);
    expect(cancelled.report.refund).toEqual(CANNON_OFF);
    expect(cancelled.slices.buildingdata["1"]).toEqual({ id: 1, t: CANNON, x: 0, y: 0, l: 5 });
  });

  test("a fortify started at full price but cancelled in the weekend refunds the full price", () => {
    const started = planFortify(yard(), 1, NOW, 0);
    const save = yard({ buildingdata: started.slices.buildingdata, resources: { r1: 0, r2: 0, r3: 0, r4: 0 } });
    expect(planCancelFortify(save, 1).credit).toEqual(FULL);
  });

  test("a finished fortify drops wd and raises fort", () => {
    const started = planFortify(yard(), 1, NOW, OFF);
    const after = advanceBuildingTimers(started.slices.buildingdata, {}, 8100);
    expect(after["1"]).toEqual({ id: 1, t: CANNON, x: 0, y: 0, l: 5, fort: 1 });
  });
});
