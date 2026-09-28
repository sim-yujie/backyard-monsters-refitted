import { describe, expect, it } from "vitest";
import type { AcademyData, BaseLoadResponse, BuildingData, LockerData } from "@/api/types";
import { yardJobs } from "@/game/yard/jobs";
import { readYard } from "@/game/yard/yardModel";
import { monsterEntry } from "./monsterCatalogue";
import {
  academyFor,
  academySlots,
  cancelRefund,
  finishPrice,
  gateText,
  instantGate,
  instantPrice,
  orphanTrainings,
  runningTraining,
  trainGate,
  trainRows,
  type TrainingContext,
} from "./training";

/**
 * The Train tab's rules: the same checks, in the same order, as the server's
 * `trainGate` (`server/src/services/yard/academy.ts`), and its prices.
 */

const T0 = 2_000_000;

const building = (id: number, t: number, l: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t,
  l,
  X: id * 40,
  Y: 0,
  ...extra,
});

interface Setup {
  buildings?: Record<string, BuildingData>;
  academy?: AcademyData;
  lockerdata?: LockerData;
  putty?: number;
  credits?: number;
  cap?: number;
  health?: Record<string, number>;
}

/** Town Hall 7 with two academies: id 5 at level 3, id 6 at level 1. */
const contextOf = (setup: Setup = {}): TrainingContext => {
  const save = {
    error: 0,
    currenttime: T0,
    savetime: T0,
    buildingdata: setup.buildings ?? {
      "1": building(1, 14, 7),
      "5": building(5, 26, 3),
      "6": building(6, 26, 1),
    },
    buildinghealthdata: setup.health ?? {},
    lockerdata: setup.lockerdata ?? { C1: { t: 2 }, C2: { t: 2 }, C15: { t: 2 }, C6: { t: 1, e: T0 + 5 } },
    academy: setup.academy ?? { C1: { level: 1 }, C2: { level: 3 } },
  } as unknown as BaseLoadResponse;
  return {
    yard: readYard(save),
    save,
    resources: { r1: 0, r2: 0, r3: setup.putty ?? 1_000_000, r4: 0 },
    credits: setup.credits ?? 1_000,
    caps: { r1: 5e6, r2: 5e6, r3: setup.cap ?? 5e6, r4: 5e6 },
    now: () => T0,
    jobs: () => yardJobs(save),
  };
};

const monster = (id: string) => monsterEntry(id)!;

describe("trainRows", () => {
  it("lists only unlocked monsters, in list order, with level and next step", () => {
    const rows = trainRows(contextOf());
    expect(rows.map((row) => row.monster.id)).toEqual(["C1", "C2", "C15"]);
    // C2 at 3: the 3 → 4 step is 24,000 putty and 10 hours.
    expect(rows[1]).toMatchObject({ level: 3, max: 6, step: [24_000, 36_000], training: null });
    // Zafreeti's ladder stops at 5; a monster with no entry is level 1.
    expect(rows[2]).toMatchObject({ level: 1, max: 5 });
  });

  it("has no next step at the top", () => {
    const rows = trainRows(contextOf({ academy: { C1: { level: 6 }, C15: { level: 5 } } }));
    expect(rows.find((row) => row.monster.id === "C1")?.step).toBeNull();
    expect(rows.find((row) => row.monster.id === "C15")?.step).toBeNull();
  });
});

describe("slots", () => {
  it("one slot per academy, in id order, with what each is doing", () => {
    const context = contextOf({
      buildings: {
        "1": building(1, 14, 7),
        "6": building(6, 26, 1, { cU: 100 }),
        "5": building(5, 26, 3, { upg: "C2" }),
        "8": building(8, 26, 2),
        "9": building(9, 26, 2, { upg: "C1" }),
      },
      academy: { C1: { level: 1 }, C2: { level: 3, time: T0 + 600, duration: 36_000 } },
      health: { "8": 10 },
    });
    const slots = academySlots(context);
    expect(slots.map((slot) => [slot.id, slot.number, slot.state.kind])).toEqual([
      [5, 1, "training"],
      [6, 2, "busy"],
      [8, 3, "damaged"],
      // C1 is not training: the upg is stale, the academy idle.
      [9, 4, "idle"],
    ]);
    const training = slots[0]!.state.kind === "training" ? slots[0]!.state.training : null;
    expect(training).toMatchObject({ to: 4, endsAt: T0 + 600, duration: 36_000, academyId: 5 });
  });

  it("reads a legacy relative time as the server does", () => {
    const context = contextOf({ academy: { C2: { level: 3, time: 600 } } });
    expect(runningTraining(context, "C2")?.endsAt).toBe(T0 + 600);
  });

  it("lists a training no academy names on its own", () => {
    const context = contextOf({ academy: { C2: { level: 3, time: T0 + 60 } } });
    expect(orphanTrainings(context).map((one) => one.monster.id)).toEqual(["C2"]);
  });
});

describe("academyFor (#180)", () => {
  const many = () =>
    contextOf({
      buildings: {
        "1": building(1, 14, 7),
        "3": building(3, 26, 3),
        "5": building(5, 26, 3),
        "6": building(6, 26, 1),
        "9": building(9, 26, 1),
        "12": building(12, 26, 2),
      },
    });

  it("picks the lowest-level idle academy that can train it, the lower id on a tie", () => {
    const context = many();
    expect(academyFor(context, 1)?.id).toBe(6);
    expect(academyFor(context, 2)?.id).toBe(12);
    expect(academyFor(context, 3)?.id).toBe(3);
    expect(academyFor(context, 4)).toBeNull();
  });

  it("passes over a busy academy", () => {
    // Academy 6 is training C2, so C1 at level 1 goes to 9, the other level 1.
    const busy = contextOf({
      buildings: {
        "1": building(1, 14, 7),
        "5": building(5, 26, 3),
        "6": building(6, 26, 1, { upg: "C2" }),
        "9": building(9, 26, 1),
      },
      academy: { C1: { level: 1 }, C2: { level: 3, time: T0 + 60 } },
    });
    expect(academyFor(busy, 1)?.id).toBe(9);
    expect(academyFor(busy, 1)?.number).toBe(3);
  });
});

describe("trainGate", () => {
  it("passes when an idle academy is high enough and putty covers it", () => {
    const context = contextOf();
    expect(trainGate(monster("C2"), context)).toBeNull();
    expect(academyFor(context, 3)?.id).toBe(5);
    // Level 1 fits both; the lower academy takes it and 5 stays free (#180).
    expect(academyFor(context, 1)?.id).toBe(6);
  });

  it("refuses in the server's order", () => {
    expect(trainGate(monster("C1"), contextOf({ buildings: { "1": building(1, 14, 7) } }))).toEqual({
      reason: "noAcademy",
    });
    const busy = contextOf({
      buildings: { "1": building(1, 14, 7), "5": building(5, 26, 3, { upg: "C2" }), "6": building(6, 26, 1) },
      academy: { C1: { level: 1 }, C2: { level: 3, time: T0 + 60 } },
    });
    expect(trainGate(monster("C2"), busy)).toEqual({ reason: "training" });
    expect(trainGate(monster("C6"), contextOf())).toEqual({ reason: "locked" });
    expect(trainGate(monster("C15"), contextOf({ academy: { C15: { level: 5 } } }))).toEqual({
      reason: "maxLevel",
    });
    // C1 at 1 still fits the idle level 1 academy; C2's next training would not.
    expect(trainGate(monster("C1"), busy)).toBeNull();
    const bothBusy = contextOf({
      buildings: {
        "1": building(1, 14, 7),
        "5": building(5, 26, 3, { upg: "C2" }),
        "6": building(6, 26, 1, { upg: "C1" }),
      },
      lockerdata: { C1: { t: 2 }, C2: { t: 2 }, C3: { t: 2 } },
      academy: { C1: { level: 1, time: T0 + 60 }, C2: { level: 3, time: T0 + 60 } },
    });
    expect(trainGate(monster("C3"), bothBusy)).toEqual({ reason: "academyBusy" });
    const low = contextOf({
      buildings: { "1": building(1, 14, 7), "5": building(5, 26, 3, { cU: 50 }), "6": building(6, 26, 1) },
    });
    expect(trainGate(monster("C2"), low)).toEqual({ reason: "academyLevel", have: 1, need: 3 });
    expect(gateText({ reason: "academyLevel", have: 1, need: 3 })).toBe("Needs Monster Academy level 3");
  });

  it("puts putty last, and says so when the price is over the cap", () => {
    expect(trainGate(monster("C2"), contextOf({ putty: 20_000 }))).toEqual({ reason: "shortfall", need: 4_000 });
    expect(trainGate(monster("C2"), contextOf({ putty: 0, cap: 10_000 }))).toEqual({
      reason: "shortfall",
      need: 24_000,
      overCap: true,
    });
  });
});

describe("prices", () => {
  it("instant is timeCost(t) + ceil(sqrt(putty / 2)^0.75), needs no putty", () => {
    // 10 h: min(200, int(sqrt(28,800))) = 169; sqrt(12,000)^0.75 = 33.4 → 34.
    expect(instantPrice([24_000, 36_000])).toBe(169 + 34);
    expect(instantGate(monster("C2"), contextOf({ putty: 0 }))).toBeNull();
    expect(instantGate(monster("C2"), contextOf({ credits: 3 }))).toEqual({ reason: "credits", need: 200 });
  });

  it("finish is timeCost of what is left, free at five minutes", () => {
    const context = contextOf({ academy: { C2: { level: 3, time: T0 + 3_600 } } });
    const training = runningTraining(context, "C2")!;
    expect(finishPrice(training, T0)).toBe(20);
    expect(finishPrice(training, T0 + 3_400)).toBe(0);
  });

  it("cancel refunds the step's putty, less what the cap turns away", () => {
    const context = contextOf({ academy: { C2: { level: 3, time: T0 + 60 } }, putty: 990_000, cap: 1_000_000 });
    expect(cancelRefund(runningTraining(context, "C2")!, context)).toEqual({ refund: 10_000, lost: 14_000 });
    const roomy = contextOf({ academy: { C2: { level: 3, time: T0 + 60 } } });
    expect(cancelRefund(runningTraining(roomy, "C2")!, roomy)).toEqual({ refund: 24_000, lost: 0 });
  });
});
