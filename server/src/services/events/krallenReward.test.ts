import { describe, expect, test } from "bun:test";

import { championEntry } from "../../game-data/championCatalogue.js";
import { KRALLEN_MAX_LEVEL, KRALLEN_TYPE } from "../../game-data/events/eventRewards.js";
import { CHAMPION_STATUS, maxHealthOf } from "../yard/champion.js";
import { krallenLevelOf, raiseKrallen } from "./krallenReward.js";

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
