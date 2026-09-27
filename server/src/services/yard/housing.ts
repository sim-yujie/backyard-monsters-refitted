import type { BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import {
  deriveHousingCapacity,
  housingUsed,
} from "../monsters/transferRules.js";

/**
 * Monster Housing on the server (`docs/design/yard-buildings.md` §4.5,
 * `docs/specs/monsters-and-hatchery.md` §6.1): capacity, space used, and the
 * overflow cull.
 *
 * Capacity and use are the transfer rules' own (`deriveHousingCapacity`,
 * `housingUsed`, `services/monsters/transferRules.ts`), so the map transfer,
 * the hatcheries and the cull all measure a yard the same way. A Housing
 * building part-way through an upgrade counts at its old level, because `l`
 * only moves when the upgrade finishes (§10 Q4): starting an upgrade never
 * culls.
 */

/** The parts of a yard housing reads. */
export interface HousingYard {
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  /** Where `EXH` is looked up; a player's buffs live on their main yard. */
  storedata?: JsonObject | null;
}

/**
 * What the yard can house at `t` (`HOUSING.HousingSpace()`,
 * `client/scripts/HOUSING.as:55-86`): built Housing above 10 health, EXH
 * included when `expansion` says it runs.
 *
 * @param yard - Buildings and health.
 * @param expansion - Whether EXH counts.
 * @param minHealth - Health a building must be above to count (10; the cull passes 0).
 */
export const housingCapacity = (
  yard: HousingYard,
  expansion: boolean,
  minHealth?: number
): number =>
  deriveHousingCapacity({
    buildingData: yard.buildingdata,
    healthData: yard.buildinghealthdata,
    housingExpansionActive: expansion,
    minHealth,
  });

/** Space a roster takes at the given academy levels (`HOUSING.as:79-85`). */
export const housingUsedBy = (
  housed: Readonly<Record<string, number>>,
  levels: Readonly<Record<string, number>>
): number => housingUsed({ ...housed }, { ...levels });

/**
 * The overflow cull (`HOUSING.Cull()`, `client/scripts/HOUSING.as:161-199`):
 * while the army takes more space than there is, remove one of **every**
 * type that still has any, then measure again. It thins every stack evenly
 * rather than taking the cheapest or the newest, and refunds nothing.
 *
 * @param housed - The army; not mutated.
 * @param capacity - Space available.
 * @param levels - Academy level per monster id.
 * @returns The army that fits and how many of each type were removed.
 */
export const cullHousing = (
  housed: Readonly<Record<string, number>>,
  capacity: number,
  levels: Readonly<Record<string, number>>
): { housed: Record<string, number>; culled: Record<string, number> } => {
  const kept: Record<string, number> = { ...housed };
  const culled: Record<string, number> = {};

  while (housingUsedBy(kept, levels) > capacity) {
    const ids = Object.keys(kept).filter((id) => (kept[id] ?? 0) > 0);
    if (ids.length === 0) break;
    for (const id of ids) {
      kept[id] = kept[id]! - 1;
      culled[id] = (culled[id] ?? 0) + 1;
      if (kept[id] === 0) delete kept[id];
    }
  }

  return { housed: kept, culled };
};
