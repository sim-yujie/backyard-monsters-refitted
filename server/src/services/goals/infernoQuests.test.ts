import { describe, expect, test } from "bun:test";
import { GOALS } from "../../game-data/goals.js";
import { INFERNO_GOALS, infernoGoalById } from "../../game-data/infernoGoals.js";
import type { GoalDef } from "../../game-data/goals.js";
import { readOnboarding, type Onboarding } from "../onboarding/state.js";
import {
  goalBookOf,
  goalMet,
  goalStatus,
  goalVisible,
  goalsReadyCount,
  INFERNO_QUESTS,
  isClaimed,
  markDone,
  SURFACE_GOALS,
  type GoalSave,
} from "./goalRules.js";

/**
 * The Inferno's 38 quests (`docs/design/inferno.md` §2.8, WP 4.1): Flash's
 * data (`client/scripts/INFERNO_QUESTS.as`) and how each rule reads the
 * Inferno yard.
 */

const quest = (id: string): GoalDef => {
  const found = infernoGoalById(id);
  if (!found) throw new Error(`no quest ${id}`);
  return found;
};

const fresh = (change: (onboarding: Onboarding) => void = () => {}): Onboarding => {
  const onboarding = readOnboarding({ onboarding: { v: 1, guide: { state: "legacy" } } });
  change(onboarding);
  return onboarding;
};

/** The Inferno yard as its yard actions see it: `type` inferno, its own buildings and Strongbox. */
const inferno = (buildings: { t: number; l?: number; cB?: number }[] = [], lockerdata: GoalSave["lockerdata"] = {}): GoalSave => ({
  type: "inferno",
  buildingdata: Object.fromEntries(buildings.map((building, id) => [String(id), { id, X: 0, Y: 0, ...building }])),
  lockerdata,
});

const UNLOCKED = { t: 2 };

describe("the data", () => {
  test("38 quests with unique ids, none shared with the surface's Goals", () => {
    expect(INFERNO_GOALS).toHaveLength(38);
    const ids = new Set(INFERNO_GOALS.map((one) => one.id));
    expect(ids.size).toBe(38);
    for (const surface of GOALS) expect(ids.has(surface.id)).toBe(false);
  });

  test("the resource prizes add up to Flash's totals: 358,000 / 298,000 / 248,000 / 239,000", () => {
    const total = { r1: 0, r2: 0, r3: 0, r4: 0 };
    for (const one of INFERNO_GOALS) {
      for (const key of ["r1", "r2", "r3", "r4"] as const) total[key] += one.reward[key];
    }
    expect(total).toEqual({ r1: 358_000, r2: 298_000, r3: 248_000, r4: 239_000 });
  });

  test("Shiny on five quests, 85 in all (R12)", () => {
    const shiny = Object.fromEntries(INFERNO_GOALS.filter((one) => one.shiny).map((one) => [one.id, one.shiny]));
    expect(shiny).toEqual({ IQT1: 10, IT3: 10, IS5: 15, IUT3: 25, IQT3: 25 });
    expect(Object.values(shiny).reduce((sum, amount) => sum + amount!, 0)).toBe(85);
  });

  test("Flash's monster rewards", () => {
    const monsters = Object.fromEntries(
      INFERNO_GOALS.filter((one) => one.monsters).map((one) => [one.id, `${one.monsters!.count} ${one.monsters!.id}`])
    );
    expect(monsters).toEqual({
      IUC2: "10 IC2",
      IUC3: "10 IC3",
      IUC5: "2 IC4",
      IUC6: "15 IC6",
      IC15: "20 IC4",
      IUC10: "20 IC5",
      IUC11: "5 IC7",
      IC16: "5 IC7",
      IUC12: "2 IC8",
    });
  });

  test("in display order; no prereqs, no Inferno switch, no Map Room 1 mark", () => {
    const orders = INFERNO_GOALS.map((one) => one.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    for (const one of INFERNO_GOALS) {
      expect(one.prereq).toBeUndefined();
      expect(one.inferno).toBeUndefined();
      expect(one.mapRoom1Only).toBeUndefined();
    }
  });

  test("Flash's quirks kept: IUC5 'Unlock Valgos' reads Balthazar, IS2 'Level 3' reads level 2", () => {
    expect(quest("IUC5").name).toBe("Unlock Valgos");
    expect(quest("IUC5").condition).toEqual({ kind: "unlocked", monster: "IC5" });
    expect(quest("IUC10").condition).toEqual({ kind: "unlocked", monster: "IC5" });
    expect(quest("IS2").name).toBe("Upgrade Resource Pod to Level 3");
    expect(quest("IS2").condition).toEqual({ kind: "building", type: 6, level: 2 });
  });
});

describe("the book", () => {
  test("the Inferno yard reads the Inferno quests; the main yard and an outpost the Goals", () => {
    expect(goalBookOf({ type: "inferno" })).toBe(INFERNO_QUESTS);
    expect(goalBookOf({ type: "main" })).toBe(SURFACE_GOALS);
    expect(goalBookOf({ type: "outpost" })).toBe(SURFACE_GOALS);
    expect(goalBookOf({})).toBe(SURFACE_GOALS);
  });

  test("records go to onboarding.infernoGoals, apart from the Goals", () => {
    const onboarding = fresh();
    const yard = inferno([{ t: 21, l: 1 }]);
    expect(markDone(yard, onboarding, 500, INFERNO_QUESTS)).toBe(true);
    expect(onboarding.infernoGoals.IT1).toEqual({ done: 500 });
    expect(onboarding.goals).toEqual({});
    // Nothing new the second time.
    expect(markDone(yard, onboarding, 600, INFERNO_QUESTS)).toBe(false);
  });

  test("a surface goal of the same shape is not claimed by an Inferno record", () => {
    const onboarding = fresh((record) => {
      record.infernoGoals.IT1 = { done: 1, claimed: 2 };
    });
    expect(isClaimed(onboarding, "IT1", INFERNO_QUESTS)).toBe(true);
    expect(isClaimed(onboarding, "IT1", SURFACE_GOALS)).toBe(false);
  });
});

describe("the rules on the Inferno yard", () => {
  test("a building at a level: the Sharpshooter (21), the Under Hall (14) at 2", () => {
    const onboarding = fresh();
    expect(goalStatus(quest("IT1"), inferno(), onboarding, INFERNO_QUESTS)).toBe("open");
    expect(goalStatus(quest("IT1"), inferno([{ t: 21, l: 1 }]), onboarding, INFERNO_QUESTS)).toBe("ready");
    expect(goalMet(quest("IC13"), inferno([{ t: 14, l: 1 }]), onboarding, INFERNO_QUESTS)).toBe(false);
    expect(goalMet(quest("IC13"), inferno([{ t: 14, l: 2 }]), onboarding, INFERNO_QUESTS)).toBe(true);
  });

  test("a building still under construction does not count", () => {
    expect(goalMet(quest("ICR3"), inferno([{ t: 128, l: 1, cB: 30 }]), fresh(), INFERNO_QUESTS)).toBe(false);
    expect(goalMet(quest("ICR3"), inferno([{ t: 128, l: 1 }]), fresh(), INFERNO_QUESTS)).toBe(true);
  });

  test("IS2 is met by a level 2 Resource Pod, as Flash checked", () => {
    expect(goalMet(quest("IS2"), inferno([{ t: 6, l: 1 }]), fresh(), INFERNO_QUESTS)).toBe(false);
    expect(goalMet(quest("IS2"), inferno([{ t: 6, l: 2 }]), fresh(), INFERNO_QUESTS)).toBe(true);
  });

  test("an unlock reads the Inferno yard's Strongbox", () => {
    expect(goalMet(quest("IUC2"), inferno([], { IC2: { t: 1 } }), fresh(), INFERNO_QUESTS)).toBe(false);
    expect(goalMet(quest("IUC2"), inferno([], { IC2: UNLOCKED }), fresh(), INFERNO_QUESTS)).toBe(true);
  });

  test("Balthazar (IC5) completes both IUC5 and IUC10; Valgos (IC4) completes neither", () => {
    const valgos = inferno([], { IC4: UNLOCKED });
    expect(goalMet(quest("IUC5"), valgos, fresh(), INFERNO_QUESTS)).toBe(false);
    expect(goalMet(quest("IUC10"), valgos, fresh(), INFERNO_QUESTS)).toBe(false);
    const balthazar = inferno([], { IC5: UNLOCKED });
    expect(goalMet(quest("IUC5"), balthazar, fresh(), INFERNO_QUESTS)).toBe(true);
    expect(goalMet(quest("IUC10"), balthazar, fresh(), INFERNO_QUESTS)).toBe(true);
  });

  test("the bank quests read infernoBestBank, never the surface's bestBank", () => {
    const surfaceBank = fresh((record) => {
      record.counters.bestBank = 1_000_000;
    });
    expect(goalMet(quest("IBK1"), inferno(), surfaceBank, INFERNO_QUESTS)).toBe(false);
    const banked = fresh((record) => {
      record.counters.infernoBestBank = 20_000;
    });
    expect(goalMet(quest("IBK1"), inferno(), banked, INFERNO_QUESTS)).toBe(true);
    expect(goalMet(quest("IBK2"), inferno(), banked, INFERNO_QUESTS)).toBe(true);
    expect(goalMet(quest("IBK3"), inferno(), banked, INFERNO_QUESTS)).toBe(false);
  });

  test("no gating: every quest is shown from the start, whatever its Flash prereq", () => {
    const onboarding = fresh();
    for (const one of INFERNO_GOALS) {
      expect(goalVisible(one, inferno(), onboarding, INFERNO_QUESTS)).toBe(true);
      expect(goalStatus(one, inferno(), onboarding, INFERNO_QUESTS)).not.toBe("hidden");
    }
  });

  test("done is sticky: a recycled Sharpshooter keeps IT1 ready", () => {
    const onboarding = fresh();
    markDone(inferno([{ t: 21, l: 1 }]), onboarding, 500, INFERNO_QUESTS);
    expect(goalStatus(quest("IT1"), inferno(), onboarding, INFERNO_QUESTS)).toBe("ready");
  });

  test("the badge counts ready Inferno quests, with no baseline even when the Goals' is pending", () => {
    const onboarding = fresh((record) => {
      record.goalsBaseline = "pending";
    });
    const yard = inferno([{ t: 21, l: 1 }, { t: 14, l: 2 }]);
    expect(goalsReadyCount(yard, onboarding)).toBe(2);
    onboarding.infernoGoals.IT1 = { done: 1, claimed: 2 };
    expect(goalsReadyCount(yard, onboarding)).toBe(1);
    // The main yard's badge is the Goals', still pending.
    expect(goalsReadyCount({ ...yard, type: "main" }, onboarding)).toBe(0);
  });
});
