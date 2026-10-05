import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { championStatWithPower } from "@/game/combat/rules";
import {
  BAITER_CAP,
  TEST_ROSTER,
  allLevel1,
  allMax,
  armySize,
  baiterTarget,
  capOf,
  championLevels,
  championPowerLevels,
  clampArmy,
  clampLevel,
  consumeBaiterRun,
  defaultLevelOf,
  emptyArmy,
  isUnlocked,
  levelsOf,
  maxOf,
  myArmy,
  myLevels,
  picksOf,
  setBaiterRun,
  spaceOf,
  testChampionEntry,
  withChampion,
  withoutChampion,
  type TestArmy,
} from "./baiterSession";

/**
 * The test army of the Baiter's defence simulator (issue #22, WP1,
 * `docs/design/baiter-simulator.md` §5.1): any surface monster at any level,
 * made-up champions, a cap by Baiter level, and the target the test hands the
 * attack scene.
 */

const save = {
  error: 0,
  baseid: "3510",
  buildingdata: {},
  academy: { C1: { level: 6 }, C4: { level: 3 } },
  lockerdata: { C1: { t: 2 }, C4: { t: 2 }, C5: { t: 1 } },
  monsters: { housed: { C1: 40, C12: 2, C200: 9 } },
  resources: { r1: 10, r2: 0, r3: 0, r4: 0 },
  attackerbrains: { 1: { tower: 1 } },
} as unknown as BaseLoadResponse;

/** An army of `counts`, each row at `levels[id]` or 1. */
const armyOf = (
  counts: Record<string, number>,
  levels: Record<string, number> = {},
  champions: TestArmy["champions"] = [],
): TestArmy => ({
  monsters: Object.fromEntries(
    TEST_ROSTER.map((id) => [id, { count: counts[id] ?? 0, level: levels[id] ?? 1 }]),
  ),
  champions,
});

describe("the test roster", () => {
  it("is the 18 surface monsters, in the hatchery's order: no Inferno, no Mini (Q2)", () => {
    expect(TEST_ROSTER).toHaveLength(18);
    expect([...TEST_ROSTER].sort()).toEqual(
      [...Array.from({ length: 17 }, (_, index) => `C${index + 1}`), "C19"].sort(),
    );
    expect(TEST_ROSTER).not.toContain("C18");
    expect(TEST_ROSTER.some((id) => id.startsWith("IC"))).toBe(false);
  });

  it("offers locked monsters too, and only tags them (decision 13)", () => {
    expect(isUnlocked(save, "C1")).toBe(true);
    expect(isUnlocked(save, "C5")).toBe(false);
    expect(isUnlocked(save, "C12")).toBe(false);
    const army = clampArmy(armyOf({ C12: 2 }), 4_800);
    expect(picksOf(army)).toEqual({ C12: 2 });
  });
});

describe("the cap (Q1)", () => {
  it("is set by the Baiter's level, 600 to 4,800 housing space (YARD_PROPS.as:1962)", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(capOf)).toEqual([600, 900, 1_200, 1_500, 2_100, 3_200, 4_800]);
    expect(BAITER_CAP).toHaveLength(7);
    expect(capOf(0)).toBe(600);
    expect(capOf(9)).toBe(4_800);
  });
});

describe("levels", () => {
  it("clamp to each monster's own range", () => {
    expect(clampLevel("C1", 0)).toBe(1);
    expect(clampLevel("C1", 9)).toBe(6);
    expect(clampLevel("C1", 3.7)).toBe(3);
  });

  it("start at the player's own academy level, or 1 for a monster never trained", () => {
    expect(defaultLevelOf(save, "C1")).toBe(6);
    expect(defaultLevelOf(save, "C4")).toBe(3);
    expect(defaultLevelOf(save, "C12")).toBe(1);
    const army = emptyArmy(save);
    expect(Object.keys(army.monsters)).toEqual([...TEST_ROSTER]);
    expect(army.monsters.C1).toEqual({ count: 0, level: 6 });
    expect(army.monsters.C12).toEqual({ count: 0, level: 1 });
  });

  it("move together with My levels, All level 1 and All max, keeping the counts", () => {
    const army = armyOf({ C1: 10 }, { C1: 2, C4: 5 });
    expect(levelsOf(allLevel1(army))).toEqual(Object.fromEntries(TEST_ROSTER.map((id) => [id, 1])));
    expect(allMax(army).monsters.C1).toEqual({ count: 10, level: 6 });
    expect(myLevels(army, save).monsters.C1).toEqual({ count: 10, level: 6 });
    expect(myLevels(army, save).monsters.C4).toEqual({ count: 0, level: 3 });
    expect(myLevels(army, save).monsters.C12?.level).toBe(1);
  });
});

describe("size", () => {
  it("counts each row at its own level (MonsterBaiterItem.as:35)", () => {
    // A Pokey takes 10 at level 1 and 7 at level 6; a Bolt 20 at any level.
    expect(spaceOf("C1", 1)).toBe(10);
    expect(spaceOf("C1", 6)).toBe(7);
    expect(armySize(armyOf({ C1: 10, C4: 5 }))).toBe(200);
    expect(armySize(armyOf({ C1: 10, C4: 5 }, { C1: 6 }))).toBe(170);
  });

  it("leaves champions out of it", () => {
    const army = withChampion(armyOf({ C1: 10 }), { t: 1, l: 6, pl: 3 });
    expect(armySize(army)).toBe(100);
  });

  it("says how many more of a monster fit, the other rows as they are", () => {
    expect(maxOf(armyOf({ C4: 5 }), "C1", 600)).toBe(50);
    expect(maxOf(armyOf({ C4: 5 }, { C1: 6 }), "C1", 600)).toBe(71);
    expect(maxOf(armyOf({ C4: 30 }), "C1", 600)).toBe(0);
  });
});

describe("clampArmy", () => {
  it("cuts the army back to the cap in roster order and fills in every row", () => {
    const army = clampArmy({ monsters: { C1: { count: 50, level: 1 }, C4: { count: 20, level: 1 } }, champions: [] }, 600);
    expect(Object.keys(army.monsters)).toEqual([...TEST_ROSTER]);
    expect(picksOf(army)).toEqual({ C1: 50, C4: 5 });
    expect(armySize(army)).toBe(600);
  });

  it("makes counts whole and levels fit", () => {
    const army = clampArmy(armyOf({ C1: 2.9 }, { C1: 99, C4: -3 }), 600);
    expect(army.monsters.C1).toEqual({ count: 2, level: 6 });
    expect(army.monsters.C4?.level).toBe(1);
  });
});

describe("My army", () => {
  it("copies the monsters housed now, at the player's levels, and keeps the champions", () => {
    const army = myArmy(withChampion(armyOf({ C4: 7 }), { t: 2, l: 3, pl: 0 }), save);
    expect(picksOf(army)).toEqual({ C1: 40, C12: 2 });
    expect(army.monsters.C1?.level).toBe(6);
    expect(army.champions).toEqual([{ t: 2, l: 3, pl: 0 }]);
  });
});

describe("champions", () => {
  it("take any type at any level and power level in range", () => {
    expect(championLevels(1)).toBe(6);
    expect(championLevels(5)).toBe(5);
    expect(championPowerLevels(1)).toBe(3);
    expect(championPowerLevels(5)).toBe(2);
    const army = withChampion(armyOf({}), { t: 5, l: 9, pl: 9, s: "offensive" });
    expect(army.champions).toEqual([{ t: 5, l: 5, pl: 2, s: "offensive" }]);
    expect(withChampion(armyOf({}), { t: 9, l: 1, pl: 0 }).champions).toEqual([]);
  });

  it("follow the attack's rule: one ordinary champion plus Krallen", () => {
    let army = withChampion(armyOf({}), { t: 5, l: 2, pl: 0 });
    army = withChampion(army, { t: 1, l: 4, pl: 1 });
    expect(army.champions.map((one) => one.t)).toEqual([1, 5]);
    army = withChampion(army, { t: 4, l: 2, pl: 0 });
    expect(army.champions.map((one) => one.t)).toEqual([4, 5]);
    expect(withoutChampion(army, 5).champions.map((one) => one.t)).toEqual([4]);
    const clamped = clampArmy(armyOf({}, {}, [{ t: 1, l: 1, pl: 0 }, { t: 2, l: 1, pl: 0 }]), 600);
    expect(clamped.champions.map((one) => one.t)).toEqual([2]);
  });

  it("are made up: full health, active, unfed and with no learned brain (Q6)", () => {
    const entry = testChampionEntry({ t: 4, l: 3, pl: 2, s: "defensive" });
    expect(entry).toEqual({
      t: 4,
      l: 3,
      pl: 2,
      hp: championStatWithPower("G4", "health", 3, 2),
      status: 0,
      ft: 0,
      fd: 0,
      fb: 0,
      s: "defensive",
    });
    expect(entry).not.toHaveProperty("b");
  });
});

describe("the hand-off and the attack target", () => {
  const run = {
    save,
    army: withChampion(armyOf({ C1: 20, C4: 5 }, { C1: 3 }), { t: 1, l: 2, pl: 1 }),
    baiterLevel: 2,
  };

  it("hands one run from the yard to the scene, once", () => {
    setBaiterRun(run);
    expect(consumeBaiterRun()).toBe(run);
    expect(consumeBaiterRun()).toBeNull();
  });

  it("fights on the own yard with its defenders, against the test army and nothing else (Q7)", () => {
    const defended = {
      ...save,
      buildingdata: { "5": { id: 5, t: 22, l: 1, X: 0, Y: 0, m: { C1: 4 } } },
      champion: [{ t: 2, l: 3, hp: 800, pl: 1, status: 0, fd: 0, ft: 0, fb: 0 }],
    } as unknown as BaseLoadResponse;
    const target = baiterTarget({ ...run, save: defended });
    expect(target).toMatchObject({ baseid: "3510", kind: "wild", name: "Wild monsters" });
    // The yard defends itself as in a real attack (#195): garrisons, its own levels, the caged champion.
    expect((target.load as { defenderforces?: unknown }).defenderforces).toEqual({
      bunkers: { 5: { C1: 4 } },
      defenderLevels: { C1: 6, C4: 3 },
      defenderChampion: { t: 2, l: 3, hp: 800, pl: 1 },
    });
    expect(target.roster).toEqual({
      monsters: { C1: 20, C4: 5 },
      levels: { ...Object.fromEntries(TEST_ROSTER.map((id) => [id, 1])), C1: 3 },
      champions: [testChampionEntry({ t: 1, l: 2, pl: 1 })],
      flingerLevel: 0,
      catapultLevel: 0,
      sources: [],
      siege: null,
      resources: null,
    });
  });

  it("leaves the load's frozen champion brains behind, so a test champion is a fresh one (Q6)", () => {
    const target = baiterTarget(run);
    expect(target.load).not.toHaveProperty("attackerbrains");
    expect(save.attackerbrains).toBeDefined();
  });
});
