import { describe, expect, test } from "bun:test";
import { GOALS, goalById, type GoalDef } from "../../game-data/goals.js";
import { readOnboarding, type Onboarding } from "../onboarding/state.js";
import {
  applyBaseline,
  conditionMet,
  goalMet,
  goalStatus,
  goalsReadyCount,
  markDone,
  progressOf,
  type GoalSave,
} from "./goalRules.js";

/** A goal by id, or the test fails. */
const goal = (id: string): GoalDef => {
  const found = goalById(id);
  if (!found) throw new Error(`no goal ${id}`);
  return found;
};

/** A new account's record: no baseline, nothing claimed. */
const fresh = (change: (onboarding: Onboarding) => void = () => {}): Onboarding => {
  const onboarding = readOnboarding({ onboarding: { v: 1, guide: { state: "active", step: "collect" } } });
  change(onboarding);
  return onboarding;
};

const yardOf = (...buildings: { t: number; l?: number; cB?: number }[]): GoalSave => ({
  buildingdata: Object.fromEntries(buildings.map((building, id) => [String(id), { id, x: 0, y: 0, X: 0, Y: 0, ...building }])),
  mapversion: 1,
});

describe("the list", () => {
  test("65 of Flash's quests and 3 new ones, with unique ids and known prereqs", () => {
    expect(GOALS).toHaveLength(68);
    const ids = new Set(GOALS.map((one) => one.id));
    expect(ids.size).toBe(68);
    for (const one of GOALS) if (one.prereq) expect(ids.has(one.prereq)).toBe(true);
    for (const dropped of ["C0", "C1", "C8", "EM1", "FAN", "INVITE1", "GA1", "SW4", "SW12"]) {
      expect(ids.has(dropped)).toBe(false);
    }
  });

  test("the kept quests pay Flash's totals (§6.1)", () => {
    const totals = { r1: 0, r2: 0, r3: 0, r4: 0 };
    for (const one of GOALS.filter((entry) => !entry.id.startsWith("N"))) {
      for (const key of ["r1", "r2", "r3", "r4"] as const) totals[key] += one.reward[key];
    }
    expect(totals).toEqual({ r1: 373_300, r2: 343_900, r3: 1_398_000, r4: 3_816_500 });
  });

  test("is in Flash's display order", () => {
    const orders = GOALS.map((one) => one.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(GOALS[0]!.id).toBe("U1");
  });

  test("monster rewards follow QUESTS.as", () => {
    expect(goal("UC2").monsters).toEqual({ id: "C2", count: 10 });
    expect(goal("UC12").monsters).toEqual({ id: "C12", count: 2 });
    expect(goal("C15").monsters).toEqual({ id: "C9", count: 20 });
    expect(goal("C16").monsters).toEqual({ id: "C14", count: 5 });
  });
});

describe("conditions", () => {
  const none = fresh();

  test("a building at a level, finished construction only", () => {
    const t1 = goal("T1").condition;
    expect(conditionMet(t1, yardOf({ t: 21 }), none)).toBe(true);
    expect(conditionMet(t1, yardOf({ t: 21, cB: 30 }), none)).toBe(false);
    expect(conditionMet(t1, yardOf({ t: 20 }), none)).toBe(false);
    const c13 = goal("C13").condition;
    expect(conditionMet(c13, yardOf({ t: 14, l: 1 }), none)).toBe(false);
    expect(conditionMet(c13, yardOf({ t: 14, l: 2 }), none)).toBe(true);
  });

  test("U1 takes any building at level 2; C3 needs each harvester", () => {
    expect(conditionMet(goal("U1").condition, yardOf({ t: 17, l: 2 }), none)).toBe(true);
    expect(conditionMet(goal("U1").condition, yardOf({ t: 17 }), none)).toBe(false);
    const c3 = goal("C3").condition;
    expect(conditionMet(c3, yardOf({ t: 1, l: 2 }, { t: 2, l: 2 }, { t: 3, l: 2 }), none)).toBe(false);
    expect(conditionMet(c3, yardOf({ t: 1, l: 2 }, { t: 2, l: 3 }, { t: 3, l: 2 }, { t: 4, l: 2 }), none)).toBe(
      true
    );
  });

  test("a monster unlocked in the Locker (t 2), not one unlocking", () => {
    const uc2 = goal("UC2").condition;
    expect(conditionMet(uc2, { lockerdata: { C2: { t: 2 } } }, none)).toBe(true);
    expect(conditionMet(uc2, { lockerdata: { C2: { t: 1, s: 1, e: 2 } } }, none)).toBe(false);
    expect(conditionMet(uc2, {}, none)).toBe(false);
  });

  test("champions: hatched, and level 6", () => {
    expect(conditionMet(goal("HG1").condition, { champion: [{ t: 1, l: 1 }] }, none)).toBe(true);
    expect(conditionMet(goal("HG2").condition, { champion: [{ t: 1, l: 1 }] }, none)).toBe(false);
    expect(conditionMet(goal("UG1").condition, { champion: [{ t: 1, l: 5 }] }, none)).toBe(false);
    expect(conditionMet(goal("UG1").condition, { champion: [{ t: 1, l: 6 }] }, none)).toBe(true);
  });

  test("counters, the raid and tribes come from onboarding only", () => {
    const counted = fresh((onboarding) => {
      onboarding.counters.mushrooms = 5;
      onboarding.counters.tribes.kozu = 1;
      onboarding.raidSeen = 100;
    });
    expect(conditionMet(goal("M1").condition, {}, counted)).toBe(true);
    expect(conditionMet(goal("M1").condition, {}, none)).toBe(false);
    expect(progressOf(goal("M1").condition, none)).toEqual({ have: 0, need: 5 });
    expect(conditionMet(goal("WM2").condition, {}, counted)).toBe(true);
    expect(conditionMet(goal("WM1").condition, {}, counted)).toBe(false);
    expect(conditionMet(goal("D1").condition, {}, counted)).toBe(true);
    expect(conditionMet(goal("D1").condition, {}, none)).toBe(false);
  });

  test("a saved layout meets N2", () => {
    expect(conditionMet(goal("N2").condition, { savetemplate: [] }, none)).toBe(false);
    expect(conditionMet(goal("N2").condition, { savetemplate: [{ slotid: 0, name: "A", data: "{}" }] }, none)).toBe(
      true
    );
  });
});

describe("status and the badge", () => {
  test("a met goal is ready; claimed stays claimed; prereq hides the next", () => {
    const yard = yardOf({ t: 6 });
    const onboarding = fresh();
    expect(goalStatus(goal("S1"), yard, onboarding)).toBe("ready");
    expect(goalStatus(goal("S2"), yard, onboarding)).toBe("hidden");
    onboarding.goals.S1 = { done: 1, claimed: 2 };
    expect(goalStatus(goal("S1"), yard, onboarding)).toBe("claimed");
    expect(goalStatus(goal("S2"), yard, onboarding)).toBe("open");
  });

  test("WM1-WM4 hide on Map Room 2 (Q9)", () => {
    const onboarding = fresh((record) => (record.counters.tribes.legionnaire = 1));
    expect(goalStatus(goal("WM1"), { mapversion: 1 }, onboarding)).toBe("ready");
    expect(goalStatus(goal("WM1"), { mapversion: 2 }, onboarding)).toBe("hidden");
    expect(goalStatus(goal("WM1"), { mapversion: 3 }, onboarding)).toBe("hidden");
  });

  test("done is sticky: a recycled building keeps its goal", () => {
    const onboarding = fresh();
    expect(markDone(yardOf({ t: 21 }), onboarding, 50)).toBe(true);
    expect(onboarding.goals.T1).toEqual({ done: 50 });
    expect(markDone(yardOf({ t: 21 }), onboarding, 60)).toBe(false);
    expect(goalMet(goal("T1"), yardOf(), onboarding)).toBe(true);
  });

  test("the badge counts ready goals, and 0 while the baseline is pending", () => {
    const yard = yardOf({ t: 21 }, { t: 15 }, { t: 14, l: 1 });
    expect(goalsReadyCount(yard, fresh())).toBe(2);
    const legacy = readOnboarding({ onboarding: null });
    expect(legacy.goalsBaseline).toBe("pending");
    expect(goalsReadyCount(yard, legacy)).toBe(0);
  });
});

describe("the baseline (Q1)", () => {
  test("marks every goal already met as claimed with no reward, once", () => {
    const yard = yardOf({ t: 21 }, { t: 14, l: 2 });
    const legacy = readOnboarding({ onboarding: null });
    expect(applyBaseline(yard, legacy, 100)).toBe(true);
    expect(legacy.goalsBaseline).toBe(100);
    expect(legacy.goals.T1).toEqual({ done: 100, claimed: "baseline" });
    expect(legacy.goals.C13).toEqual({ done: 100, claimed: "baseline" });
    // D1 is met for legacy saves (raidSeen 1 from the migration).
    expect(legacy.goals.D1?.claimed).toBe("baseline");
    expect(legacy.goals.T2).toBeUndefined();
    expect(applyBaseline(yard, legacy, 200)).toBe(false);
    // What is met after the baseline pays.
    expect(goalsReadyCount(yardOf({ t: 21 }, { t: 14, l: 2 }, { t: 20 }), legacy)).toBe(1);
  });

  test("a new account has no baseline to apply", () => {
    const onboarding = fresh();
    expect(applyBaseline(yardOf({ t: 21 }), onboarding, 100)).toBe(false);
    expect(onboarding.goals.T1).toBeUndefined();
  });
});
