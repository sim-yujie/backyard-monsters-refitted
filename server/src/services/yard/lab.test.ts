import { describe, expect, test } from "bun:test";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { planOneUpgrade } from "../yardplanner/startUpgrades.js";
import { catchUpYard } from "./catchUp.js";
import { catchUpResearch } from "./catchUpTraining.js";
import {
  labOf,
  labResearch,
  planLabCancel,
  planLabFinish,
  planLabInstant,
  planLabStart,
  powerupRank,
  type LabSave,
} from "./lab.js";
import { instantResearchPrice, timeCost } from "./shiny.js";

/**
 * The Monster Lab rules (`MONSTERLAB.CanPowerup`, `client/scripts/MONSTERLAB.as:269-313`),
 * the four plans and the catch-up, pure. The wrapper's part (charging, the
 * clamp, the write) is `controllers/yard/lab.test.ts`'s.
 */

const NOW = 1_800_000_000;
const LAB = 9;

/**
 * Town Hall 7, a level 2 Monster Lab (id 9), a silo. Bolt (C3) at level 2 can
 * take rank 1; Fink (C4) at level 3 with rank 1 can take rank 2; Fang (C8) at
 * level 1 is untrained; D.A.V.E. (C12) is at rank 3; Eye-ra (C5) is still
 * unlocking; Pokey (C1) has no ability.
 */
const saveOf = (overrides: Partial<LabSave> = {}): LabSave => ({
  resources: { r1: 0, r2: 0, r3: 1_000_000, r4: 0 },
  buildingdata: {
    "0": { id: 0, t: 14, x: 0, y: 0, l: 7 },
    "2": { id: 2, t: 6, x: 0, y: 0, l: 10 },
    [String(LAB)]: { id: LAB, t: 116, x: 0, y: 0, l: 2 },
  },
  buildinghealthdata: {},
  lockerdata: {
    C1: { t: 2 },
    C3: { t: 2 },
    C4: { t: 2 },
    C5: { t: 1, s: 1, e: NOW + 60 },
    C8: { t: 2 },
    C12: { t: 2 },
  },
  academy: {
    C1: { level: 6 },
    C3: { level: 2 },
    C4: { level: 3, powerup: 1 },
    C5: { level: 4 },
    C8: { level: 1 },
    C12: { level: 6, powerup: 3 },
  },
  ...overrides,
});

/** What `fn` threw, as `{ status, reason, ...detail }`. */
const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof ClientSafeError) return { status: err.status, ...(err.data as object) };
    throw err;
  }
  throw new Error("expected a refusal");
};

const withLab = (save: LabSave, patch: JsonObject): LabSave => ({
  ...save,
  buildingdata: {
    ...save.buildingdata,
    [String(LAB)]: { ...save.buildingdata![String(LAB)]!, ...patch },
  } as BuildingDataMap,
});

/** The yard with Bolt's rank 1 running, ending in an hour. */
const researching = (overrides: Partial<LabSave> = {}) =>
  withLab(saveOf(overrides), { upg: "C3", upt: NOW + 3_600, upl: 1 });

describe("planLabStart", () => {
  test("charges the rank's putty and writes upg, upt and upl on the Lab", () => {
    const plan = planLabStart(saveOf(), "C3", NOW);

    // C3 rank 1: 48,000 putty, 86,400 s (MONSTERLAB.as:78-88).
    expect(plan.debit).toEqual({ r3: 48_000 });
    expect(plan.report).toEqual({ monster: "C3", rank: 1, lab: LAB, endsAt: NOW + 86_400, cost: { r3: 48_000 } });
    expect(plan.slices.buildingdata[String(LAB)]).toEqual({
      id: LAB,
      t: 116,
      x: 0,
      y: 0,
      l: 2,
      upg: "C3",
      upt: NOW + 86_400,
      upl: 1,
    });
  });

  test("the next rank follows the current one", () => {
    // C4 rank 1 → 2: 128,000 putty, 108,000 s.
    expect(planLabStart(saveOf(), "C4", NOW).report).toMatchObject({ rank: 2, cost: { r3: 128_000 } });
  });

  test("refuses in the original's order", () => {
    expect(refusal(() => planLabStart(saveOf(), "C1", NOW))).toMatchObject({ status: 400, reason: "badRequest" });
    expect(refusal(() => planLabStart(saveOf(), "IC1", NOW))).toMatchObject({ status: 400 });

    const noLab = saveOf({ buildingdata: { "0": { id: 0, t: 14, x: 0, y: 0, l: 7 } } });
    expect(refusal(() => planLabStart(noLab, "C3", NOW))).toMatchObject({ status: 409, reason: "noLab" });
    expect(refusal(() => planLabStart(withLab(saveOf(), { cU: 100 }), "C3", NOW))).toMatchObject({
      reason: "busy",
      id: LAB,
    });
    expect(refusal(() => planLabStart(withLab(saveOf(), { cB: 100 }), "C3", NOW))).toMatchObject({ reason: "busy" });
    expect(
      refusal(() => planLabStart(saveOf({ buildinghealthdata: { [String(LAB)]: 10 } }), "C3", NOW))
    ).toMatchObject({ reason: "damaged", id: LAB });
    expect(refusal(() => planLabStart(researching(), "C4", NOW))).toMatchObject({
      reason: "labBusy",
      id: LAB,
      monster: "C3",
    });

    expect(refusal(() => planLabStart(saveOf(), "C5", NOW))).toMatchObject({ reason: "locked", monster: "C5" });
    expect(refusal(() => planLabStart(saveOf(), "C12", NOW))).toMatchObject({
      reason: "maxRank",
      monster: "C12",
      rank: 3,
    });
    // Rank N needs lab level N…
    expect(refusal(() => planLabStart(withLab(saveOf(), { l: 1 }), "C4", NOW))).toMatchObject({
      reason: "labLevel",
      have: 1,
      need: 2,
    });
    // …and the monster at level N + 1.
    expect(refusal(() => planLabStart(saveOf(), "C8", NOW))).toMatchObject({
      reason: "monsterLevel",
      monster: "C8",
      have: 1,
      need: 2,
    });
  });

  test("a monster with no academy entry reads as level 1", () => {
    const save = saveOf({ academy: {} });
    expect(refusal(() => planLabStart(save, "C3", NOW))).toMatchObject({ reason: "monsterLevel", have: 1 });
  });
});

describe("planLabCancel", () => {
  test("clears the Lab and credits the rank's full putty price", () => {
    const plan = planLabCancel(researching());

    expect(plan.credit).toEqual({ r3: 48_000 });
    expect(plan.report).toEqual({ monster: "C3", rank: 1, refund: { r3: 48_000 } });
    expect(plan.slices.buildingdata[String(LAB)]).toEqual({ id: LAB, t: 116, x: 0, y: 0, l: 2 });
  });

  test("refuses when nothing is researching", () => {
    expect(refusal(() => planLabCancel(saveOf()))).toMatchObject({ status: 409, reason: "notResearching" });
    // An upg with no finish time is not a research.
    expect(refusal(() => planLabCancel(withLab(saveOf(), { upg: "C3" })))).toMatchObject({
      reason: "notResearching",
    });
  });
});

describe("planLabFinish", () => {
  test("charges timeCost(upt − now) and sets the rank", () => {
    const plan = planLabFinish(researching(), NOW);

    expect(plan.shiny).toBe(timeCost(3_600));
    expect(plan.report).toEqual({ monster: "C3", rank: 1, credits: timeCost(3_600) });
    expect(plan.slices.academy.C3).toEqual({ level: 2, powerup: 1 });
    expect(plan.slices.buildingdata[String(LAB)]).not.toHaveProperty("upg");
  });

  test("is free at five minutes or less", () => {
    expect(planLabFinish(researching(), NOW + 3_400).shiny).toBe(0);
  });
});

describe("planLabInstant", () => {
  test("charges the IPU price, no putty, and leaves the Lab free", () => {
    const plan = planLabInstant(saveOf(), "C3");
    const price = instantResearchPrice(86_400, 48_000);

    expect(plan.shiny).toBe(price);
    expect(plan).not.toHaveProperty("debit");
    expect(plan.report).toEqual({ monster: "C3", rank: 1, credits: price });
    expect(plan.slices.academy.C3).toEqual({ level: 2, powerup: 1 });
    expect(plan.slices).not.toHaveProperty("buildingdata");
  });

  test("shares start's gates, the Lab's research included", () => {
    expect(refusal(() => planLabInstant(researching(), "C4"))).toMatchObject({ reason: "labBusy" });
    expect(refusal(() => planLabInstant(saveOf(), "C8"))).toMatchObject({ reason: "monsterLevel" });
  });
});

describe("reading the save", () => {
  test("powerupRank reads 0..3", () => {
    expect(powerupRank({ C3: { powerup: 2 } }, "C3")).toBe(2);
    expect(powerupRank({ C3: { level: 2 } }, "C3")).toBe(0);
    expect(powerupRank({ C3: { powerup: 9 } }, "C3")).toBe(3);
    expect(powerupRank(null, "C3")).toBe(0);
  });

  test("labResearch needs a monster with an ability, a finish time and a rank 1..3", () => {
    expect(labResearch({ id: 9, x: 0, y: 0, t: 116, upg: "C3", upt: NOW, upl: 1 })).toEqual({ monster: "C3", rank: 1, endsAt: NOW });
    expect(labResearch({ id: 9, x: 0, y: 0, t: 116, upg: "C3" })).toBeNull();
    expect(labResearch({ id: 9, x: 0, y: 0, t: 116, upg: "C1", upt: NOW, upl: 1 })).toBeNull();
    expect(labResearch({ id: 9, x: 0, y: 0, t: 116, upg: "C3", upt: NOW, upl: 4 })).toBeNull();
  });

  test("labOf takes the researching Lab first, else the first by id", () => {
    const buildingdata = {
      "4": { id: 4, t: 116, x: 0, y: 0, l: 1 },
      "8": { id: 8, t: 116, x: 0, y: 0, l: 1, upg: "C3", upt: NOW, upl: 1 },
    };
    expect(labOf(buildingdata)?.id).toBe(8);
    expect(labOf({ "4": buildingdata["4"] })?.id).toBe(4);
    expect(labOf({})).toBeNull();
  });
});

describe("the Lab cannot be upgraded while researching (MONSTERLAB.as:241-247)", () => {
  test("planOneUpgrade reads it as busy", () => {
    const save = { ...researching(), storedata: {} };
    expect(planOneUpgrade(save, LAB, NOW)).toMatchObject({ ok: false, reason: "busy" });
  });
});

describe("catchUpResearch", () => {
  test("finishes a research whose upt has passed: rank set, fields cleared", () => {
    const save = researching();
    const jobs = catchUpResearch(save, NOW + 3_600);

    expect(jobs).toEqual([
      { kind: "research", id: "C3", t: null, at: NOW + 3_600, detail: { rank: 1, lab: LAB } },
    ]);
    expect((save.academy as JsonObject).C3).toEqual({ level: 2, powerup: 1 });
    expect(save.buildingdata![String(LAB)]).toEqual({ id: LAB, t: 116, x: 0, y: 0, l: 2 });
  });

  test("leaves a research that has not ended, and is idempotent", () => {
    const save = researching();
    expect(catchUpResearch(save, NOW + 3_599)).toEqual([]);
    expect(save).toEqual(researching());

    catchUpResearch(save, NOW + 4_000);
    const after = structuredClone(save);
    expect(catchUpResearch(save, NOW + 4_000)).toEqual([]);
    expect(save).toEqual(after);
  });

  test("never lowers a rank the monster already has", () => {
    const save = withLab(saveOf(), { upg: "C4", upt: NOW, upl: 1 });
    catchUpResearch(save, NOW);
    expect((save.academy as JsonObject).C4).toEqual({ level: 3, powerup: 1 });
  });

  test("drops stale fields without crediting anything", () => {
    const save = withLab(saveOf(), { upg: "C3", upl: 1 });
    expect(catchUpResearch(save, NOW)).toEqual([]);
    expect(save.buildingdata![String(LAB)]).toEqual({ id: LAB, t: 116, x: 0, y: 0, l: 2 });
    expect(save.academy).toEqual(saveOf().academy);
  });

  test("runs inside catchUpYard and is reported in completed", () => {
    const save = { ...researching(), savetime: NOW, storedata: {} };
    const completed = catchUpYard(save, NOW + 7_200);
    expect(completed.filter((job) => job.kind === "research")).toEqual([
      { kind: "research", id: "C3", t: null, at: NOW + 3_600, detail: { rank: 1, lab: LAB } },
    ]);
  });
});
