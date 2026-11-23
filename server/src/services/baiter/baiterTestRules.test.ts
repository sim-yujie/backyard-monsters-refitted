import { describe, expect, test } from "bun:test";

import type { FlingEvent } from "../../game-rules/combat/index.js";
import {
  BAITER_CAP,
  KRALLEN_TYPE,
  TEST_ROSTER,
  armySpace,
  baiterLevelOf,
  capOfLevel,
  eventsFit,
  keptReport,
  maxLevelOf,
  parseTestArmy,
  resultOf,
  spaceOf,
  testAttacker,
  testChampionData,
  type TestArmy,
} from "./baiterTestRules.js";

const fling = (t: number, monsters: Record<string, number>, champion?: object) =>
  ({ kind: "fling", t, x: 0, y: 0, r: 0, monsters, ...(champion ? { champion } : {}) }) as unknown as FlingEvent;

const army = (monsters: Record<string, [count: number, level: number]>, champions: TestArmy["champions"] = []): TestArmy => ({
  monsters: Object.fromEntries(Object.entries(monsters).map(([id, [count, level]]) => [id, { count, level }])),
  champions,
});

describe("friend tests: the numbers (beta 9 #4)", () => {
  test("the cap is the inviter's Baiter level's, clamped to the table", () => {
    expect(BAITER_CAP).toEqual([600, 900, 1200, 1500, 2100, 3200, 4800]);
    expect(capOfLevel(1)).toBe(600);
    expect(capOfLevel(3)).toBe(1200);
    expect(capOfLevel(7)).toBe(4800);
    expect(capOfLevel(99)).toBe(4800);
    expect(capOfLevel(0)).toBe(600);
  });

  test("the roster is the web client's 18 surface monsters, at the web's levels and sizes", () => {
    expect(TEST_ROSTER).toHaveLength(18);
    expect(TEST_ROSTER).not.toContain("C18");
    expect(TEST_ROSTER.every((id) => maxLevelOf(id) >= 5)).toBe(true);
    expect(maxLevelOf("C15")).toBe(5);
    expect(maxLevelOf("C1")).toBe(6);
    expect(maxLevelOf("IC1")).toBe(0);
    expect(maxLevelOf("C18")).toBe(0);
    // `web/src/game/monsters/monsterCatalogue.ts` housingSpace
    expect([1, 4, 6].map((level) => spaceOf("C1", level))).toEqual([10, 9, 7]);
    expect(spaceOf("C19", 1)).toBe(250);
    expect(spaceOf("C12", 3)).toBe(160);
  });

  test("a Baiter's level: the best standing one; one being built counts nothing", () => {
    expect(baiterLevelOf({ buildingdata: {} })).toBe(0);
    expect(baiterLevelOf({ buildingdata: { 1: { t: 19, l: 3 }, 2: { t: 14, l: 9 } } as never })).toBe(3);
    expect(baiterLevelOf({ buildingdata: { 1: { t: 19, l: 1, cB: 50 } } as never })).toBe(0);
    expect(baiterLevelOf(null)).toBe(0);
  });
});

describe("friend tests: the army a tester may send", () => {
  test("an army within the cap is taken; counts of 0 drop out", () => {
    const parsed = parseTestArmy({ monsters: { C1: { count: 60, level: 1 }, C2: { count: 0, level: 3 } }, champions: [] }, 600);
    expect(parsed).toEqual({ army: army({ C1: [60, 1] }) });
  });

  test("an army over the cap is refused, measured at each row's level", () => {
    expect(parseTestArmy({ monsters: { C1: { count: 61, level: 1 } } }, 600)).toEqual({ refusal: "overCap" });
    // At level 6 a Pokey takes 7: 85 x 7 = 595 fits in 600.
    expect("army" in parseTestArmy({ monsters: { C1: { count: 85, level: 6 } } }, 600)).toBe(true);
    expect(armySpace(army({ C1: [85, 6], C19: [1, 1] }))).toBe(845);
  });

  test("monsters off the roster, levels past a monster's and bad champions are refused", () => {
    expect(parseTestArmy({ monsters: { IC1: { count: 1, level: 1 } } }, 4800)).toEqual({ refusal: "badArmy" });
    expect(parseTestArmy({ monsters: { C15: { count: 1, level: 6 } } }, 4800)).toEqual({ refusal: "badArmy" });
    expect(parseTestArmy({ monsters: {}, champions: [{ t: 1, l: 7, pl: 0 }] }, 4800)).toEqual({ refusal: "badArmy" });
    expect(parseTestArmy({ monsters: {}, champions: [{ t: KRALLEN_TYPE, l: 6, pl: 0 }] }, 4800)).toEqual({ refusal: "badArmy" });
    expect(parseTestArmy({ monsters: {}, champions: [{ t: 1, l: 1, pl: 9 }] }, 4800)).toEqual({ refusal: "badArmy" });
    expect(parseTestArmy({ monsters: {}, champions: [{ t: 1, l: 1, pl: 0, s: "angry" }] }, 4800)).toEqual({ refusal: "badArmy" });
    // Two ordinary champions: one only, plus Krallen.
    expect(parseTestArmy({ monsters: {}, champions: [{ t: 1, l: 1 }, { t: 2, l: 1 }] }, 4800)).toEqual({ refusal: "badArmy" });
    expect("army" in parseTestArmy({ monsters: {}, champions: [{ t: 1, l: 6, pl: 3, s: "hybrid" }, { t: KRALLEN_TYPE, l: 5, pl: 2 }] }, 600)).toBe(
      true
    );
    expect(parseTestArmy("nonsense", 600)).toEqual({ refusal: "badArmy" });
  });
});

describe("friend tests: the drops must fit the army", () => {
  const sent = army({ C1: [20, 2], C5: [3, 1] }, [{ t: 1, l: 6, pl: 1 }]);
  const gorgo = testChampionData({ t: 1, l: 6, pl: 1 });

  test("drops within the army, retreats and the army's own champion fit", () => {
    const events = [
      fling(100, { C1: 10 }),
      fling(140, { C1: 10, C5: 3 }),
      fling(200, {}, { t: 1, l: 6, pl: 1, fb: gorgo.fb, hp: gorgo.hp }),
      { kind: "championRetreat", t: 300, c: 1 } as FlingEvent,
      { kind: "retreat", t: 400 } as FlingEvent,
    ];
    expect(eventsFit(events, sent)).toBe(true);
  });

  test("more of a monster than the army holds, or one it does not hold, does not fit", () => {
    expect(eventsFit([fling(100, { C1: 15 }), fling(120, { C1: 6 })], sent)).toBe(false);
    expect(eventsFit([fling(100, { C2: 1 })], sent)).toBe(false);
  });

  test("bombs and siege weapons are not part of a test", () => {
    expect(eventsFit([{ kind: "bomb", t: 10, x: 0, y: 0, id: "b1" } as FlingEvent], sent)).toBe(false);
    expect(eventsFit([{ kind: "siege", t: 10, x: 0, y: 0, weapon: "s1" } as FlingEvent], sent)).toBe(false);
  });

  test("a champion stronger than the army's, or another one, does not fit", () => {
    expect(eventsFit([fling(1, {}, { t: 1, l: 6, pl: 3, fb: gorgo.fb })], sent)).toBe(false);
    expect(eventsFit([fling(1, {}, { t: 2, l: 6, pl: 1, fb: gorgo.fb })], sent)).toBe(false);
    expect(eventsFit([fling(1, {}, { t: 1, l: 6, pl: 1, fb: gorgo.fb, hp: (gorgo.hp ?? 0) * 2 })], sent)).toBe(false);
    expect(eventsFit([fling(1, {}, { t: 1, l: 6, pl: 1, fb: 0 })], sent)).toBe(false);
  });

  test("a negative or far-off tick does not fit", () => {
    expect(eventsFit([fling(-1, { C1: 1 })], sent)).toBe(false);
    expect(eventsFit([fling(10_000_000, { C1: 1 })], sent)).toBe(false);
  });
});

describe("friend tests: the attacker the server fights", () => {
  test("levels from the army, no Monster Lab ranks, champions at full health, no siege", () => {
    const attacker = testAttacker(army({ C1: [5, 4] }, [{ t: KRALLEN_TYPE, l: 5, pl: 2, s: "offensive" }]));
    expect((attacker.academy as Record<string, { level: number; powerup?: number }>)["C1"]).toEqual({ level: 4 });
    expect((attacker.academy as Record<string, { level: number }>)["C19"]).toEqual({ level: 1 });
    expect(Object.values(attacker.academy as object).some((row) => "powerup" in row)).toBe(false);
    expect(attacker.siege).toBeNull();
    expect(attacker.champion).toHaveLength(1);
    expect(attacker.champion![0]).toMatchObject({ t: KRALLEN_TYPE, l: 5, pl: 2, s: "offensive", status: 0 });
    expect(attacker.champion![0]!.hp).toBeGreaterThan(0);
    expect(testAttacker(army({})).champion).toBeNull();
  });
});

describe("friend tests: the report and the result", () => {
  test("the tester's report is kept only when it agrees with the server's damage", () => {
    const report = { result: "held", damagePercent: 42.3, resultLine: "held" };
    expect(keptReport(report, { damage: 42.5 })).toEqual(report);
    expect(keptReport(report, { damage: 45 })).toBeNull();
    expect(keptReport({ ...report, result: "won" }, { damage: 42.3 })).toBeNull();
    expect(keptReport({ ...report, padding: "x".repeat(70_000) }, { damage: 42.3 })).toBeNull();
    expect(keptReport(null, { damage: 0 })).toBeNull();
  });

  test("the result is the tester's word, but Flattened only when the server agrees", () => {
    expect(resultOf({ damage: 100 }, "held", false)).toBe("flattened");
    expect(resultOf({ damage: 30 }, "held", false)).toBe("held");
    expect(resultOf({ damage: 30 }, "time", true)).toBe("time");
    expect(resultOf({ damage: 30 }, "flattened", false)).toBe("stopped");
    expect(resultOf({ damage: 91 }, "flattened", true)).toBe("flattened");
    expect(resultOf({ damage: 30 }, undefined, false)).toBe("stopped");
  });
});
