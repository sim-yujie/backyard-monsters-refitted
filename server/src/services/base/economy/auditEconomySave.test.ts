import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { EconomyConfig } from "../../../config/EconomyConfig.js";
import { ClientSafeError } from "../../../middleware/clientSafeError.js";
import type { BuildingData, BuildingDataMap } from "../../../types/BuildingData.js";
import {
  auditEconomySave,
  type EconomyVerdict,
  type StoredEconomySave,
  type SubmittedEconomySave,
} from "./auditEconomySave.js";

/**
 * The audit end to end, over the sandbox yard the web client's tests use: 575
 * buildings, a level 10 Town Hall, 400 walls at level 1, six of each harvester
 * at level 1 with a full 720 buffer, six level 10 silos, no damage, `points`
 * and `basevalue` of "0" and resources in the billions.
 *
 * The fixture's own `savetime` is 0, which would clamp every elapsed time to
 * thirty days, so {@link at} sets it relative to a fixed `NOW` and each test
 * says how wide the gap between the two saves is.
 */

const FIXTURE = "../../../../../web/test/fixtures/baseload-sandbox-yard.json";

/** A fixed clock, so every expectation is reproducible. */
const NOW = 1_800_000_000;

const CONFIG: EconomyConfig = { mode: "log", timerTolerance: 10, overdriveMax: 2 };

/** The derived cap of the fixture yard: 10,000 plus six level 10 silos. */
const FIXTURE_CAP = 23050000;

/** The derived base value of the fixture yard, hand-summed in `resourceBudget.test.ts`. */
const FIXTURE_BASE_VALUE = "14242748";

interface Fixture {
  buildingdata: BuildingDataMap;
  buildinghealthdata: Record<string, number>;
  resources: Record<string, number>;
  storedata: Record<string, { q?: number; e?: number }>;
}

const loadFixture = (): Fixture =>
  JSON.parse(readFileSync(new URL(FIXTURE, import.meta.url), "utf8"));

/**
 * The stored save, as of `seconds` ago. Every other column is the fixture's,
 * except the ones the fixture leaves as a capture artefact.
 */
const at = (seconds: number): StoredEconomySave => {
  const fixture = loadFixture();

  return {
    savetime: NOW - seconds,
    buildingdata: structuredClone(fixture.buildingdata),
    buildinghealthdata: structuredClone(fixture.buildinghealthdata),
    resources: structuredClone(fixture.resources),
    storedata: structuredClone(fixture.storedata),
    buildingresources: {},
    researchdata: {},
    outposts: [],
    points: "0",
    basevalue: "0",
  };
};

/**
 * A submitted save with its `resources` blob pinned to a concrete shape, so
 * these tests can build a delta on top of the last one. The audit itself takes
 * it as `unknown`, because the client's JSON has no shape the server can trust.
 */
interface Submitted extends SubmittedEconomySave {
  resources: Record<string, number>;
}

/** The submitted save a client sends when nothing at all happened. */
const unchanged = (stored: StoredEconomySave): Submitted => ({
  buildingdata: structuredClone(stored.buildingdata!),
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
});

const audit = (
  stored: StoredEconomySave,
  submitted: SubmittedEconomySave,
  over: { kind?: "main" | "outpost" | "none"; pool?: StoredEconomySave } = {}
): EconomyVerdict =>
  auditEconomySave({
    kind: over.kind ?? "main",
    stored,
    pool: over.pool ?? stored,
    submitted,
    now: NOW,
    config: CONFIG,
  });

const rules = (verdict: EconomyVerdict): string[] =>
  verdict.violations.map((violation) => violation.rule);

const violationOf = (verdict: EconomyVerdict, rule: string) =>
  verdict.violations.find((violation) => violation.rule === rule);

/** The first building of a type in a yard. */
const firstOf = (yard: BuildingDataMap, type: number): [string, BuildingData] => {
  const found = Object.entries(yard).find(([, building]) => Number(building.t) === type);
  if (!found) throw new Error(`the fixture has no building of type ${type}`);
  return found;
};

/** The error a call threw, typed, so a test can read its status and data. */
const rejection = (run: () => unknown): ClientSafeError => {
  try {
    run();
  } catch (err) {
    if (err instanceof ClientSafeError) return err;
    throw err;
  }
  throw new Error("expected auditEconomySave to reject");
};

describe("a save that changed nothing", () => {
  test("breaks no rule and derives the cap and the base value", () => {
    const stored = at(60);
    const verdict = audit(stored, unchanged(stored));

    expect(verdict.violations).toEqual([]);
    expect(verdict.elapsed).toBe(60);
    expect(verdict.derived).toEqual({
      r1max: FIXTURE_CAP,
      r2max: FIXTURE_CAP,
      r3max: FIXTURE_CAP,
      r4max: FIXTURE_CAP,
      basevalue: FIXTURE_BASE_VALUE,
    });
    expect(verdict.charged).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });

  test("leaves a full harvester buffer alone, so nothing is banked", () => {
    const stored = at(3600);
    const verdict = audit(stored, unchanged(stored));

    // Six level 1 harvesters per resource, all already at their 720 cap.
    expect(verdict.budget.r1).toBe(1);
    expect(verdict.violations).toEqual([]);
  });

  test("carries the client's cap through as a log-only mismatch", () => {
    const stored = at(60);
    const submitted = unchanged(stored);
    submitted.resources = { ...submitted.resources, r1max: 999, r2max: FIXTURE_CAP };

    const verdict = audit(stored, submitted);
    expect(rules(verdict)).toEqual(["capMismatch"]);
    expect(violationOf(verdict, "capMismatch")).toEqual({
      rule: "capMismatch",
      detail: { resource: "r1", sent: 999, derived: FIXTURE_CAP },
      enforced: false,
    });
  });

  test("records a base value that differs, and never enforces it", () => {
    const stored = at(60);
    const submitted = { ...unchanged(stored), basevalue: "1" };

    const verdict = audit(stored, submitted);
    expect(violationOf(verdict, "basevalueMismatch")).toEqual({
      rule: "basevalueMismatch",
      detail: { sent: 1, derived: Number(FIXTURE_BASE_VALUE) },
      enforced: false,
    });
  });
});

describe("the delta budget", () => {
  test("a billion twigs out of nowhere is refused", () => {
    const stored = at(60);
    const submitted = unchanged(stored);
    submitted.resources = { ...submitted.resources, r1: 1_000_000_000 };

    const verdict = audit(stored, submitted);
    expect(violationOf(verdict, "resourceBudget")).toEqual({
      rule: "resourceBudget",
      detail: { resource: "r1", delta: 1_000_000_000, budget: 1 },
      enforced: true,
    });
  });

  test("the same on goo is recorded and not enforced", () => {
    const stored = at(60);
    const submitted = unchanged(stored);
    submitted.resources = { ...submitted.resources, r4: 1_000_000_000 };

    expect(violationOf(audit(stored, submitted), "resourceBudget")?.enforced).toBe(false);
  });

  test("putty is recorded and not enforced either", () => {
    const stored = at(60);
    const submitted = unchanged(stored);
    submitted.resources = { ...submitted.resources, r3: 1_000_000_000 };

    expect(violationOf(audit(stored, submitted), "resourceBudget")?.enforced).toBe(false);
  });

  test("banking a full harvester is within budget", () => {
    const stored = at(60);
    const submitted = unchanged(stored);
    const [key] = firstOf(submitted.buildingdata!, 1);
    submitted.buildingdata![key]!.st = 0;
    submitted.resources = { ...submitted.resources, r1: 720 };

    expect(audit(stored, submitted).violations).toEqual([]);
  });

  test("banking more than a harvester held is refused", () => {
    const stored = at(60);
    const submitted = unchanged(stored);
    const [key] = firstOf(submitted.buildingdata!, 1);
    submitted.buildingdata![key]!.st = 0;
    submitted.resources = { ...submitted.resources, r1: 5000 };

    expect(violationOf(audit(stored, submitted), "resourceBudget")?.detail).toEqual({
      resource: "r1",
      delta: 5000,
      // One harvester's 720, plus 1% of it as rounding slack.
      budget: 727,
    });
  });

  test("a buffer above what the harvester could have produced is bufferJumped", () => {
    const stored = at(60);
    const submitted = unchanged(stored);
    const [key, building] = firstOf(submitted.buildingdata!, 1);
    submitted.buildingdata![key]!.st = 999999;

    const verdict = audit(stored, submitted);
    expect(violationOf(verdict, "bufferJumped")).toEqual({
      rule: "bufferJumped",
      ids: [Number(building.id)],
      detail: { sent: 999999, max: 720 },
      enforced: true,
    });
  });

  test("a delta that would take a pool below zero is negativePool", () => {
    const stored = at(60);
    stored.resources = { ...stored.resources, r1: 100 };
    const submitted = unchanged(stored);
    submitted.resources = { ...submitted.resources, r1: -500 };

    expect(violationOf(audit(stored, submitted), "negativePool")).toEqual({
      rule: "negativePool",
      detail: { resource: "r1", pool: 100, delta: -500 },
      enforced: true,
    });
  });

  test("outpost income widens the budget", () => {
    const stored = at(3600);
    stored.buildingresources = { b77: { r1: 10, r2: 0, r3: 0, r4: 0 }, t: NOW - 3600 };
    const submitted = unchanged(stored);
    // 10 per ten seconds over an hour, doubled by the overdrive bound.
    submitted.resources = { ...submitted.resources, r1: 7200 };

    expect(audit(stored, submitted).violations).toEqual([]);
    expect(audit(stored, submitted).budget.r1).toBe(7200 + 72);
  });
});

describe("storage caps", () => {
  test("a positive delta may not carry a pool from under the cap to over it", () => {
    const stored = at(3600);
    stored.resources = { ...stored.resources, r1: FIXTURE_CAP - 100 };
    const submitted = unchanged(stored);
    const [key] = firstOf(submitted.buildingdata!, 1);
    submitted.buildingdata![key]!.st = 0;
    submitted.resources = { ...submitted.resources, r1: 720 };

    const verdict = audit(stored, submitted);
    expect(violationOf(verdict, "overCap")).toEqual({
      rule: "overCap",
      detail: { resource: "r1", cap: FIXTURE_CAP, pool: FIXTURE_CAP - 100 },
      enforced: true,
    });
  });

  test("a pool that was already over the cap is left alone", () => {
    const stored = at(60);
    const submitted = unchanged(stored);

    // The sandbox pool of 11,163,050,000 sits far above the derived cap.
    expect(rules(audit(stored, submitted))).not.toContain("overCap");
  });
});

describe("buildings", () => {
  test("a new Cannon Tower under construction is charged its first step", () => {
    const stored = at(60);
    const [existing] = firstOf(stored.buildingdata!, 20);
    delete stored.buildingdata![existing];

    const submitted = unchanged(stored);
    submitted.buildingdata!["9001"] = { x: 0, y: 0, t: 20, id: 9001, cB: 30 };
    submitted.resources = { r1: -2000, r2: -1500, r3: -500, r4: 0 };

    const verdict = audit(stored, submitted);
    expect(verdict.violations).toEqual([]);
    expect(verdict.charged).toEqual({ r1: 2000, r2: 1500, r3: 500, r4: 0 });
  });

  test("spending more than the server expected is not a violation", () => {
    const stored = at(60);
    const [existing] = firstOf(stored.buildingdata!, 20);
    delete stored.buildingdata![existing];

    const submitted = unchanged(stored);
    submitted.buildingdata!["9001"] = { x: 0, y: 0, t: 20, id: 9001, cB: 30 };
    submitted.resources = { r1: -9000, r2: -9000, r3: -9000, r4: -9000 };

    expect(audit(stored, submitted).violations).toEqual([]);
  });

  test("a building that appeared without the delta to pay for it is refused", () => {
    const stored = at(60);
    const [existing] = firstOf(stored.buildingdata!, 20);
    delete stored.buildingdata![existing];

    const submitted = unchanged(stored);
    submitted.buildingdata!["9001"] = { x: 0, y: 0, t: 20, id: 9001, cB: 30 };
    submitted.resources = { r1: 1, r2: -1500, r3: -500, r4: 0 };

    // The budget is the production terms minus what the save should have spent,
    // so a delta that did not pay for the tower is over it.
    expect(violationOf(audit(stored, submitted), "resourceBudget")?.detail).toEqual({
      resource: "r1",
      delta: 1,
      budget: -1999,
    });
  });

  test("a seventy-sixth Booby Trap is over the Town Hall's allowance", () => {
    const stored = at(60);
    const submitted = unchanged(stored);
    submitted.buildingdata!["9001"] = { x: 0, y: 0, t: 24, id: 9001 };

    expect(violationOf(audit(stored, submitted), "capReached")).toEqual({
      rule: "capReached",
      detail: { type: 24, have: 76, max: 75 },
      enforced: true,
    });
  });

  test("a four hundred and first wall is over it too", () => {
    const stored = at(60);
    const submitted = unchanged(stored);
    submitted.buildingdata!["9001"] = { x: 0, y: 0, t: 17, id: 9001 };

    expect(violationOf(audit(stored, submitted), "capReached")?.detail).toEqual({
      type: 17,
      have: 401,
      max: 400,
    });
  });

  test("a Railgun under a level 4 Town Hall names the gate it failed", () => {
    const stored = at(60);
    const [hallKey] = firstOf(stored.buildingdata!, 14);
    stored.buildingdata![hallKey]!.l = 4;

    const submitted = unchanged(stored);
    submitted.buildingdata!["9001"] = { x: 0, y: 0, t: 118, id: 9001, cB: 43200 };

    expect(violationOf(audit(stored, submitted), "upgradeBlocked")).toMatchObject({
      rule: "upgradeBlocked",
      ids: [9001],
      detail: { townHall: { have: 4, need: 5 } },
      enforced: true,
    });
  });

  test("recycling a level 1 wall pays back half its cost", () => {
    const stored = at(60);
    const submitted = unchanged(stored);
    const [key] = firstOf(submitted.buildingdata!, 17);
    delete submitted.buildingdata![key];
    submitted.resources = { ...submitted.resources, r1: 500 };

    const verdict = audit(stored, submitted);
    expect(verdict.violations).toEqual([]);
    expect(verdict.budget.r1).toBe(501);
  });

  test("a building that changed type is typeChanged", () => {
    const stored = at(60);
    const submitted = unchanged(stored);
    const [key, building] = firstOf(submitted.buildingdata!, 17);
    submitted.buildingdata![key] = { ...building, t: 20 };

    expect(violationOf(audit(stored, submitted), "typeChanged")).toEqual({
      rule: "typeChanged",
      ids: [Number(building.id)],
      detail: { from: 17, to: 20 },
      enforced: true,
    });
  });

  test("the legacy Stone Block rewrite is not a type change", () => {
    const stored = at(60);
    const [key, building] = firstOf(stored.buildingdata!, 17);
    stored.buildingdata![key] = { ...building, t: 18 };

    const submitted = unchanged(stored);
    submitted.buildingdata![key] = { ...building, t: 17, l: 2 };

    expect(rules(audit(stored, submitted))).not.toContain("typeChanged");
  });

  test("a level that rose with nothing to explain it is refused", () => {
    const stored = at(60);
    const submitted = unchanged(stored);
    const [key, building] = firstOf(submitted.buildingdata!, 20);
    submitted.buildingdata![key] = { ...building, l: 10 };

    const verdict = audit(stored, submitted);
    expect(rules(verdict)).toContain("levelJumped");
    expect(violationOf(verdict, "levelJumped")?.ids).toEqual([Number(building.id)]);
  });

  test("a save with no buildingdata at all leaves the yard alone", () => {
    const stored = at(60);
    const verdict = audit(stored, { resources: { r1: 0, r2: 0, r3: 0, r4: 0 } });

    expect(verdict.violations).toEqual([]);
    expect(verdict.derived.basevalue).toBe(FIXTURE_BASE_VALUE);
  });
});

describe("the tutorial bootstrap", () => {
  /** The four buildings a brand new account's first save places. */
  const opening = (): BuildingDataMap => ({
    "0": { x: 0, y: 0, t: 14, id: 0, l: 1 },
    "1": { x: 20, y: 0, t: 1, id: 1, l: 1, st: 0 },
    "2": { x: 40, y: 0, t: 2, id: 2, l: 1, st: 0 },
    "3": { x: 60, y: 0, t: 12, id: 3, l: 1 },
  });

  test("passes from an empty yard", () => {
    const stored: StoredEconomySave = {
      savetime: NOW - 60,
      buildingdata: {},
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
      points: "0",
      basevalue: "0",
    };

    const verdict = audit(stored, {
      buildingdata: opening(),
      resources: { r1: 1600, r2: 1600, r3: 0, r4: 0 },
    });

    expect(verdict.violations).toEqual([]);
    expect(verdict.budget.r1).toBe(1601);
  });

  test("the same four buildings on a yard that already has them are not free", () => {
    const stored = at(60);
    const submitted = unchanged(stored);
    for (const [key, building] of Object.entries(opening())) {
      submitted.buildingdata![`900${key}`] = { ...building, id: Number(`900${key}`) };
    }
    submitted.resources = { r1: 1600, r2: 1600, r3: 0, r4: 0 };

    const verdict = audit(stored, submitted);
    expect(rules(verdict)).toContain("capReached");
    expect(violationOf(verdict, "resourceBudget")?.detail).toMatchObject({ resource: "r1" });
  });
});

describe("points", () => {
  test("points that did not move are within budget", () => {
    const stored = at(60);
    const verdict = audit(stored, { ...unchanged(stored), points: "0" });

    expect(verdict.violations).toEqual([]);
  });

  test("points that fell are pointsJumped", () => {
    const stored = at(60);
    stored.points = "500";
    const verdict = audit(stored, { ...unchanged(stored), points: "-1" });

    expect(violationOf(verdict, "pointsJumped")).toEqual({
      rule: "pointsJumped",
      detail: { delta: -501, budget: 4 },
      enforced: true,
    });
  });

  test("points that climbed further than banking allows are pointsJumped", () => {
    const stored = at(60);
    const verdict = audit(stored, { ...unchanged(stored), points: "1000000" });

    expect(violationOf(verdict, "pointsJumped")?.detail).toMatchObject({ delta: 1000000 });
  });

  test("the points a completed upgrade earns are inside the budget", () => {
    const stored = at(60);
    const [key, building] = firstOf(stored.buildingdata!, 20);
    stored.buildingdata![key] = { ...building, cU: 68 };

    const submitted = unchanged(stored);
    submitted.buildingdata![key] = { ...building, l: 2 };

    // floor((900 + 10000 + 7500 + 2500) / 3) for the level 1 to 2 step.
    const verdict = audit(stored, { ...submitted, points: "6966" });
    expect(verdict.violations).toEqual([]);
  });
});

describe("malformed bodies", () => {
  test("a buildingdata that is not a map of buildings is a 400", () => {
    const stored = at(60);
    const error = rejection(() =>
      audit(stored, { buildingdata: { "1": 7 } as unknown as BuildingDataMap })
    );

    expect(error.status).toBe(400);
    expect(error.data).toMatchObject({ rule: "malformed" });
  });

  test("a building with no type is a 400", () => {
    const stored = at(60);
    const error = rejection(() =>
      audit(stored, { buildingdata: { "1": { x: 0, y: 0, id: 1 } as unknown as BuildingData } })
    );

    expect(error.status).toBe(400);
  });

  test("a resource delta that is not a number is a 400", () => {
    const stored = at(60);
    const error = rejection(() =>
      audit(stored, { ...unchanged(stored), resources: { r1: "lots" } })
    );

    expect(error.status).toBe(400);
  });

  test("points that are not a number is a 400", () => {
    const stored = at(60);
    const error = rejection(() => audit(stored, { ...unchanged(stored), points: "abc" }));

    expect(error.status).toBe(400);
  });
});

describe("outpost sessions", () => {
  test("ignore every building change but still bound the delta", () => {
    const stored = at(60);
    const pool = at(60);
    const submitted = unchanged(stored);

    const [key, building] = firstOf(submitted.buildingdata!, 20);
    submitted.buildingdata![key] = { ...building, l: 10 };
    submitted.resources = { ...submitted.resources, r1: 1_000_000_000 };

    const verdict = audit(stored, submitted, { kind: "outpost", pool });

    expect(rules(verdict)).toEqual(["resourceBudget"]);
    expect(violationOf(verdict, "resourceBudget")?.enforced).toBe(true);
  });

  test("get no harvester allowance of their own", () => {
    const stored = at(3600);
    const pool = at(3600);
    const submitted = unchanged(stored);
    const [key] = firstOf(submitted.buildingdata!, 1);
    submitted.buildingdata![key]!.st = 0;

    expect(audit(stored, submitted, { kind: "outpost", pool }).budget.r1).toBe(1);
  });

  test("leave the caps and the base value exactly as they were", () => {
    const stored = at(60);
    const pool = at(60);
    const verdict = audit(stored, unchanged(stored), { kind: "outpost", pool });

    expect(verdict.derived.r1max).toBe(11163050000);
    expect(verdict.derived.basevalue).toBe("0");
  });
});

describe("saves that are not audited", () => {
  test("a kind of none breaks no rule and derives nothing new", () => {
    const stored = at(60);
    const submitted = unchanged(stored);
    submitted.resources = { ...submitted.resources, r1: 1_000_000_000 };

    const verdict = audit(stored, submitted, { kind: "none" });

    expect(verdict.violations).toEqual([]);
    expect(verdict.derived.r1max).toBe(11163050000);
    expect(verdict.derived.basevalue).toBe("0");
    expect(verdict.elapsed).toBe(60);
  });
});

describe("vouchers", () => {
  test("one speed-up cannot finish two countdowns", () => {
    const stored = at(60);
    const walls = Object.entries(stored.buildingdata!)
      .filter(([, building]) => Number(building.t) === 17)
      .slice(0, 2);

    // Just under an hour left on each: far too long to finish for free, and
    // inside what one SP2 can take off.
    for (const [key, building] of walls) {
      stored.buildingdata![key] = { ...building, l: 2, cU: 3500 };
    }

    const submitted = unchanged(stored);
    for (const [key, building] of walls) {
      submitted.buildingdata![key] = { ...building, l: 3 };
    }

    const verdict = audit(stored, { ...submitted, purchase: ["SP2", 20] });
    expect(violationOf(verdict, "voucherShort")?.detail).toMatchObject({
      item: "SP2",
      used: 2,
      allowed: 1,
    });
  });

  test("a BLK voucher may finish every wall at once", () => {
    const stored = at(60);
    const submitted = unchanged(stored);

    for (const [key, building] of Object.entries(submitted.buildingdata!)) {
      if (Number(building.t) === 17) submitted.buildingdata![key] = { ...building, l: 2 };
    }

    const verdict = audit(stored, { ...submitted, purchase: ["BLK2", 1] });
    expect(rules(verdict)).not.toContain("voucherShort");
    expect(rules(verdict)).not.toContain("levelJumped");
  });

  test("a top-up below the derived price is voucherShort", () => {
    const stored = at(60);
    stored.resources = { r1: 0, r2: 0, r3: 0, r4: 0 };
    const [existing] = firstOf(stored.buildingdata!, 20);
    delete stored.buildingdata![existing];

    const submitted = unchanged(stored);
    submitted.buildingdata!["9001"] = { x: 0, y: 0, t: 20, id: 9001, cB: 30 };
    submitted.resources = { r1: 0, r2: 0, r3: 0, r4: 0 };

    const verdict = audit(stored, { ...submitted, purchase: ["BRTOPUP", 1] });
    expect(violationOf(verdict, "voucherShort")?.detail).toMatchObject({
      item: "BRTOPUP",
      quantity: 1,
    });
  });
});
