import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { hatchMonsters, overdrivesOf } from "./hatchPlan";
import { housingCapacity, housingTypeOf } from "./housing";
import {
  INFERNO_TOP_TRAINING_LEVEL,
  inRealm,
  isListedIn,
  listedMonstersOf,
  monsterRealmOf,
  monsterWords,
  topTrainingLevel,
} from "./realm";

/** Which roster, words and shop items a yard's monster screens use (Inferno WP 2.4). */

describe("monster realm", () => {
  it("is the Inferno only on the Inferno yard", () => {
    expect(monsterRealmOf("inferno")).toBe("inferno");
    expect(monsterRealmOf("main")).toBe("surface");
    expect(monsterRealmOf("outpost")).toBe("surface");
    expect(monsterRealmOf(undefined)).toBe("surface");
  });

  it("keeps the rosters apart", () => {
    expect(inRealm("IC1", "inferno")).toBe(true);
    expect(inRealm("C1", "inferno")).toBe(false);
    expect(inRealm("C1", "surface")).toBe(true);
    expect(inRealm("IC1", "surface")).toBe(false);
    expect(
      listedMonstersOf("inferno")
        .map((one) => one.id)
        .sort(),
    ).toEqual(["IC1", "IC2", "IC3", "IC4", "IC5", "IC6", "IC7", "IC8"]);
    expect(listedMonstersOf("surface").every((one) => /^C\d+$/.test(one.id))).toBe(true);
    expect(isListedIn("IC5", "inferno")).toBe(true);
    expect(isListedIn("IC5", "surface")).toBe(false);
  });

  it("trains Inferno monsters to level five", () => {
    expect(INFERNO_TOP_TRAINING_LEVEL).toBe(5);
    for (const { id } of listedMonstersOf("inferno")) {
      expect(topTrainingLevel(id, "inferno")).toBeLessThanOrEqual(5);
    }
  });

  it("speaks Flash's Inferno names", () => {
    expect(monsterWords("inferno")).toMatchObject({
      locker: "Strongbox",
      hatchery: "Incubator",
      housing: "Compound",
      expansion: "Compound Expansion",
      academy: "Infernal Academy",
      goo: "Magma",
      putty: "Sulfur",
    });
    expect(monsterWords("surface").locker).toBe("Monster Locker");
  });
});

describe("the Inferno yard's hatching and housing", () => {
  it("hatches only Inferno monsters and sells the Incubator Overdrives", () => {
    const save = {
      lockerdata: { IC1: { t: 2 }, C1: { t: 2 } },
      academy: {},
    } as unknown as BaseLoadResponse;
    const rows = hatchMonsters(save, "inferno");
    expect(rows.every((row) => row.monster.id.startsWith("IC"))).toBe(true);
    expect(rows.find((row) => row.monster.id === "IC1")?.state.kind).toBe("ready");
    expect(overdrivesOf("inferno").map((one) => one.item)).toEqual(["HODI", "HOD2I", "HOD3I"]);
    expect(overdrivesOf("surface").map((one) => one.item)).toEqual(["HOD", "HOD2", "HOD3"]);
  });

  it("houses in the Compound (type 128) on an Inferno save", () => {
    const compound = { id: 20, t: 128, l: 1, X: 0, Y: 0 };
    const inferno = {
      type: "inferno",
      buildingdata: { "20": compound },
      storedata: {},
    } as unknown as BaseLoadResponse;
    expect(housingTypeOf(inferno)).toBe(128);
    expect(housingTypeOf({ type: "main" } as BaseLoadResponse)).toBe(15);
    expect(housingCapacity(inferno, 0)).toBeGreaterThan(0);
  });
});
