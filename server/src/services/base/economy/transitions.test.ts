import { describe, expect, test } from "bun:test";
import { COSTS } from "../../../game-data/buildingCosts.js";
import type { BuildingData, BuildingDataMap } from "../../../types/BuildingData.js";
import { pointsForBuild, pointsForUpgrade } from "../../yardplanner/costs.js";
import { instantCost } from "./resourceBudget.js";
import {
  explainNewBuilding,
  explainTransition,
  type NewBuildingContext,
  type TransitionContext,
} from "./transitions.js";
import { NO_VOUCHER, readVoucher } from "./voucher.js";

/**
 * The ladder walk, on hand-built buildings rather than on the 575-building
 * fixture, so each rule is read off one transition and nothing else.
 *
 * Types used: the Cannon Tower (20), whose ladder is slow enough that a step
 * cannot fit inside a save interval; the Block (17), every step of which is
 * five seconds and free to finish; and the Railgun (118), whose first build is
 * twelve hours and so is never free.
 */

const CANNON = 20;
const WALL = 17;
const RAILGUN = 118;

/** A yard holding nothing but a level 10 Town Hall, so prerequisites are met. */
const HALL: BuildingDataMap = { "0": { x: 0, y: 0, t: 14, id: 0, l: 10 } };

/** A hand-built building. */
const at = (over: Partial<BuildingData> & { t: number; id: number }): BuildingData => ({
  x: 0,
  y: 0,
  ...over,
});

const ctx = (over: Partial<TransitionContext> = {}): TransitionContext => ({
  elapsed: 60,
  tolerance: 10,
  bst: 1,
  voucher: NO_VOUCHER,
  reference: HALL,
  hall: 10,
  damaged: false,
  ...over,
});

const newCtx = (over: Partial<NewBuildingContext> = {}): NewBuildingContext => ({
  ...ctx(),
  inventory: new Set<number>(),
  ...over,
});

/** The rule names a transition reported, in order. */
const rules = (result: { violations: { rule: string }[] }): string[] =>
  result.violations.map((violation) => violation.rule);

/** The detail of the first violation with this rule. */
const detailOf = (
  result: { violations: { rule: string; detail?: Record<string, unknown> }[] },
  rule: string
): Record<string, unknown> | undefined =>
  result.violations.find((violation) => violation.rule === rule)?.detail;

describe("explainTransition: nothing changed", () => {
  test("a building that stood still costs nothing and breaks nothing", () => {
    const building = at({ t: CANNON, id: 1, l: 2 });
    const result = explainTransition(building, building, building, ctx());

    expect(result.violations).toEqual([]);
    expect(result.charged).toEqual([]);
    expect(result.points).toBe(0);
    expect(result.spentVoucher).toBe(false);
  });

  test("a countdown that only ticked is not a violation", () => {
    const stored = at({ t: CANNON, id: 1, l: 2, cU: 900 });
    const reference = at({ t: CANNON, id: 1, l: 2, cU: 840 });
    const submitted = at({ t: CANNON, id: 1, l: 2, cU: 838 });

    expect(explainTransition(stored, reference, submitted, ctx()).violations).toEqual([]);
  });

  test("a countdown longer than the reference's is fine: damage pauses it", () => {
    const stored = at({ t: CANNON, id: 1, l: 2, cU: 900 });
    const reference = at({ t: CANNON, id: 1, l: 2, cU: 840 });
    const submitted = at({ t: CANNON, id: 1, l: 2, cU: 900 });

    expect(explainTransition(stored, reference, submitted, ctx()).violations).toEqual([]);
  });
});

describe("explainTransition: countdown shape", () => {
  test("a countdown that grew past the stored one is countdownJumped", () => {
    const stored = at({ t: CANNON, id: 1, l: 2, cU: 900 });
    const submitted = at({ t: CANNON, id: 1, l: 2, cU: 5000 });
    const result = explainTransition(stored, stored, submitted, ctx());

    expect(rules(result)).toEqual(["countdownJumped"]);
    expect(detailOf(result, "countdownJumped")).toEqual({
      field: "cU",
      expected: 900,
      sent: 5000,
    });
  });

  test("a countdown that ran faster than the clock is countdownJumped", () => {
    const stored = at({ t: CANNON, id: 1, l: 2, cU: 900 });
    const reference = at({ t: CANNON, id: 1, l: 2, cU: 840 });
    const submitted = at({ t: CANNON, id: 1, l: 2, cU: 100 });
    const result = explainTransition(stored, reference, submitted, ctx());

    expect(rules(result)).toEqual(["countdownJumped"]);
    expect(detailOf(result, "countdownJumped")).toEqual({
      field: "cU",
      expected: 830,
      sent: 100,
    });
  });

  test("an SP2 buys an hour of it", () => {
    const stored = at({ t: CANNON, id: 1, l: 2, cU: 9000 });
    const reference = at({ t: CANNON, id: 1, l: 2, cU: 8940 });
    const submitted = at({ t: CANNON, id: 1, l: 2, cU: 5400 });
    const result = explainTransition(stored, reference, submitted, ctx({ voucher: readVoucher(["SP2", 20]) }));

    expect(result.violations).toEqual([]);
    expect(result.spentVoucher).toBe(true);
  });

  test("an SP2 does not buy two hours of it", () => {
    const stored = at({ t: CANNON, id: 1, l: 2, cU: 9000 });
    const reference = at({ t: CANNON, id: 1, l: 2, cU: 8940 });
    const submitted = at({ t: CANNON, id: 1, l: 2, cU: 1000 });
    const result = explainTransition(stored, reference, submitted, ctx({ voucher: readVoucher(["SP2", 20]) }));

    expect(rules(result)).toEqual(["countdownJumped"]);
  });
});

describe("explainTransition: a step that completed", () => {
  test("a countdown that ran out within the tolerance costs nothing", () => {
    const stored = at({ t: CANNON, id: 1, l: 2, cU: 68 });
    const reference = at({ t: CANNON, id: 1, l: 2, cU: 8 });
    const submitted = at({ t: CANNON, id: 1, l: 3 });
    const result = explainTransition(stored, reference, submitted, ctx());

    expect(result.violations).toEqual([]);
    expect(result.charged).toEqual([]);
    expect(result.points).toBe(pointsForUpgrade(COSTS[CANNON]!.costs[2]!));
  });

  test("a countdown under five minutes finishes for free", () => {
    const stored = at({ t: CANNON, id: 1, l: 2, cU: 310 });
    const reference = at({ t: CANNON, id: 1, l: 2, cU: 250 });
    const submitted = at({ t: CANNON, id: 1, l: 3 });

    expect(explainTransition(stored, reference, submitted, ctx()).violations).toEqual([]);
  });

  test("a countdown with hours left does not just vanish", () => {
    const stored = at({ t: CANNON, id: 1, l: 3, cU: 5060 });
    const reference = at({ t: CANNON, id: 1, l: 3, cU: 5000 });
    const submitted = at({ t: CANNON, id: 1, l: 4 });
    const result = explainTransition(stored, reference, submitted, ctx());

    expect(rules(result)).toEqual(["countdownJumped"]);
    expect(detailOf(result, "countdownJumped")).toEqual({
      field: "cU",
      expected: 4990,
      sent: 0,
    });
  });

  test("an SP4 finishes a countdown of any length", () => {
    const stored = at({ t: CANNON, id: 1, l: 3, cU: 5060 });
    const reference = at({ t: CANNON, id: 1, l: 3, cU: 5000 });
    const submitted = at({ t: CANNON, id: 1, l: 4 });
    const result = explainTransition(
      stored,
      reference,
      submitted,
      ctx({ voucher: readVoucher(["SP4", 1]) })
    );

    expect(result.violations).toEqual([]);
    expect(result.spentVoucher).toBe(true);
  });

  test("a build countdown that ran out awards build points, not upgrade points", () => {
    const stored = at({ t: CANNON, id: 1, cB: 65 });
    const reference = at({ t: CANNON, id: 1, cB: 5 });
    const submitted = at({ t: CANNON, id: 1, l: 1 });
    const result = explainTransition(stored, reference, submitted, ctx());

    expect(result.violations).toEqual([]);
    expect(result.charged).toEqual([]);
    expect(result.points).toBe(pointsForBuild(COSTS[CANNON]!.costs[0]!));
  });
});

describe("explainTransition: a step with no countdown", () => {
  test("an IU voucher buys the step outright", () => {
    const before = at({ t: CANNON, id: 1, l: 1 });
    const submitted = at({ t: CANNON, id: 1, l: 2 });
    const needed = instantCost(COSTS[CANNON]!.costs[1]);
    const result = explainTransition(
      before,
      before,
      submitted,
      ctx({ voucher: readVoucher(["IU", needed]) })
    );

    expect(result.violations).toEqual([]);
    expect(result.charged).toEqual([]);
    expect(result.spentVoucher).toBe(true);
    expect(result.points).toBe(pointsForUpgrade(COSTS[CANNON]!.costs[1]!));
  });

  test("an IU voucher below the derived price is voucherShort", () => {
    const before = at({ t: CANNON, id: 1, l: 1 });
    const submitted = at({ t: CANNON, id: 1, l: 2 });
    const needed = instantCost(COSTS[CANNON]!.costs[1]);
    const result = explainTransition(
      before,
      before,
      submitted,
      ctx({ voucher: readVoucher(["IU", needed - 1]) })
    );

    expect(rules(result)).toEqual(["voucherShort"]);
    expect(detailOf(result, "voucherShort")).toEqual({
      item: "IU",
      quantity: needed - 1,
      needed,
    });
  });

  test("a step that could not have run in the gap is unpaidUpgrade", () => {
    const before = at({ t: CANNON, id: 1, l: 1 });
    const submitted = at({ t: CANNON, id: 1, l: 2 });
    const result = explainTransition(before, before, submitted, ctx());

    expect(rules(result)).toEqual(["unpaidUpgrade"]);
    expect(detailOf(result, "unpaidUpgrade")).toMatchObject({ from: 1, to: 2, needed: 900 });
  });

  test("a five-second wall step that started and finished in the gap is charged", () => {
    const before = at({ t: WALL, id: 1, l: 1 });
    const submitted = at({ t: WALL, id: 1, l: 2 });
    const result = explainTransition(before, before, submitted, ctx());

    expect(result.violations).toEqual([]);
    expect(result.charged).toEqual([COSTS[WALL]!.costs[1]!]);
  });
});

describe("explainTransition: starting an upgrade", () => {
  test("charges the step and accepts a countdown of the step's length", () => {
    const before = at({ t: CANNON, id: 1, l: 1 });
    const submitted = at({ t: CANNON, id: 1, l: 1, cU: 900 });
    const result = explainTransition(before, before, submitted, ctx());

    expect(result.violations).toEqual([]);
    expect(result.charged).toEqual([COSTS[CANNON]!.costs[1]!]);
    expect(result.points).toBe(0);
  });

  test("Sharper Tools cuts the countdown by a fifth", () => {
    const before = at({ t: CANNON, id: 1, l: 1 });
    const submitted = at({ t: CANNON, id: 1, l: 1, cU: 720 });

    expect(explainTransition(before, before, submitted, ctx({ bst: 0.8 })).violations).toEqual([]);
  });

  test("a countdown above the step's length is countdownTooLong", () => {
    const before = at({ t: CANNON, id: 1, l: 1 });
    const submitted = at({ t: CANNON, id: 1, l: 1, cU: 900 });
    const result = explainTransition(before, before, submitted, ctx({ bst: 0.8 }));

    expect(rules(result)).toEqual(["countdownTooLong"]);
    expect(detailOf(result, "countdownTooLong")).toEqual({
      field: "cU",
      expected: 720,
      sent: 900,
    });
  });

  test("a countdown already further along than the gap allows is countdownJumped", () => {
    const before = at({ t: CANNON, id: 1, l: 1 });
    const submitted = at({ t: CANNON, id: 1, l: 1, cU: 100 });
    const result = explainTransition(before, before, submitted, ctx());

    expect(rules(result)).toEqual(["countdownJumped"]);
    expect(detailOf(result, "countdownJumped")).toEqual({
      field: "cU",
      expected: 830,
      sent: 100,
    });
  });

  test("a yard with no Town Hall cannot start anything", () => {
    const before = at({ t: CANNON, id: 1, l: 1 });
    const submitted = at({ t: CANNON, id: 1, l: 1, cU: 900 });
    const result = explainTransition(before, before, submitted, ctx({ hall: 0, reference: {} }));

    expect(rules(result)).toEqual(["upgradeBlocked"]);
    expect(detailOf(result, "upgradeBlocked")).toEqual({ townHall: { have: 0, need: 1 } });
  });

  test("a Town Hall below the step's requirement is named", () => {
    const hall: BuildingDataMap = { "0": at({ t: 14, id: 0, l: 1 }) };
    const before = at({ t: CANNON, id: 1, l: 1 });
    const submitted = at({ t: CANNON, id: 1, l: 1, cU: 900 });
    const result = explainTransition(before, before, submitted, ctx({ hall: 1, reference: hall }));

    expect(detailOf(result, "upgradeBlocked")).toEqual({ townHall: { have: 1, need: 2 } });
  });

  test("a damaged building cannot start one", () => {
    const before = at({ t: CANNON, id: 1, l: 1 });
    const submitted = at({ t: CANNON, id: 1, l: 1, cU: 900 });
    const result = explainTransition(before, before, submitted, ctx({ damaged: true }));

    expect(detailOf(result, "upgradeBlocked")).toEqual({ damaged: true });
  });

  test("a building already counting something down cannot start one", () => {
    const before = at({ t: CANNON, id: 1, cB: 20 });
    const submitted = at({ t: CANNON, id: 1, cB: 20, cU: 30 });
    const result = explainTransition(before, before, submitted, ctx({ elapsed: 0 }));

    expect(rules(result)).toContain("upgradeBlocked");
    expect(detailOf(result, "upgradeBlocked")).toEqual({ busy: true });
  });

  test("a building at the top of its ladder cannot start one", () => {
    const before = at({ t: WALL, id: 1, l: 5 });
    const submitted = at({ t: WALL, id: 1, l: 5, cU: 5 });
    const result = explainTransition(before, before, submitted, ctx());

    expect(rules(result)).toEqual(["upgradeBlocked"]);
    expect(detailOf(result, "upgradeBlocked")).toEqual({ maxLevel: { have: 5, max: 5 } });
  });
});

describe("explainTransition: cancelling", () => {
  test("a cancelled upgrade hands the whole step back", () => {
    const before = at({ t: CANNON, id: 1, l: 1, cU: 900 });
    const submitted = at({ t: CANNON, id: 1, l: 1 });
    const result = explainTransition(before, before, submitted, ctx({ elapsed: 0 }));

    expect(result.violations).toEqual([]);
    expect(result.refund).toEqual({ r1: 10000, r2: 7500, r3: 2500, r4: 0 });
  });
});

describe("explainTransition: levels that nothing explains", () => {
  test("a level that fell is levelDropped", () => {
    const before = at({ t: CANNON, id: 1, l: 3 });
    const submitted = at({ t: CANNON, id: 1, l: 1 });
    const result = explainTransition(before, before, submitted, ctx());

    expect(rules(result)).toEqual(["levelDropped"]);
    expect(detailOf(result, "levelDropped")).toEqual({ from: 3, to: 1 });
  });

  test("a level above the top of the ladder is levelJumped", () => {
    const before = at({ t: WALL, id: 1, l: 1 });
    const submitted = at({ t: WALL, id: 1, l: 9 });
    const result = explainTransition(before, before, submitted, ctx());

    expect(rules(result)).toEqual(["levelJumped"]);
    expect(detailOf(result, "levelJumped")).toEqual({ from: 1, to: 9, max: 5 });
  });

  test("two slow steps in one save interval is levelJumped", () => {
    const before = at({ t: CANNON, id: 1, l: 1 });
    const submitted = at({ t: CANNON, id: 1, l: 3 });
    const result = explainTransition(before, before, submitted, ctx());

    expect(rules(result)).toEqual(["levelJumped"]);
    expect(detailOf(result, "levelJumped")).toMatchObject({ from: 1, to: 3, needed: 3600 });
  });

  test("two five-second wall steps in one save interval are charged, not refused", () => {
    const before = at({ t: WALL, id: 1, l: 1 });
    const submitted = at({ t: WALL, id: 1, l: 3 });
    const result = explainTransition(before, before, submitted, ctx());

    expect(result.violations).toEqual([]);
    expect(result.charged).toEqual([COSTS[WALL]!.costs[1]!, COSTS[WALL]!.costs[2]!]);
  });

  test("a BLK voucher takes a wall up for nothing", () => {
    const before = at({ t: WALL, id: 1, l: 1 });
    const submitted = at({ t: WALL, id: 1, l: 4 });
    const result = explainTransition(
      before,
      before,
      submitted,
      ctx({ elapsed: 0, voucher: readVoucher(["BLK4", 1]) })
    );

    expect(result.violations).toEqual([]);
    expect(result.charged).toEqual([]);
    expect(result.spentVoucher).toBe(true);
  });

  test("a BLK voucher for another level does not", () => {
    const before = at({ t: WALL, id: 1, l: 1 });
    const submitted = at({ t: WALL, id: 1, l: 4 });
    const result = explainTransition(
      before,
      before,
      submitted,
      ctx({ elapsed: 0, voucher: readVoucher(["BLK2", 1]) })
    );

    expect(rules(result)).toEqual(["levelJumped"]);
  });

  test("a building under construction reporting level 3 is levelJumped", () => {
    const before = at({ t: CANNON, id: 1, cB: 20 });
    const submitted = at({ t: CANNON, id: 1, cB: 20, l: 3 });
    const result = explainTransition(before, before, submitted, ctx({ elapsed: 0 }));

    expect(rules(result)).toEqual(["levelJumped"]);
    expect(detailOf(result, "levelJumped")).toEqual({ from: 0, to: 3 });
  });

  test("a build countdown on a building the save already had is blocked", () => {
    const before = at({ t: CANNON, id: 1, l: 2 });
    const submitted = at({ t: CANNON, id: 1, l: 2, cB: 30 });
    const result = explainTransition(before, before, submitted, ctx());

    // A build countdown on a finished building also reads as a level that
    // vanished, so the verdict names all three readings rather than picking one.
    expect(rules(result)).toContain("upgradeBlocked");
    expect(detailOf(result, "upgradeBlocked")).toEqual({ field: "cB", busy: true });
  });
});

describe("explainTransition: fortification", () => {
  test("a fortification level that climbed is recorded and never enforced", () => {
    const before = at({ t: CANNON, id: 1, l: 2 });
    const submitted = at({ t: CANNON, id: 1, l: 2, fort: 1 });
    const result = explainTransition(before, before, submitted, ctx());

    expect(rules(result)).toEqual(["fortifyUnpriced"]);
    expect(result.violations[0]!.enforced).toBe(false);
  });

  test("a fortify countdown that appeared is recorded the same way", () => {
    const before = at({ t: CANNON, id: 1, l: 2 });
    const submitted = at({ t: CANNON, id: 1, l: 2, cF: 600 });
    const result = explainTransition(before, before, submitted, ctx());

    expect(rules(result)).toEqual(["fortifyUnpriced"]);
  });
});

describe("explainNewBuilding", () => {
  test("a build in progress is charged the first step", () => {
    const result = explainNewBuilding(at({ t: CANNON, id: 9, cB: 30 }), newCtx());

    expect(result.violations).toEqual([]);
    expect(result.charged).toEqual([COSTS[CANNON]!.costs[0]!]);
    expect(result.points).toBe(0);
  });

  test("a build countdown above the step's length is countdownTooLong", () => {
    const result = explainNewBuilding(at({ t: CANNON, id: 9, cB: 90 }), newCtx());

    expect(rules(result)).toEqual(["countdownTooLong"]);
    expect(detailOf(result, "countdownTooLong")).toEqual({ field: "cB", expected: 30, sent: 90 });
  });

  test("a five-second wall is finished on the spot and charged", () => {
    const result = explainNewBuilding(at({ t: WALL, id: 9 }), newCtx());

    expect(result.violations).toEqual([]);
    expect(result.charged).toEqual([COSTS[WALL]!.costs[0]!]);
    expect(result.points).toBe(pointsForBuild(COSTS[WALL]!.costs[0]!));
  });

  test("a Town Hall earns its flat hundred on top", () => {
    const result = explainNewBuilding(at({ t: 14, id: 9 }), newCtx({ hall: 0, reference: {} }));

    expect(result.points).toBe(pointsForBuild(COSTS[14]!.costs[0]!) + 100);
  });

  test("a twelve-hour build that simply appeared is unpaidBuild", () => {
    const result = explainNewBuilding(at({ t: RAILGUN, id: 9 }), newCtx());

    expect(rules(result)).toEqual(["unpaidBuild"]);
    expect(detailOf(result, "unpaidBuild")).toEqual({ type: RAILGUN, level: 1 });
  });

  test("an IB voucher pays for it in shiny and nothing in resources", () => {
    const needed = instantCost(COSTS[RAILGUN]!.costs[0]);
    const result = explainNewBuilding(
      at({ t: RAILGUN, id: 9 }),
      newCtx({ voucher: readVoucher(["IB", needed]) })
    );

    expect(result.violations).toEqual([]);
    expect(result.charged).toEqual([]);
    expect(result.spentVoucher).toBe(true);
    expect(result.points).toBe(pointsForBuild(COSTS[RAILGUN]!.costs[0]!));
  });

  test("an IB voucher below the derived price is voucherShort", () => {
    const needed = instantCost(COSTS[RAILGUN]!.costs[0]);
    const result = explainNewBuilding(
      at({ t: RAILGUN, id: 9 }),
      newCtx({ voucher: readVoucher(["IB", needed - 1]) })
    );

    expect(rules(result)).toEqual(["voucherShort"]);
    expect(detailOf(result, "voucherShort")).toEqual({ item: "IB", quantity: needed - 1, needed });
  });

  test("a decoration the player already owned costs nothing", () => {
    const result = explainNewBuilding(at({ t: 57, id: 9 }), newCtx({ inventory: new Set([57]) }));

    expect(result.violations).toEqual([]);
    expect(result.charged).toEqual([]);
    expect(result.spentVoucher).toBe(false);
  });

  test("a decoration bought with this save's voucher costs nothing", () => {
    const result = explainNewBuilding(
      at({ t: 57, id: 9 }),
      newCtx({ voucher: readVoucher(["BUILDING57", 1]) })
    );

    expect(result.violations).toEqual([]);
    expect(result.spentVoucher).toBe(true);
  });

  test("a type the cost table does not know is unknownType", () => {
    const result = explainNewBuilding(at({ t: 9999, id: 9 }), newCtx());

    expect(rules(result)).toEqual(["unknownType"]);
    expect(detailOf(result, "unknownType")).toEqual({ type: 9999 });
  });

  test("a building whose prerequisites the yard does not meet is blocked", () => {
    const hall: BuildingDataMap = { "0": at({ t: 14, id: 0, l: 4 }) };
    const result = explainNewBuilding(
      at({ t: RAILGUN, id: 9, cB: 43200 }),
      newCtx({ hall: 4, reference: hall })
    );

    expect(rules(result)).toContain("upgradeBlocked");
    expect(detailOf(result, "upgradeBlocked")).toEqual({ townHall: { have: 4, need: 5 } });
  });
});
