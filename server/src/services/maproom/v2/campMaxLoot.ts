import { storageFallLoot } from "../../../game-rules/combat/stats.js";
import { withTribeGooBonus } from "../../base/tribeGooBonus.js";
import { tribeLayoutFor, type TribeId } from "./tribeLayouts.js";

/**
 * The most a full destroy of a fresh Map Room 2 camp pays, per resource: the
 * Town Hall and every silo fall, each taking its share of the pool left
 * (`storageFallLoot`), in whichever order pays more, plus the harvesters'
 * buffers, plus the wild tribes' goo bonus. Storage hits during the fight add
 * only a little on top. Before the Map Room 2 camp bonus
 * (`campLootBonus.ts`), the storage cap and any event or alliance bonus.
 *
 * Used by the camp loot rules (`campLoot.test.ts`) and Repeat attack's fee
 * check (`autoAttack/repeatFee.test.ts`).
 */

const RESOURCES = ["r1", "r2", "r3", "r4"] as const;
export type CampLoot = Record<(typeof RESOURCES)[number], number>;

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
export const campMaxLoot = (tribe: TribeId, level: number): CampLoot => {
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
