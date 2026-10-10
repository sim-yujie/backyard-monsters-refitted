import { describe, expect, it } from "vitest";
import type { AcademyData, BaseLoadResponse, BuildingData, LockerData } from "@/api/types";
import { yardJobs } from "@/game/yard/jobs";
import { readYard } from "@/game/yard/yardModel";
import {
  cancelRefund,
  effectLine,
  finishPrice,
  gateText,
  instantGate,
  instantPrice,
  labRows,
  labSlot,
  monsterGate,
  powerupRank,
  researchGate,
  runningResearch,
  type LabContext,
} from "./lab";
import { labAbility } from "./monsterCatalogue";

/**
 * The Lab tab's rules: the same checks, in the same order, as the server's
 * `researchGate` (`server/src/services/yard/lab.ts`), its prices, and the
 * ability effects in plain words.
 */

const T0 = 2_000_000;
const LAB = 9;

const building = (id: number, t: number, l: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t,
  l,
  X: id * 40,
  Y: 0,
  ...extra,
});

interface Setup {
  lab?: Partial<BuildingData> | null;
  academy?: AcademyData;
  lockerdata?: LockerData;
  putty?: number;
  credits?: number;
  cap?: number;
  health?: Record<string, number>;
}

/**
 * Town Hall 7 with a level 2 Lab (id 9). Bolt (C3) at level 2 can take rank
 * 1; Fink (C4) at level 3 with rank 1 can take rank 2; Fang (C8) at level 1
 * is untrained; D.A.V.E. (C12) is at rank 3; Eye-ra (C5) is not unlocked.
 */
const contextOf = (setup: Setup = {}): LabContext => {
  const save = {
    error: 0,
    currenttime: T0,
    savetime: T0,
    buildingdata: {
      "1": building(1, 14, 7),
      ...(setup.lab === null ? {} : { [String(LAB)]: building(LAB, 116, 2, setup.lab ?? {}) }),
    },
    buildinghealthdata: setup.health ?? {},
    lockerdata: setup.lockerdata ?? { C3: { t: 2 }, C4: { t: 2 }, C8: { t: 2 }, C12: { t: 2 } },
    academy: setup.academy ?? {
      C3: { level: 2 },
      C4: { level: 3, powerup: 1 },
      C8: { level: 1 },
      C12: { level: 6, powerup: 3 },
    },
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

const ability = (id: string) => labAbility(id)!;
const researching = { upg: "C3", upt: T0 + 3_600, upl: 1 };

describe("labRows", () => {
  it("lists the ten abilities in the Lab's order with their rank and next rank", () => {
    const rows = labRows(contextOf());
    expect(rows.map((row) => row.monster.id)).toEqual([
      "C3",
      "C4",
      "C7",
      "C8",
      "C5",
      "C9",
      "C11",
      "C13",
      "C14",
      "C12",
    ]);
    const fink = rows.find((row) => row.monster.id === "C4")!;
    expect(fink).toMatchObject({ rank: 1, step: [128_000, 108_000], research: null });
    expect(rows.find((row) => row.monster.id === "C12")).toMatchObject({ rank: 3, step: null });
  });

  it("marks the row being researched", () => {
    const rows = labRows(contextOf({ lab: researching }));
    expect(rows.find((row) => row.monster.id === "C3")!.research).toMatchObject({ rank: 1, endsAt: T0 + 3_600 });
    expect(rows.filter((row) => row.research)).toHaveLength(1);
  });
});

describe("labSlot and runningResearch", () => {
  it("reads the Lab's state", () => {
    expect(labSlot(contextOf())).toEqual({ id: LAB, level: 2, state: { kind: "idle" } });
    expect(labSlot(contextOf({ lab: null }))).toBeNull();
    expect(labSlot(contextOf({ lab: { cU: 600 } }))!.state).toEqual({ kind: "busy" });
    expect(labSlot(contextOf({ health: { [String(LAB)]: 100 } }))!.state).toEqual({ kind: "damaged" });
    expect(labSlot(contextOf({ lab: researching }))!.state.kind).toBe("researching");
  });

  it("needs all three fields and a monster with an ability", () => {
    expect(runningResearch(contextOf({ lab: researching }))).toMatchObject({
      rank: 1,
      endsAt: T0 + 3_600,
      duration: 86_400,
      labId: LAB,
    });
    expect(runningResearch(contextOf({ lab: { upg: "C3" } }))).toBeNull();
    expect(runningResearch(contextOf({ lab: { upg: "C1", upt: T0 + 5, upl: 1 } }))).toBeNull();
  });
});

describe("researchGate", () => {
  it("passes a rank the Lab and the monster are ready for", () => {
    expect(researchGate(ability("C3"), contextOf())).toBeNull();
    expect(researchGate(ability("C4"), contextOf())).toBeNull();
  });

  it("refuses in the server's order", () => {
    expect(researchGate(ability("C3"), contextOf({ lab: null }))).toEqual({ reason: "noLab" });
    expect(researchGate(ability("C3"), contextOf({ lab: { cU: 60 } }))).toEqual({ reason: "busy" });
    expect(researchGate(ability("C3"), contextOf({ health: { [String(LAB)]: 1 } }))).toEqual({
      reason: "damaged",
    });
    expect(researchGate(ability("C4"), contextOf({ lab: researching }))).toEqual({ reason: "labBusy" });
    expect(researchGate(ability("C5"), contextOf())).toEqual({ reason: "locked" });
    expect(researchGate(ability("C12"), contextOf())).toEqual({ reason: "maxRank" });
    expect(researchGate(ability("C4"), contextOf({ lab: { l: 1 } }))).toEqual({
      reason: "labLevel",
      have: 1,
      need: 2,
    });
    expect(researchGate(ability("C8"), contextOf())).toEqual({
      reason: "monsterLevel",
      monster: "C8",
      have: 1,
      need: 2,
    });
    expect(researchGate(ability("C3"), contextOf({ putty: 40_000 }))).toEqual({
      reason: "shortfall",
      need: 8_000,
    });
    expect(researchGate(ability("C3"), contextOf({ putty: 0, cap: 40_000 }))).toMatchObject({
      overCap: true,
    });
  });

  it("the row's gate is the monster's alone", () => {
    expect(monsterGate(ability("C4"), contextOf({ lab: researching }))).toBeNull();
    expect(monsterGate(ability("C8"), contextOf())).toMatchObject({ reason: "monsterLevel" });
  });
});

describe("Instant", () => {
  it("prices the rank as GetShinyCost: every second paid, plus the putty", () => {
    // 86,400 s → 262; 48,000 putty → ceil(sqrt(24,000)^0.75) = 44.
    expect(instantPrice([48_000, 86_400])).toBe(262 + 44);
    // No free five minutes.
    expect(instantPrice([0, 200])).toBe(2);
  });

  it("needs no putty, only Shiny", () => {
    expect(instantGate(ability("C3"), contextOf({ putty: 0 }))).toBeNull();
    expect(instantGate(ability("C3"), contextOf({ credits: 10 }))).toEqual({ reason: "credits", need: 296 });
    expect(instantGate(ability("C3"), contextOf({ lab: { ...researching, upg: "C4", upl: 2 } }))).toEqual({
      reason: "labBusy",
    });
  });
});

describe("Finish now and Cancel", () => {
  it("finish is timeCost of what is left, free at five minutes", () => {
    const research = runningResearch(contextOf({ lab: researching }))!;
    expect(finishPrice(research, T0)).toBe(20);
    expect(finishPrice(research, T0 + 3_400)).toBe(0);
  });

  it("cancel gives the rank's putty back, capped", () => {
    const research = runningResearch(contextOf({ lab: researching }))!;
    expect(cancelRefund(research, contextOf())).toEqual({ refund: 48_000, lost: 0 });
    expect(cancelRefund(research, contextOf({ putty: 1_000_000, cap: 1_010_000 }))).toEqual({
      refund: 10_000,
      lost: 38_000,
    });
  });
});

describe("words", () => {
  it("gate reasons", () => {
    expect(gateText({ reason: "labLevel", have: 1, need: 2 })).toBe("Needs Lab level 2");
    expect(gateText({ reason: "monsterLevel", monster: "C2", have: 2, need: 3 })).toBe(
      "Needs Octo-ooze at level 3",
    );
    expect(gateText({ reason: "labBusy" })).toBe("The Lab is already researching");
  });

  it("effect now → next", () => {
    expect(effectLine(ability("C3"), 0)).toBe("Blink range: none → 150");
    expect(effectLine(ability("C3"), 1)).toBe("Blink range: 150 → 300");
    expect(effectLine(ability("C3"), 3)).toBe("Blink range: 450 (top rank)");
    expect(effectLine(ability("C5"), 1)).toBe("Airburst bonus: 20% → 30%");
    expect(effectLine(ability("C7"), 1)).toBe("Whirlwind speed: 1× → 1.5×");
    expect(effectLine(ability("C8"), 0)).toBe("Venom: none → 10% of its damage");
    expect(effectLine(ability("C9"), 1)).toBe("Invisibility: 0 s cloak delay → 4 s cloak delay");
    expect(effectLine(ability("C14"), 2)).toBe("Fireball bounces: 2 → 3");
    expect(effectLine(ability("C9"), 0)).toBe("Invisibility: none → 0 s cloak delay");
    expect(effectLine(ability("C9"), 3)).toBe("Invisibility: 8 s cloak delay (top rank)");
    expect(effectLine(ability("C4"), 1)).toBe("Extra targets: 1 → 2");
    expect(effectLine(ability("C11"), 2)).toBe("Acid on death: 2× its damage → 3× its damage");
  });

  it("powerupRank reads 0..3", () => {
    expect(powerupRank({ C3: { powerup: 2 } }, "C3")).toBe(2);
    expect(powerupRank({ C3: {} }, "C3")).toBe(0);
    expect(powerupRank(null, "C3")).toBe(0);
  });
});
