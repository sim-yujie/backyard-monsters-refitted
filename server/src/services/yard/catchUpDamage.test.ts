import { describe, expect, test } from "bun:test";
import { maxHp } from "../../game-rules/combat/stats.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import { catchUpYard, type CatchUpSave } from "./catchUp.js";
import { catchUpDamage, yardDamage } from "./catchUpDamage.js";

/**
 * `save.damage` follows the repairs down (issue #182 B): the map shows the real
 * damage until the owner repairs, so repairing has to lower it.
 */

const T0 = 1_800_000_000;

/** A level 1 Twig Snapper: 500 health, repairTime 30 s (`catchUpRepairs.test.ts`). */
const snapper = (id: number, overrides: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t: 1,
  x: 0,
  y: 0,
  st: 0,
  pr: 1,
  cP: 10,
  ...overrides,
});

/** A wall piece, which absorbs damage but is not in the percentage. */
const wall = (id: number, overrides: Partial<BuildingData> = {}): BuildingData => ({ id, t: 17, x: 0, y: 0, ...overrides });

const yardOf = (
  damage: number,
  buildings: BuildingData[],
  health: BuildingHealthData = {}
): CatchUpSave & { damage: number; buildingdata: BuildingDataMap; buildinghealthdata: BuildingHealthData } => ({
  type: "main",
  damage,
  savetime: T0,
  buildingdata: Object.fromEntries(buildings.map((building) => [String(building.id), building])),
  buildinghealthdata: health,
  storedata: {},
});

describe("yardDamage", () => {
  test("the numbers the tests assume", () => {
    expect(maxHp(1, 1)).toBe(500);
  });

  test("100 - 100 x health / max over the yard, from either health map", () => {
    expect(yardDamage(yardOf(0, [snapper(1), snapper(2)]))).toBe(0);
    expect(yardDamage(yardOf(0, [snapper(1, { hp: 0 }), snapper(2)]))).toBe(50);
    expect(yardDamage(yardOf(0, [snapper(1), snapper(2)], { "1": 0 }))).toBe(50);
    expect(yardDamage(yardOf(0, [snapper(1), snapper(2)], { "1": 250, "2": 0 }))).toBe(75);
  });

  test("walls are left out", () => {
    expect(yardDamage(yardOf(0, [snapper(1), wall(2)], { "2": 0 }))).toBe(0);
  });
});

describe("catchUpDamage", () => {
  test("a yard repaired back to full reads 0% damage", () => {
    const save = yardOf(92, [snapper(1), snapper(2)]);
    catchUpDamage(save);
    expect(save.damage).toBe(0);
  });

  test("a part repair lowers it to what the health says, cut to a whole number", () => {
    // 510 of 1,000 health left: 49%.
    const save = yardOf(92, [snapper(1), snapper(2)], { "1": 10 });
    catchUpDamage(save);
    expect(save.damage).toBe(49);
  });

  test("it never raises the attack's figure", () => {
    const save = yardOf(10, [snapper(1), snapper(2)], { "1": 0 });
    catchUpDamage(save);
    expect(save.damage).toBe(10);
  });

  test("an unrepaired yard keeps its real damage", () => {
    const save = yardOf(92, [snapper(1), snapper(2)], { "1": 0, "2": 40 });
    catchUpDamage(save);
    expect(save.damage).toBe(92);
  });
});

describe("catchUpYard", () => {
  test("a repair that finishes while the owner is away clears the damage at the next catch-up", () => {
    // Both snappers destroyed; one is repairing and is whole within 30 s.
    const save = yardOf(100, [snapper(1, { hp: 0, rE: 1 }), snapper(2, { hp: 0 })], { "1": 0, "2": 0 });
    catchUpYard(save, T0 + 60);
    expect(save.damage).toBe(50);
  });
});
