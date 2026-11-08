import { describe, expect, test } from "bun:test";
import { withTribeGooBonus } from "../../base/tribeGooBonus.js";
import { storageFallLoot } from "../../../game-rules/combat/stats.js";
import { TRIBE_IDS, tribeLayoutFor, tribeLevels, type TribeId } from "./tribeLayouts.js";

/**
 * The owner's camp loot rules (8 Nov 2026):
 * - a camp's loot grows with its level, for every resource;
 * - at comparable levels the tribes pay in difficulty order,
 *   Legionnaire < Kozu < Dreadnaut < Abunakki, again for every resource.
 *
 * "Comparable" is a band of four levels, which holds exactly one level of each
 * tribe: 25-28 (no Kozu there), 29-32, 33-36, 37-40 and 41-44.
 *
 * Loot here is the most a full destroy of a fresh camp pays a player with no
 * storage limit: the Town Hall and every silo fall, each taking its share of the
 * pool left (`storageFallLoot`), plus the harvesters' buffers, plus the wild
 * tribes' goo bonus. Storage hits during the fight add only a little on top.
 */

const RESOURCES = ["r1", "r2", "r3", "r4"] as const;
type Loot = Record<(typeof RESOURCES)[number], number>;

const DIFFICULTY_ORDER: readonly TribeId[] = ["legionnaire", "kozu", "dreadnaught", "abunaki"];
const BANDS = [
  [25, 28],
  [29, 32],
  [33, 36],
  [37, 40],
  [41, 44],
] as const;

/** One resource's loot when the storages fall in `order`, each paid out of what is left. */
const falls = (pool: number, resource: number, order: readonly number[]): number => {
  let left = pool;
  let got = 0;
  for (const type of order) {
    const taken = storageFallLoot(type, resource, left, true);
    left -= taken;
    got += taken;
  }
  return got;
};

/** The most a full destroy of a fresh camp of this tribe and level pays, per resource. */
export const campMaxLoot = (tribe: TribeId, level: number): Loot => {
  const { save } = tribeLayoutFor(tribe, level);
  const buildings = Object.values(save.buildingdata as object) as { t: number | string; st?: number | string }[];
  const silos = buildings.filter((b) => Number(b.t) === 6).map(() => 6);
  const loot = { r1: 0, r2: 0, r3: 0, r4: 0 };
  for (const [index, key] of RESOURCES.entries()) {
    const resource = index + 1;
    const pool = Number((save.resources as Record<string, unknown> | undefined)?.[key] ?? 0);
    const hallFirst = falls(pool, resource, [14, ...silos]);
    const silosFirst = falls(pool, resource, [...silos, 14]);
    const buffers = buildings
      .filter((b) => Number(b.t) === resource)
      .reduce((sum, b) => sum + Number(b.st ?? 0), 0);
    loot[key] = Math.max(hallFirst, silosFirst) + buffers;
  }
  return withTribeGooBonus(loot, true);
};

const total = (loot: Loot): number => RESOURCES.reduce((sum, key) => sum + loot[key], 0);

describe("camp loot", () => {
  test("every resource pays more at each higher level of a tribe", () => {
    let steps = 0;
    for (const tribe of TRIBE_IDS) {
      const levels = tribeLevels(tribe);
      for (let i = 1; i < levels.length; i++) {
        const below = campMaxLoot(tribe, levels[i - 1]!);
        const here = campMaxLoot(tribe, levels[i]!);
        for (const key of RESOURCES) {
          expect(here[key], `${tribe} ${levels[i]} ${key} vs ${levels[i - 1]}`).toBeGreaterThan(below[key]);
        }
        steps++;
      }
    }
    expect(steps).toBe(15);
  });

  test("at comparable levels the tribes pay in difficulty order: Legionnaire < Kozu < Dreadnaut < Abunakki", () => {
    let pairs = 0;
    for (const [low, high] of BANDS) {
      const inBand = DIFFICULTY_ORDER.map((tribe) => {
        const level = tribeLevels(tribe).find((l) => l >= low && l <= high);
        return level === undefined ? null : { tribe, level, loot: campMaxLoot(tribe, level) };
      }).filter((entry) => entry !== null);
      expect(inBand.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < inBand.length; i++) {
        const easier = inBand[i - 1]!;
        const harder = inBand[i]!;
        const where = `${harder.tribe} ${harder.level} vs ${easier.tribe} ${easier.level}`;
        for (const key of RESOURCES) expect(harder.loot[key], `${where} ${key}`).toBeGreaterThan(easier.loot[key]);
        expect(total(harder.loot), where).toBeGreaterThan(total(easier.loot));
        pairs++;
      }
    }
    // 2 pairs in the band without Kozu, 3 in each of the other four.
    expect(pairs).toBe(14);
  });

  test("goo stays the scarce resource: under half of one basic resource at every camp", () => {
    for (const tribe of TRIBE_IDS) {
      for (const level of tribeLevels(tribe)) {
        const loot = campMaxLoot(tribe, level);
        expect(loot.r4, `${tribe} ${level}`).toBeLessThan(Math.min(loot.r1, loot.r2, loot.r3) / 2);
      }
    }
  });
});
