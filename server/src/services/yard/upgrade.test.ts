import { describe, expect, test } from "bun:test";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { storageCap } from "../base/economy/resourceBudget.js";
import { planCancelUpgrade, planUpgradeAction, type UpgradeActionSave } from "./upgrade.js";

/**
 * The building panel's upgrade and cancel (`docs/design/yard-buildings.md`
 * §3.2), against small hand-built yards so every price below can be read off
 * the cost table (`game-data/buildingCosts.ts`):
 *
 * - Cannon Tower (20) `costs[2]` = 50,000 / 37,500 / 12,500, 2,700 s, Town Hall 3.
 * - Housing (15) `costs[2]` = 34,560 / 34,560, 10,800 s, Town Hall 4 and a Monster Locker.
 * - Twig Snapper (1) `costs[1]` = 0 / 1,575, 300 s: free to finish.
 */

const NOW = 1_700_000_000;

const HALL = 14;
const CANNON = 20;
const HOUSING = 15;
const LOCKER = 8;
const SNAPPER = 1;
const SILO = 6;

const RICH = { r1: 10_000_000, r2: 10_000_000, r3: 10_000_000, r4: 10_000_000 };

/** A level 3 hall, a level 2 Cannon Tower, a level 1 Snapper and a silo; one worker, all idle. */
const yard = (overrides: Partial<UpgradeActionSave> = {}): UpgradeActionSave => ({
  buildingdata: {
    "0": { id: 0, t: HALL, x: 0, y: 0, l: 3 },
    "1": { id: 1, t: CANNON, x: 0, y: 0, l: 2 },
    "2": { id: 2, t: SNAPPER, x: 0, y: 0, l: 1 },
    "3": { id: 3, t: SILO, x: 0, y: 0, l: 10 },
  },
  buildinghealthdata: {},
  resources: { ...RICH },
  storedata: {},
  ...overrides,
});

/** The error a call threw, so a test can read its status and data. */
const refusal = (run: () => unknown): ClientSafeError => {
  try {
    run();
  } catch (err) {
    if (err instanceof ClientSafeError) return err;
    throw err;
  }
  throw new Error("expected a refusal");
};

/** `[status, reason]` of what a call threw. */
const reasonOf = (run: () => unknown): [number, unknown] => {
  const err = refusal(run);
  return [err.status, (err.data as { reason: unknown }).reason];
};

describe("upgrade", () => {
  test("a long step starts: cU at the table's time, charged costs[level], no points yet", () => {
    const save = yard();
    const outcome = planUpgradeAction(save, 1, NOW);

    expect(outcome.report).toEqual({
      id: 1,
      from: 2,
      to: 3,
      seconds: 2700,
      cost: { r1: 50000, r2: 37500, r3: 12500, r4: 0 },
      finished: false,
    });
    expect(outcome.debit).toEqual({ r1: 50000, r2: 37500, r3: 12500, r4: 0 });
    expect(outcome.points).toBe(0);
    expect(outcome.slices.buildingdata["1"]).toEqual({ id: 1, t: CANNON, x: 0, y: 0, l: 2, cU: 2700 });
    // Every other building is carried over untouched, and the save itself is not written.
    expect(outcome.slices.buildingdata["2"]).toBe(save.buildingdata!["2"]);
    expect(save.buildingdata!["1"]!.cU).toBeUndefined();
  });

  test("Sharper Tools running: the countdown is floor(time × 0.8)", () => {
    const outcome = planUpgradeAction(yard({ storedata: { BST: { q: 1, e: NOW + 60 } } }), 1, NOW);

    expect(outcome.report.seconds).toBe(2160);
    expect(outcome.slices.buildingdata["1"]!.cU).toBe(2160);
  });

  test("Sharper Tools expired: the full time", () => {
    const outcome = planUpgradeAction(yard({ storedata: { BST: { q: 1, e: NOW } } }), 1, NOW);

    expect(outcome.report.seconds).toBe(2700);
  });

  test("a step of 300 s or less finishes now, with its points, and needs no worker", () => {
    // The yard's only worker is on the Cannon Tower.
    const save = yard();
    save.buildingdata!["1"] = { ...save.buildingdata!["1"]!, cU: 1000 };

    const outcome = planUpgradeAction(save, 2, NOW);

    expect(outcome.report).toEqual({
      id: 2,
      from: 1,
      to: 2,
      seconds: 0,
      cost: { r1: 0, r2: 1575, r3: 0, r4: 0 },
      finished: true,
    });
    expect(outcome.slices.buildingdata["2"]).toEqual({ id: 2, t: SNAPPER, x: 0, y: 0, l: 2 });
    expect(outcome.debit).toEqual({ r1: 0, r2: 1575, r3: 0, r4: 0 });
    // BFOUNDATION.Upgraded(): floor((300 + 1575) / 3).
    expect(outcome.points).toBe(625);
  });

  test("every refusal, in the order the design checks them", () => {
    // A Housing that fails every rule at once; each round fixes the rule just reported.
    const buildings: BuildingDataMap = {
      "5": { id: 5, t: HOUSING, x: 0, y: 0, l: 6, cU: 100, hp: 10 },
      "6": { id: 6, t: CANNON, x: 0, y: 0, l: 1, cU: 500 },
    };
    const save = yard({
      buildingdata: buildings,
      buildinghealthdata: { "5": 10 },
      resources: { r1: 100, r2: 100, r3: 0, r4: 0 },
    });
    const housing = () => buildings["5"]!;
    const upgrade = () => planUpgradeAction(save, 5, NOW);

    expect(reasonOf(upgrade)).toEqual([409, "busy"]);
    delete housing().cU;

    expect(reasonOf(upgrade)).toEqual([409, "damaged"]);
    delete housing().hp;
    expect(reasonOf(upgrade)).toEqual([409, "damaged"]); // buildinghealthdata alone counts too
    save.buildinghealthdata = {};

    expect(refusal(upgrade).data).toEqual({ reason: "townHall", townHall: { have: 0, need: 1 } });
    buildings["0"] = { id: 0, t: HALL, x: 0, y: 0, l: 3 };

    expect(refusal(upgrade).data).toEqual({ reason: "maxLevel", level: 6, max: 6 });
    housing().l = 2;

    expect(refusal(upgrade).data).toEqual({ reason: "townHall", townHall: { have: 3, need: 4 } });
    buildings["0"]!.l = 4;

    expect(refusal(upgrade).data).toEqual({ reason: "requirements", requirements: [[LOCKER, 1, 1]] });
    buildings["7"] = { id: 7, t: LOCKER, x: 0, y: 0, l: 1 };

    expect(refusal(upgrade).data).toEqual({
      reason: "shortfall",
      shortfall: { r1: 34460, r2: 34460, r3: 0, r4: 0 },
    });
    save.resources = { ...RICH };

    expect(refusal(upgrade).data).toEqual({ reason: "workers", workers: { total: 1, busy: 1 } });
    delete buildings["6"]!.cU;

    expect(upgrade().report).toMatchObject({ id: 5, from: 2, to: 3, seconds: 10800 });
  });

  test("a bought worker is a free one", () => {
    const save = yard({ storedata: { BEW: { q: 1 } } });
    save.buildingdata!["2"] = { ...save.buildingdata!["2"]!, l: 3, cU: 1000 };

    expect(planUpgradeAction(save, 1, NOW).report.finished).toBe(false);
  });

  test("walls and traps are sent to the planner's batch routes", () => {
    const save = yard();
    save.buildingdata!["8"] = { id: 8, t: 17, x: 0, y: 0, l: 1 };
    save.buildingdata!["9"] = { id: 9, t: 24, x: 0, y: 0, l: 1 };
    save.buildingdata!["10"] = { id: 10, t: 18, x: 0, y: 0, l: 1 };

    for (const id of [8, 9, 10]) {
      expect(refusal(() => planUpgradeAction(save, id, NOW)).data).toEqual({
        reason: "useBatchRoute",
        id,
      });
      expect(refusal(() => planUpgradeAction(save, id, NOW)).status).toBe(400);
    }
  });

  test("walls are refused before any rule of the yard's, even when busy", () => {
    const save = yard();
    save.buildingdata!["8"] = { id: 8, t: 17, x: 0, y: 0, l: 1, cU: 5, hp: 1 };

    expect(reasonOf(() => planUpgradeAction(save, 8, NOW))).toEqual([400, "useBatchRoute"]);
  });

  test("the Map Room is refused: its steps belong to WP3.7 (D16)", () => {
    const save = yard({ resources: { ...RICH } });
    save.buildingdata!["0"] = { id: 0, t: HALL, x: 0, y: 0, l: 6 };
    save.buildingdata!["8"] = { id: 8, t: 11, x: 0, y: 0, l: 1 };

    expect(refusal(() => planUpgradeAction(save, 8, NOW)).data).toEqual({ reason: "mapRoom", id: 8 });
    expect(refusal(() => planUpgradeAction(save, 8, NOW)).status).toBe(409);
  });

  test("decorations, mushrooms and unknown ids are malformed requests", () => {
    const save = yard();
    save.buildingdata!["8"] = { id: 8, t: 57, x: 0, y: 0, l: 1 };
    save.buildingdata!["9"] = { id: 9, t: 7, x: 0, y: 0 };

    expect(reasonOf(() => planUpgradeAction(save, 8, NOW))).toEqual([400, "badRequest"]);
    expect(reasonOf(() => planUpgradeAction(save, 9, NOW))).toEqual([400, "badRequest"]);
    expect(reasonOf(() => planUpgradeAction(save, 99, NOW))).toEqual([400, "badRequest"]);
  });

  test("a building still being built is busy", () => {
    const save = yard();
    save.buildingdata!["1"] = { ...save.buildingdata!["1"]!, cB: 100 };

    expect(reasonOf(() => planUpgradeAction(save, 1, NOW))).toEqual([409, "busy"]);
  });
});

describe("upgrade/cancel", () => {
  /** The yard with the Cannon Tower's 2 → 3 step running. */
  const upgrading = (overrides: Partial<UpgradeActionSave> = {}): UpgradeActionSave => {
    const save = yard(overrides);
    save.buildingdata!["1"] = { ...save.buildingdata!["1"]!, cU: 1234 };
    return save;
  };

  test("drops the countdown, keeps the level and refunds costs[level] in full", () => {
    const save = upgrading({ resources: { r1: 0, r2: 0, r3: 0, r4: 0 } });
    const outcome = planCancelUpgrade(save, 1);

    expect(outcome.slices.buildingdata["1"]).toEqual({ id: 1, t: CANNON, x: 0, y: 0, l: 2 });
    expect(outcome.credit).toEqual({ r1: 50000, r2: 37500, r3: 12500, r4: 0 });
    expect(outcome.report).toEqual({ id: 1, refund: { r1: 50000, r2: 37500, r3: 12500, r4: 0 } });
  });

  test("the report says what the storage cap let back in", () => {
    const probe = upgrading();
    const cap = storageCap(probe);
    const save = upgrading({ resources: { r1: cap - 1000, r2: cap, r3: cap + 5, r4: 0 } });

    const outcome = planCancelUpgrade(save, 1);

    // The credit handed to the wrapper is the full price; the wrapper clamps it.
    expect(outcome.credit).toEqual({ r1: 50000, r2: 37500, r3: 12500, r4: 0 });
    expect(outcome.report.refund).toEqual({ r1: 1000, r2: 0, r3: 0, r4: 0 });
  });

  test("refused when no upgrade is running", () => {
    expect(refusal(() => planCancelUpgrade(yard(), 1)).data).toEqual({ reason: "notUpgrading" });

    const building = yard();
    building.buildingdata!["1"] = { ...building.buildingdata!["1"]!, cB: 100 };
    expect(reasonOf(() => planCancelUpgrade(building, 1))).toEqual([409, "notUpgrading"]);
  });

  test("an unknown id is a malformed request", () => {
    expect(reasonOf(() => planCancelUpgrade(upgrading(), 99))).toEqual([400, "badRequest"]);
  });
});
