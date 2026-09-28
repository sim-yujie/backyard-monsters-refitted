import { describe, expect, test } from "bun:test";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import {
  academiesOf,
  academyTraining,
  planAcademyCancel,
  planAcademyFinish,
  planAcademyInstant,
  planAcademyTrain,
  trainedAcademy,
  type AcademySave,
} from "./academy.js";
import { instantTrainPrice, timeCost } from "./shiny.js";

/**
 * The academy rules (`ACADEMY.StartMonsterUpgrade`, `client/scripts/ACADEMY.as:54-131`)
 * and the four plans, pure. The wrapper's part (charging, the clamp, the
 * write) is `controllers/yard/academy.test.ts`'s.
 */

const NOW = 1_800_000_000;

/** Town Hall 7, two Monster Academies (id 5 at level 3, id 6 at level 1), a silo. */
const saveOf = (overrides: Partial<AcademySave> = {}): AcademySave => ({
  resources: { r1: 0, r2: 0, r3: 1_000_000, r4: 0 },
  buildingdata: {
    "0": { id: 0, t: 14, x: 0, y: 0, l: 7 },
    "2": { id: 2, t: 6, x: 0, y: 0, l: 10 },
    "5": { id: 5, t: 26, x: 0, y: 0, l: 3 },
    "6": { id: 6, t: 26, x: 0, y: 0, l: 1 },
  },
  buildinghealthdata: {},
  lockerdata: { C1: { t: 2 }, C2: { t: 2 }, C5: { t: 2 }, C15: { t: 2 }, C6: { t: 1, s: 1, e: NOW + 60 } },
  academy: { C1: { level: 1 }, C2: { level: 3, powerup: 1 }, C5: { level: 1 } },
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

const withBuilding = (save: AcademySave, id: number, patch: JsonObject): AcademySave => ({
  ...save,
  buildingdata: {
    ...save.buildingdata,
    [String(id)]: { ...save.buildingdata![String(id)]!, ...patch },
  } as BuildingDataMap,
});

describe("planAcademyTrain", () => {
  test("charges the step's putty and writes time, duration and the academy's upg", () => {
    const plan = planAcademyTrain(saveOf(), "C2", 5, NOW);

    // C2 3 → 4: 24,000 putty, 36,000 s (monsterCatalogue.ts).
    expect(plan.debit).toEqual({ r3: 24_000 });
    expect(plan.report).toEqual({ monster: "C2", academy: 5, to: 4, endsAt: NOW + 36_000, cost: { r3: 24_000 } });
    expect(plan.slices.academy.C2).toEqual({ level: 3, powerup: 1, time: NOW + 36_000, duration: 36_000 });
    expect(plan.slices.buildingdata["5"]).toMatchObject({ t: 26, upg: "C2" });
    expect(plan.slices.buildingdata["6"]).not.toHaveProperty("upg");
  });

  test("without an academy takes the lowest-level idle one that can train it (#180)", () => {
    // C1 at level 1 fits both: academy 6 (level 1) is the lower, so academy 5
    // (level 3) stays free.
    expect(planAcademyTrain(saveOf(), "C1", undefined, NOW).report.academy).toBe(6);
    // C2 at level 3 needs an academy at level 3: only 5 can.
    expect(planAcademyTrain(saveOf(), "C2", undefined, NOW).report.academy).toBe(5);
    // Academy 6 busy: C1 goes to 5, the one idle academy left.
    const sixBusy = withBuilding(
      saveOf({ academy: { C1: { level: 1 }, C2: { level: 3 }, C5: { level: 1, time: NOW + 10 } } }),
      6,
      { upg: "C5" }
    );
    expect(planAcademyTrain(sixBusy, "C1", undefined, NOW).report.academy).toBe(5);
    // Academy 5 busy: C1 still fits 6…
    const busy = withBuilding(
      saveOf({ academy: { C1: { level: 1 }, C2: { level: 3 }, C5: { level: 1, time: NOW + 10 } } }),
      5,
      { upg: "C5" }
    );
    expect(planAcademyTrain(busy, "C1", undefined, NOW).report.academy).toBe(6);
    // …but C2 at level 3 does not.
    expect(refusal(() => planAcademyTrain(busy, "C2", undefined, NOW))).toMatchObject({
      status: 409,
      reason: "academyLevel",
      have: 1,
      need: 3,
    });
  });

  test("breaks a tie between equal academies by building id", () => {
    const base = saveOf();
    const many: AcademySave = {
      ...base,
      buildingdata: {
        ...base.buildingdata,
        "3": { id: 3, t: 26, x: 0, y: 0, l: 3 },
        "9": { id: 9, t: 26, x: 0, y: 0, l: 1 },
        "12": { id: 12, t: 26, x: 0, y: 0, l: 2 },
      } as BuildingDataMap,
    };
    // Level 1 academies 6 and 9: 6. Level 3 academies 3 and 5: 3. C2 at level 3
    // skips level 2 academy 12, which cannot train it.
    expect(planAcademyTrain(many, "C1", undefined, NOW).report.academy).toBe(6);
    expect(planAcademyTrain(many, "C2", undefined, NOW).report.academy).toBe(3);
  });

  test("a monster with no academy entry trains from level 1", () => {
    const plan = planAcademyTrain(saveOf({ academy: {} }), "C1", 6, NOW);
    expect(plan.slices.academy.C1).toEqual({ level: 1, time: NOW + 7_200, duration: 7_200 });
    expect(plan.debit).toEqual({ r3: 4_000 });
  });

  test("refuses in the original's order", () => {
    const busy = withBuilding(saveOf({ academy: { C5: { level: 1, time: NOW + 10 } } }), 5, { upg: "C5" });
    // 1. the named academy is training (acad_err_busy), ahead of everything about the monster.
    expect(refusal(() => planAcademyTrain(busy, "C5", 5, NOW))).toMatchObject({
      status: 409,
      reason: "academyBusy",
      id: 5,
      monster: "C5",
    });
    // 2. the monster is already training.
    expect(refusal(() => planAcademyTrain(busy, "C5", 6, NOW))).toMatchObject({
      reason: "training",
      monster: "C5",
      endsAt: NOW + 10,
    });
    // 3. not unlocked (C6 is still unlocking).
    expect(refusal(() => planAcademyTrain(saveOf(), "C6", 5, NOW))).toMatchObject({
      reason: "locked",
      monster: "C6",
    });
    // 4. fully trained: C15's ladder stops at 5.
    expect(
      refusal(() => planAcademyTrain(saveOf({ academy: { C15: { level: 5 } } }), "C15", 5, NOW))
    ).toMatchObject({ reason: "maxLevel", monster: "C15", level: 5 });
    expect(
      refusal(() => planAcademyTrain(saveOf({ academy: { C1: { level: 6 } } }), "C1", 5, NOW))
    ).toMatchObject({ reason: "maxLevel", level: 6 });
    // 5. level N → N+1 needs an academy at level N.
    expect(refusal(() => planAcademyTrain(saveOf(), "C2", 6, NOW))).toMatchObject({
      reason: "academyLevel",
      have: 1,
      need: 3,
    });
  });

  test("an academy being built, upgraded or damaged cannot train", () => {
    const upgrading = withBuilding(saveOf(), 5, { cU: 100 });
    expect(refusal(() => planAcademyTrain(upgrading, "C1", 5, NOW))).toMatchObject({ reason: "busy", id: 5 });
    const building = withBuilding(saveOf(), 5, { cB: 100 });
    expect(refusal(() => planAcademyTrain(building, "C1", 5, NOW))).toMatchObject({ reason: "busy", id: 5 });
    const damaged = { ...saveOf(), buildinghealthdata: { "5": 100 } };
    expect(refusal(() => planAcademyTrain(damaged, "C1", 5, NOW))).toMatchObject({ reason: "damaged", id: 5 });
    // Without a name the other academy steps in.
    expect(planAcademyTrain(damaged, "C1", undefined, NOW).report.academy).toBe(6);
  });

  test("a stale upg (naming a monster not training) reads as idle", () => {
    const stale = withBuilding(saveOf(), 5, { upg: "C1" });
    expect(academyTraining(stale.buildingdata!["5"]!, stale.academy)).toBeNull();
    expect(planAcademyTrain(stale, "C2", 5, NOW).slices.buildingdata["5"]).toMatchObject({ upg: "C2" });
  });

  test("malformed names are 400s; no academy is noAcademy", () => {
    expect(refusal(() => planAcademyTrain(saveOf(), "C18", 5, NOW))).toMatchObject({ status: 400 });
    expect(refusal(() => planAcademyTrain(saveOf(), "IC1", 5, NOW))).toMatchObject({ status: 400 });
    expect(refusal(() => planAcademyTrain(saveOf(), "C1", 99, NOW))).toMatchObject({ status: 400, id: 99 });
    expect(refusal(() => planAcademyTrain(saveOf(), "C1", 2, NOW))).toMatchObject({ status: 400, id: 2 });

    const none = saveOf({ buildingdata: { "0": { id: 0, t: 14, x: 0, y: 0, l: 7 } } });
    expect(refusal(() => planAcademyTrain(none, "C1", undefined, NOW))).toMatchObject({
      status: 409,
      reason: "noAcademy",
    });
    const unbuilt = saveOf({ buildingdata: { "5": { id: 5, t: 26, x: 0, y: 0, cB: 50 } } });
    expect(refusal(() => planAcademyTrain(unbuilt, "C1", undefined, NOW))).toMatchObject({ reason: "noAcademy" });
  });

  test("with every academy busy, says which", () => {
    const save = withBuilding(
      withBuilding(saveOf({ academy: { C1: { level: 1 }, C5: { level: 1, time: NOW + 10 }, C2: { level: 3, time: NOW + 20 } } }), 5, { upg: "C5" }),
      6,
      { upg: "C2" }
    );
    expect(refusal(() => planAcademyTrain(save, "C1", undefined, NOW))).toMatchObject({
      reason: "academyBusy",
      id: 5,
      monster: "C5",
    });
  });
});

describe("planAcademyCancel", () => {
  const training = () =>
    withBuilding(saveOf({ academy: { C2: { level: 3, powerup: 1, time: NOW + 500, duration: 36_000 } } }), 5, {
      upg: "C2",
    });

  test("refunds the step's full putty and frees the academy", () => {
    const plan = planAcademyCancel(training(), "C2");
    expect(plan.credit).toEqual({ r3: 24_000 });
    expect(plan.report).toEqual({ monster: "C2", refund: { r3: 24_000 } });
    expect(plan.slices.academy.C2).toEqual({ level: 3, powerup: 1 });
    expect(plan.slices.buildingdata!["5"]).not.toHaveProperty("upg");
  });

  test("reports what the storage cap lets back", () => {
    // A pool already over its cap takes nothing back.
    const save = training();
    const plan = planAcademyCancel({ ...save, resources: { r3: 1e12 } }, "C2");
    expect(plan.report.refund.r3).toBe(0);
    expect(plan.credit).toEqual({ r3: 24_000 });
  });

  test("notTraining when it is not", () => {
    expect(refusal(() => planAcademyCancel(saveOf(), "C2"))).toMatchObject({
      status: 409,
      reason: "notTraining",
      monster: "C2",
    });
  });
});

describe("planAcademyFinish", () => {
  test("raises the level for timeCost(time − now), free at five minutes", () => {
    const save = withBuilding(saveOf({ academy: { C2: { level: 3, time: NOW + 3_600, duration: 36_000 } } }), 5, {
      upg: "C2",
    });
    const plan = planAcademyFinish(save, "C2", NOW);
    expect(plan.shiny).toBe(timeCost(3_600));
    expect(plan.shiny).toBe(20);
    expect(plan.report).toEqual({ monster: "C2", level: 4, credits: 20 });
    expect(plan.slices.academy.C2).toEqual({ level: 4 });
    expect(plan.slices.buildingdata!["5"]).not.toHaveProperty("upg");

    expect(planAcademyFinish(save, "C2", NOW + 3_400).shiny).toBe(0);
  });

  test("notTraining when it is not", () => {
    expect(refusal(() => planAcademyFinish(saveOf(), "C1", NOW))).toMatchObject({ reason: "notTraining" });
  });
});

describe("planAcademyInstant", () => {
  test("raises the level at once for the ITR price, no putty, no academy taken", () => {
    const plan = planAcademyInstant(saveOf(), "C2", undefined);
    expect(plan.shiny).toBe(instantTrainPrice(36_000, 24_000));
    expect(plan).not.toHaveProperty("debit");
    expect(plan.report).toEqual({ monster: "C2", level: 4, credits: plan.shiny });
    expect(plan.slices).not.toHaveProperty("buildingdata");
    expect(plan.slices.academy.C2).toEqual({ level: 4, powerup: 1 });
  });

  test("the train checks apply", () => {
    expect(refusal(() => planAcademyInstant(saveOf(), "C2", 6))).toMatchObject({ reason: "academyLevel" });
    expect(refusal(() => planAcademyInstant(saveOf(), "C6", 5))).toMatchObject({ reason: "locked" });
  });
});

describe("pieces", () => {
  test("academiesOf lists academies in id order with their level (0 while built)", () => {
    const save = withBuilding(saveOf(), 6, { cB: 10 });
    expect(academiesOf(save.buildingdata).map(({ id, level }) => [id, level])).toEqual([
      [5, 3],
      [6, 0],
    ]);
  });

  test("trainedAcademy never passes the top of the ladder", () => {
    expect(trainedAcademy({ C15: { level: 5, time: 1 } }, "C15")).toEqual({ C15: { level: 5 } });
    expect(trainedAcademy({}, "C1")).toEqual({ C1: { level: 2 } });
  });
});
