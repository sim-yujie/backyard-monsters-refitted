import type { BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { advanceBuildingTimers } from "../base/advanceBuildingTimers.js";
import {
  HOUSING_EXPANSION_ITEMS,
  deriveHousingCapacity,
  housingUsed,
} from "../monsters/transferRules.js";
import { yardKindOf } from "../yardplanner/costs.js";

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
 *
 * On the Inferno yard the housing is its Housing Bunkers (128, capacity
 * 200/300/520/780/1140/1820, `HOUSING.as:65` `HOUSINGBUNKER`) and the
 * expansion is the Inferno shop's `EXHI` (`docs/design/inferno.md` WP 2.3).
 */

/** The parts of a yard housing reads. */
export interface HousingYard {
  /** `BaseType`: the Inferno yard houses in its Housing Bunkers. */
  type?: string;
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
    inferno: yardKindOf(yard) === "inferno",
    minHealth,
  });

/** A stored yard: its buildings and health as of its last write, and when that was. */
export interface StoredHousingYard extends HousingYard {
  savetime?: number | null;
}

/**
 * What a stored yard can house at `now`, rather than as of its last write.
 *
 * A yard's countdowns are only advanced when the server writes it (a load, a
 * yard action), so Housing whose build or upgrade finished since then, on an
 * outpost nobody has opened, still reads as under construction or at its old
 * level in the stored row. This plays the countdowns forward on a copy the
 * way the yard's own catch-up would (`advanceBuildingTimers`: paused while
 * damaged or repairing, an upgrade counting at its new level once done and at
 * its old one until then), and measures that. The row is not changed.
 *
 * @param yard - Buildings, health and `savetime`.
 * @param expansion - Whether EXH counts.
 * @param now - Unix seconds.
 */
export const housingCapacityNow = (yard: StoredHousingYard, expansion: boolean, now: number): number => {
  const savedAt = Number(yard.savetime);
  const elapsed = Number.isFinite(savedAt) && savedAt > 0 ? now - savedAt : 0;
  const buildingdata = yard.buildingdata
    ? advanceBuildingTimers(yard.buildingdata, yard.buildinghealthdata, elapsed)
    : yard.buildingdata;
  return housingCapacity({ ...yard, buildingdata }, expansion);
};

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

/**
 * Whether the Housing Expansion power-up is running on a save
 * (`EXH`/`EXHI` in `Save.storedata`, `client/scripts/STORE.as:2419-2431`).
 *
 * @param {JsonObject | null | undefined} storeData - A save's `storedata`
 * @param {number} now - Current unix seconds
 * @returns {boolean} True while the power-up is active
 */
export const housingExpansionActive = (
  storeData: JsonObject | null | undefined,
  now: number
): boolean =>
  HOUSING_EXPANSION_ITEMS.some((item) => Number(storeData?.[item]?.e ?? 0) > now);

/**
 * The caller's Monster Academy level per monster id, which is what decides a
 * monster's `cStorage` (`CREATURES.GetProperty`, `client/scripts/CREATURES.as:68-77`).
 *
 * An outpost's own `academy` column is usually empty while the levels really
 * live on the main yard, so the highest level found across the saves wins. Only
 * `C1`'s housing space varies by level and it shrinks as the level rises, so
 * reading high is the reading that never over-measures an honest army.
 *
 * @param {(JsonObject | null | undefined)[]} academies - `Save.academy` from each save involved
 * @returns {Record<string, number>} Academy level per monster id
 */
export const highestAcademyLevels = (
  academies: (JsonObject | null | undefined)[]
): Record<string, number> => {
  const levels: Record<string, number> = {};

  for (const academy of academies) {
    if (!academy) continue;

    for (const [id, entry] of Object.entries(academy)) {
      const level = Math.floor(Number((entry as JsonObject | null)?.level ?? 0));

      if (Number.isFinite(level) && level > (levels[id] ?? 0)) levels[id] = level;
    }
  }

  return levels;
};
