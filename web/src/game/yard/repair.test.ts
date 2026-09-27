import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { maxHp } from "@/game/combat/rules";
import { timeCost } from "./buildingCosts";
import {
  damageOf,
  damagedAt,
  repairAt,
  repairNowPrice,
  repairOffer,
  repairRate,
  unrepairedCount,
} from "./repair";
import { REPAIR_TIMES, repairTimeOf } from "./repairTimeData";

/** Repairs on the client: the server's rate, reading, and Repair now price. */

const T0 = 1_800_000_000;

const building = (id: number, t: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  X: 0,
  Y: 0,
  id,
  t,
  ...extra,
});

const saveOf = (
  buildings: BuildingData[],
  health: Record<string, number> = {},
): Pick<BaseLoadResponse, "buildingdata" | "buildinghealthdata" | "savetime" | "currenttime"> => ({
  savetime: T0,
  currenttime: T0,
  buildingdata: Object.fromEntries(buildings.map((one) => [String(one.id), one])),
  buildinghealthdata: health,
});

describe("repairTimeData", () => {
  it("carries the props table's ladders, level 0 reading the first step", () => {
    expect(REPAIR_TIMES[14]?.[9]).toBe(345_600);
    expect(repairTimeOf(1, 1)).toBe(30);
    expect(repairTimeOf(1, 0)).toBe(30);
    expect(repairTimeOf(1, 99)).toBe(15_360);
    expect(repairTimeOf(9_999, 1)).toBe(3_600);
  });
});

describe("repairRate", () => {
  it("is ceil(max / min(3600, repairTime))", () => {
    expect(repairRate(1, 1, 500)).toBe(17);
    const hall = maxHp(14, 10);
    expect(repairRate(14, 10, hall)).toBe(Math.ceil(hall / 3_600));
  });
});

describe("damageOf", () => {
  it("reads buildinghealthdata first, then hp, against the combat table's maximum", () => {
    const save = saveOf([], { "1": 200 });
    expect(damageOf(building(1, 1, { hp: 300 }), save)).toMatchObject({
      id: 1,
      health: 200,
      max: 500,
      rate: 17,
      repairing: false,
    });
    expect(damageOf(building(1, 1, { hp: 300 }), saveOf([]))?.health).toBe(300);
  });

  it("is null at full health", () => {
    expect(damageOf(building(1, 1), saveOf([]))).toBeNull();
    expect(damageOf(building(1, 1, { hp: 500 }), saveOf([]))).toBeNull();
  });
});

describe("repairAt", () => {
  it("heals a running repair from savetime and says when it ends", () => {
    const save = saveOf([]);
    const damage = damageOf(building(1, 1, { hp: 100, rE: 1 }), save)!;
    expect(repairAt(damage, save, T0 + 10)).toMatchObject({
      now: 270,
      secondsLeft: 14,
      endsAt: T0 + 24,
    });
  });

  it("leaves a damaged building that is not repairing where it is", () => {
    const save = saveOf([]);
    const damage = damageOf(building(1, 1, { hp: 100 }), save)!;
    expect(repairAt(damage, save, T0 + 1_000)).toMatchObject({ now: 100, secondsLeft: 24, endsAt: null });
  });
});

describe("damagedAt and unrepairedCount", () => {
  const save = saveOf([
    building(1, 1, { hp: 100 }),
    building(2, 1, { hp: 100, rE: 1 }),
    building(3, 1),
  ]);

  it("lists what is still damaged at the moment, in id order", () => {
    expect(damagedAt(save, T0).map((one) => one.id)).toEqual([1, 2]);
    // The running repair is done after 24 s.
    expect(damagedAt(save, T0 + 30).map((one) => one.id)).toEqual([1]);
  });

  it("counts only the buildings nobody is repairing", () => {
    expect(unrepairedCount(save, T0)).toBe(1);
  });
});

describe("repairNowPrice", () => {
  it("is timeCost over the repairs above five minutes plus 10 each, as the server prices FIX", () => {
    const hall = maxHp(14, 10);
    const save = saveOf([building(0, 14, { l: 10, hp: 0 }), building(1, 1, { hp: 100 })]);
    const damaged = damagedAt(save, T0);
    const hallSeconds = Math.trunc(hall / Math.ceil(hall / 3_600));
    expect(repairNowPrice(damaged)).toBe(timeCost(hallSeconds) + 10);
  });

  it("is free when every repair is five minutes or less", () => {
    expect(repairNowPrice(damagedAt(saveOf([building(1, 1, { hp: 100 })]), T0))).toBe(0);
  });
});

describe("repairOffer", () => {
  it("prices Repair now over the whole yard and blocks it without the Shiny", () => {
    const save = saveOf([building(0, 14, { l: 10, hp: 0 }), building(1, 1, { hp: 100 })]);
    const offer = repairOffer(1, save, 0, T0)!;
    expect(offer.nowCount).toBe(2);
    expect(offer.nowPrice).toBeGreaterThan(0);
    expect(offer.nowBlocked).toBe("credits");
    expect(repairOffer(1, save, 10_000, T0)!.nowBlocked).toBeNull();
    expect(repairOffer(7, save, 0, T0)).toBeNull();
  });
});
