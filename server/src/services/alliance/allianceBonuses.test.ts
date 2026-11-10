import { describe, expect, test } from "bun:test";

import { CONSTELLATIONS, TYPE_EXTRAS } from "../../config/AllianceConfig.js";
import { AllianceType } from "../../enums/Alliance.js";
import {
  allianceDefenceOf,
  bonusesFor,
  byPercent,
  constellationOf,
  mapByPercent,
  nextStepPrice,
  noBonuses,
  productionFactor,
  spentOn,
  stepsOf,
} from "./allianceBonuses.js";

describe("alliance bonuses", () => {
  test("no alliance: every stat is 0", () => {
    expect(Object.values(bonusesFor(null)).every((v) => v === 0)).toBe(true);
    expect(bonusesFor(undefined)).toEqual(noBonuses());
  });

  test("each type starts at its constellations' start values plus its extras", () => {
    for (const type of Object.values(AllianceType)) {
      const bonuses = bonusesFor(type, {});
      for (const constellation of CONSTELLATIONS[type]) {
        for (const effect of constellation.effects) {
          const extra = TYPE_EXTRAS[type][effect.stat]?.start ?? 0;
          const others = CONSTELLATIONS[type]
            .filter((c) => c !== constellation)
            .flatMap((c) => c.effects)
            .filter((e) => e.stat === effect.stat)
            .reduce((sum, e) => sum + e.start, 0);
          expect(bonuses[effect.stat]).toBeCloseTo(effect.start + extra + others, 5);
        }
      }
    }
  });

  test("Midas starts with more production and loot, dearer outpost hatching", () => {
    const midas = bonusesFor(AllianceType.MIDAS);
    expect(midas.production).toBeGreaterThan(0);
    expect(midas.loot).toBeGreaterThan(0);
    expect(midas.outpostHatchCost).toBeGreaterThan(0);
    // No weakness touches main-yard defence (owner, 10 Nov 2026).
    expect(midas.buildingHealth).toBe(0);
  });

  test("Conquest takes over and rebuilds cheaper; Fortress outposts cost others more", () => {
    expect(bonusesFor(AllianceType.CONQUEST).takeoverCost).toBeLessThan(0);
    expect(bonusesFor(AllianceType.CONQUEST).kitCost).toBeLessThan(0);
    expect(bonusesFor(AllianceType.CONQUEST).buildingHealth).toBe(0);
    expect(bonusesFor(AllianceType.FORTRESS).enemyTakeoverCost).toBeGreaterThan(0);
    expect(bonusesFor(AllianceType.FORTRESS).fortifyCost).toBeLessThan(0);
  });

  test("strength steps grow; weakness steps shrink at full", () => {
    const start = bonusesFor(AllianceType.MIDAS).production;
    expect(bonusesFor(AllianceType.MIDAS, { wormzer: 5 }).production).toBeCloseTo(start + 10, 5);
    const pokey = constellationOf(AllianceType.MIDAS, "pokey")!.effects[0]!;
    // Hatch cost +15% -> +5% (fable52, start -> full).
    expect(bonusesFor(AllianceType.MIDAS, { pokey: 5 }).outpostHatchCost).toBeCloseTo(pokey.start - 10, 5);
    const bolt = constellationOf(AllianceType.CONQUEST, "bolt")!.effects[0]!;
    expect(bonusesFor(AllianceType.CONQUEST, { bolt: 5 }).loot).toBeCloseTo(bolt.start / 2, 5);
  });

  test("Teratorn's +1 reach only at full", () => {
    expect(bonusesFor(AllianceType.CONQUEST, { teratorn: 4 }).reach).toBe(0);
    expect(bonusesFor(AllianceType.CONQUEST, { teratorn: 5 }).reach).toBe(1);
  });

  test("stars of another type and junk count for nothing", () => {
    expect(bonusesFor(AllianceType.FORTRESS, { wormzer: 5 })).toEqual(bonusesFor(AllianceType.FORTRESS));
    expect(stepsOf({ fang: 99 }, "fang")).toBe(5);
    expect(stepsOf({ fang: -3 }, "fang")).toBe(0);
    expect(stepsOf({ fang: "x" as unknown as number }, "fang")).toBe(0);
  });

  test("step prices scale 1x / 2x / 4x and stop at full", () => {
    expect(nextStepPrice(AllianceType.MIDAS, 0)).toBe(40);
    expect(nextStepPrice(AllianceType.CONQUEST, 0)).toBe(80);
    expect(nextStepPrice(AllianceType.FORTRESS, 4)).toBe(800);
    expect(nextStepPrice(AllianceType.MIDAS, 5)).toBeNull();
    expect(spentOn(AllianceType.MIDAS, 5)).toBe(600);
    expect(spentOn(AllianceType.FORTRESS, 5)).toBe(2400);
  });

  test("percent helpers", () => {
    expect(byPercent(1000, 15)).toBe(1150);
    expect(byPercent(1000, -20)).toBe(800);
    expect(byPercent(1000, 0)).toBe(1000);
    expect(byPercent(1000, -150)).toBe(0);
    expect(mapByPercent({ r1: 100, r2: 0 }, 10)).toEqual({ r1: 110, r2: 0 });
    expect(productionFactor({ production: 15 })).toBeCloseTo(1.15, 5);
    expect(productionFactor(null)).toBe(1);
  });
});

describe("always-on values move with the whole sky", () => {
  test("Fortress's enemy takeover price: +25% with nothing lit, +40% with all 20 steps", () => {
    expect(bonusesFor(AllianceType.FORTRESS, {}).enemyTakeoverCost).toBe(25);
    const all = Object.fromEntries(CONSTELLATIONS[AllianceType.FORTRESS].map((c) => [c.id, 5]));
    expect(bonusesFor(AllianceType.FORTRESS, all).enemyTakeoverCost).toBe(40);
    expect(bonusesFor(AllianceType.FORTRESS, { crabatron: 5, bandito: 5 }).enemyTakeoverCost).toBe(32.5);
  });
});

describe("the battle bonuses a member's yard defends with (beta 7)", () => {
  const none = { buildingHealth: 0, outpostHealth: 0, towerDamage: 0, trapDamage: 0 };

  test("none when every part is 0: the defence is served as before", () => {
    expect(allianceDefenceOf(none, false)).toBeUndefined();
    expect(allianceDefenceOf(noBonuses(), true)).toBeUndefined();
  });

  test("building health on every yard, outpost health added on an outpost only", () => {
    const bonuses = { ...none, buildingHealth: 10, outpostHealth: -4, towerDamage: 5, trapDamage: 12 };
    expect(allianceDefenceOf(bonuses, false)).toEqual({ hp: 10, damage: 5, trap: 12 });
    expect(allianceDefenceOf(bonuses, true)).toEqual({ hp: 6, damage: 5, trap: 12 });
    // Ichi's weakness alone lowers an outpost's and leaves the main yard alone.
    expect(allianceDefenceOf({ ...none, outpostHealth: -10 }, false)).toBeUndefined();
    expect(allianceDefenceOf({ ...none, outpostHealth: -10 }, true)).toEqual({ hp: -10 });
  });

  test("a half percent rounds to a whole one", () => {
    expect(allianceDefenceOf({ ...none, towerDamage: 7.5 }, false)).toEqual({ damage: 8 });
  });

  test("a Fortress with its start stars defends stronger than no alliance", () => {
    const fortress = allianceDefenceOf(bonusesFor(AllianceType.FORTRESS, {}), false);
    expect(fortress?.hp ?? 0).toBeGreaterThan(0);
  });
});
