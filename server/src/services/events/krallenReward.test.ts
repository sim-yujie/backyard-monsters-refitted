import { describe, expect, test } from "bun:test";

import { championEntry } from "../../game-data/championCatalogue.js";
import { KRALLEN_MAX_LEVEL, KRALLEN_TYPE } from "../../game-data/events/eventRewards.js";
import { CHAMPION_STATUS, maxHealthOf } from "../yard/champion.js";
import { grantKrallenAura, krallenAuraOn, krallenAuraUntilOf, krallenLevelOf, raiseKrallen } from "./krallenReward.js";

const NOW = 1_800_000_000;
const ENTRY = championEntry(KRALLEN_TYPE)!;
const GORGO = { t: 1, l: 3, hp: 100, ft: 5, fd: 2, fb: 0, pl: 1, status: CHAMPION_STATUS.FROZEN };

describe("krallenLevelOf", () => {
  test("0 without her; her level from a list or an old Flash string", () => {
    expect(krallenLevelOf(undefined)).toBe(0);
    expect(krallenLevelOf([GORGO])).toBe(0);
    expect(krallenLevelOf([GORGO, { t: 5, l: 3 }])).toBe(3);
    expect(krallenLevelOf(JSON.stringify([{ t: 5, l: 2 }]))).toBe(2);
    expect(krallenLevelOf("not json")).toBe(0);
  });
});

describe("raiseKrallen", () => {
  test("no Krallen: she joins at level 1, full health, fed, beside the cage; others are kept", () => {
    const { champions, level, raised } = raiseKrallen([GORGO], NOW);
    expect([level, raised]).toEqual([1, true]);
    expect(champions[0]).toEqual(GORGO);
    const born = champions[1]!;
    expect(born).toMatchObject({ t: KRALLEN_TYPE, l: 1, fd: 0, ft: NOW + ENTRY.feedTime, status: CHAMPION_STATUS.ACTIVE });
    expect(born.hp).toBe(maxHealthOf(born, ENTRY));
    expect(born.hp).toBeGreaterThan(0);
  });

  test("one level up, full health at the new level, feeds back to 0", () => {
    const { champions, level, raised } = raiseKrallen([{ t: 5, l: 2, hp: 1, fd: 4, fb: 1, ft: 1, status: 2 }], NOW);
    expect([level, raised]).toEqual([3, true]);
    expect(champions[0]).toMatchObject({ l: 3, fd: 0, fb: 1, ft: NOW + ENTRY.feedTime, status: CHAMPION_STATUS.ACTIVE });
    expect(champions[0]!.hp).toBe(maxHealthOf(champions[0]!, ENTRY));
  });

  test("frozen stays frozen with her feed clock kept", () => {
    const { champions } = raiseKrallen([{ t: 5, l: 1, hp: 1, ft: 1234, status: CHAMPION_STATUS.FROZEN }], NOW);
    expect(champions[0]).toMatchObject({ l: 2, ft: 1234, status: CHAMPION_STATUS.FROZEN });
  });

  test(`at level ${KRALLEN_MAX_LEVEL} nothing changes`, () => {
    const top = [{ t: 5, l: KRALLEN_MAX_LEVEL, hp: 7, fd: 3, ft: 1, fb: 0, pl: 1, status: 0 }];
    expect(raiseKrallen(top, NOW)).toEqual({ champions: top, level: KRALLEN_MAX_LEVEL, raised: false });
  });

  test("reads an old Flash string and does not change what it was given", () => {
    const list = [{ t: 5, l: 1, hp: 1 }];
    expect(raiseKrallen(JSON.stringify(list), NOW).level).toBe(2);
    raiseKrallen(list, NOW);
    expect(list[0]!.l).toBe(1);
  });
});

describe("grantKrallenAura (the hunt's 3x mark)", () => {
  const UNTIL = NOW + 30 * 86_400;

  test("sets her aura end on her entry and keeps everything else; others are untouched", () => {
    const krallen = { t: KRALLEN_TYPE, l: 4, hp: 100, ft: 5, fd: 1, fb: 0, pl: 0, status: CHAMPION_STATUS.ACTIVE, nm: "K" };
    const result = grantKrallenAura([GORGO, krallen], UNTIL);
    expect(result).toMatchObject({ until: UNTIL, level: 4, hasKrallen: true });
    expect(result.champions).toEqual([GORGO, { ...krallen, la: UNTIL }]);
  });

  test("no Krallen: nothing changes", () => {
    const result = grantKrallenAura([GORGO], UNTIL);
    expect(result).toMatchObject({ until: 0, level: 0, hasKrallen: false });
    expect(result.champions).toEqual([GORGO]);
  });

  test("a later end wins; an earlier one never shortens it; any level keeps it", () => {
    const krallen = { t: KRALLEN_TYPE, l: 2, la: UNTIL };
    expect(grantKrallenAura([krallen], UNTIL - 1).champions[0]!.la).toBe(UNTIL);
    expect(grantKrallenAura([krallen], UNTIL + 5).champions[0]!.la).toBe(UNTIL + 5);
    expect(grantKrallenAura(JSON.stringify([krallen]), UNTIL + 5).level).toBe(2);
  });
});

describe("krallenAuraUntilOf / krallenAuraOn", () => {
  test("her aura end, 0 for none or nonsense", () => {
    expect(krallenAuraUntilOf(undefined)).toBe(0);
    expect(krallenAuraUntilOf({})).toBe(0);
    expect(krallenAuraUntilOf({ la: "x" })).toBe(0);
    expect(krallenAuraUntilOf({ la: -5 })).toBe(0);
    expect(krallenAuraUntilOf({ la: 123.7 })).toBe(123);
  });

  test("on only while it runs and only from her level 3", () => {
    for (const l of [1, 2]) expect(krallenAuraOn([{ t: KRALLEN_TYPE, l, la: NOW + 10 }], NOW)).toBe(false);
    for (const l of [3, 4, 5]) {
      expect(krallenAuraOn([{ t: KRALLEN_TYPE, l, la: NOW + 10 }], NOW)).toBe(true);
      expect(krallenAuraOn([{ t: KRALLEN_TYPE, l, la: NOW }], NOW)).toBe(false);
      expect(krallenAuraOn([{ t: KRALLEN_TYPE, l }], NOW)).toBe(false);
    }
    expect(krallenAuraOn([{ ...GORGO, la: NOW + 10 }], NOW)).toBe(false);
  });
});
